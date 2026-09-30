import { appSettings } from '../settings/project_admin_settings.js';
import { mapSettings } from '../settings/map_settings.js';
import {
    IntakeSession,
    createCapacityOverrideAttempt,
    createIntakeDiagnostic,
    createStagedResult,
    createUntrustedSource
} from './intakeSession.js';
import {
    createWorkflowDestinationDecision,
    requireAllowedDestination
} from './remoteDestination.js';
import { SchemaValidationError, validateProject } from './schemaValidation.js';
import './workerProtocol.js';

const TILE_PLACEHOLDERS = [
    'x', 'y', 'z', 'quadkey', 'bbox', 'bbox-epsg-3857', 'subdomain', 'azMapsDomain'
];

function isEmbeddedImage(value) {
    return /^data:image\/(?:png|jpeg);base64,[a-z0-9+/=\s]+$/i.test(value);
}

function validateDestination(value, path, options, allowedPlaceholders = []) {
    if (isEmbeddedImage(value)) {
        return Object.freeze({
            originalValue: value,
            resolvedUrl: value,
            scheme: 'data',
            origin: '',
            addressClass: 'not-applicable',
            originClass: 'same-origin',
            consent: 'not-required',
            status: 'allowed',
            reason: null,
            embedded: true
        });
    }

    const decisionOptions = {
        workflow: 'project',
        pageUrl: options.pageUrl,
        projectUrl: options.projectUrl ?? options.pageUrl,
        currentOrigin: options.currentOrigin,
        reviewedOrigins: options.reviewedOrigins,
        allowLocalhost: options.allowLocalhost,
        requireTaskConsent: true,
        allowedPlaceholders
    };
    let decision = createWorkflowDestinationDecision(value, decisionOptions);
    if (decision.reason === 'task-origin-approval-required'
        && options.approvedOrigins?.has(decision.origin)) {
        decision = createWorkflowDestinationDecision(value, {
            ...decisionOptions,
            consent: 'task-load-approved'
        });
    } else if (decision.reason === 'private-address-approval-required'
        && options.privateApprovedOrigins?.has(decision.origin)) {
        decision = createWorkflowDestinationDecision(value, {
            ...decisionOptions,
            consent: 'private-explicitly-approved'
        });
    }
    try {
        return requireAllowedDestination(decision);
    } catch {
        const error = new SchemaValidationError(
            `${path} is not an allowed destination.`,
            decision.reason ?? 'blocked-destination',
            path
        );
        error.destinationDecision = decision;
        throw error;
    }
}

export function validateProjectForUse(project, options = {}) {
    const sourceId = project?.sourceId ?? options.sourceId ?? 'project';
    const validated = validateProject({
        settings: project?.settings,
        tasks: project?.tasks,
        results: project?.results ?? []
    }, { sourceId });
    const pageUrl = options.pageUrl ?? globalThis.location?.href;
    if (!pageUrl) {
        throw new TypeError('Project destination validation requires a page URL.');
    }
    const destinationOptions = {
        pageUrl,
        projectUrl: options.projectUrl,
        currentOrigin: options.currentOrigin ?? new URL(pageUrl).origin,
        reviewedOrigins: options.reviewedOrigins ?? mapSettings.reviewedServiceOrigins,
        allowLocalhost: options.allowLocalhost ?? mapSettings.allowLocalhostHttp,
        approvedOrigins: new Set(options.approvedOrigins ?? []),
        privateApprovedOrigins: new Set(options.privateApprovedOrigins ?? [])
    };
    const decisions = [];
    const properties = validated.settings.features[0].properties;
    for (const [name, layer] of Object.entries(properties.layers)) {
        const field = layer.type === 'TileLayer' ? 'tileUrl' : 'url';
        decisions.push(validateDestination(
            layer[field],
            `$.settings.features[0].properties.layers.${name}.${field}`,
            destinationOptions,
            layer.type === 'TileLayer' ? TILE_PLACEHOLDERS : []
        ));
    }
    if (properties.customDataService) {
        decisions.push(validateDestination(
            properties.customDataService,
            '$.settings.features[0].properties.customDataService',
            destinationOptions,
            ['bbox']
        ));
    }

    return Object.freeze({
        ...structuredClone(project),
        settings: validated.settings,
        tasks: validated.tasks,
        results: validated.results,
        sourceId,
        destinationDecisions: Object.freeze(decisions)
    });
}

async function validateProjectWithApprovals(project, options) {
    const approvedOrigins = new Set(options.approvedOrigins ?? []);
    const privateApprovedOrigins = new Set(options.privateApprovedOrigins ?? []);
    while (true) {
        try {
            return validateProjectForUse(project, {
                ...options,
                approvedOrigins,
                privateApprovedOrigins
            });
        } catch (error) {
            const decision = error.destinationDecision;
            let approved = false;
            if (decision?.reason === 'task-origin-approval-required') {
                if (typeof options.confirmDestinationOrigin !== 'function') {
                    throw error;
                }
                approved = await options.confirmDestinationOrigin?.(decision) === true;
                if (approved) {
                    approvedOrigins.add(decision.origin);
                }
            } else if (decision?.reason === 'private-address-approval-required') {
                if (typeof options.confirmPrivateDestination !== 'function') {
                    throw error;
                }
                approved = await options.confirmPrivateDestination?.(decision) === true;
                if (approved) {
                    privateApprovedOrigins.add(decision.origin);
                }
            } else {
                throw error;
            }
            if (!approved) {
                return Object.freeze({
                    status: 'declined',
                    decision
                });
            }
        }
    }
}

function uniqueId(prefix) {
    return `${prefix}-${globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : Math.random().toString(36).slice(2)}`;
}

function normalizeArguments(readResults, options) {
    if (readResults && typeof readResults === 'object') {
        return { readResults: readResults.readResults === true, options: readResults };
    }
    return { readResults: readResults === true, options: options ?? {} };
}

function runWorker(fileBlob, readResults, options, session, overrideAttempt = null) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL('../workers/ArchiveIntakeWorker.js', import.meta.url)
        );
        const requestId = session.requestId;
        let settled = false;
        const watchdog = globalThis.WorkerProtocol.createWorkerSilenceWatchdog({
            timeoutMs: options.workerSilenceTimeoutMs ?? 1000,
            onSilence: () => {
                if (settled) {
                    return;
                }
                worker.postMessage({ type: 'cancel', requestId });
                session.discard(requestId, 'failed');
                const error = new Error(
                    'Archive worker stopped responding. Staged data was discarded and the operation may be retried.'
                );
                error.name = 'WorkerUnresponsiveError';
                error.retryEligible = true;
                finish(reject, error);
            }
        });

        const finish = (callback, value) => {
            if (settled) {
                return;
            }
            settled = true;
            watchdog.stop();
            worker.terminate();
            callback(value);
        };

        worker.onmessage = async event => {
            let message;
            try {
                message = globalThis.WorkerProtocol.validateWorkerEvent(event.data ?? {});
            } catch (error) {
                session.discard(requestId, 'failed');
                finish(reject, error);
                return;
            }
            if (message.requestId !== requestId) {
                return;
            }
            watchdog.touch();
            if (message.type === 'progress') {
                session.setPhase(requestId, message.phase === 'ready'
                    ? 'preparing-render'
                    : 'validating');
                session.updateProgress(requestId, {
                    bytesRead: message.counters?.actualExpandedBytes ?? 0,
                    recordsSeen: message.counters?.entryCount ?? 0,
                    validationOperations: message.counters?.validationWork ?? 0
                });
                options.onProgress?.(message);
                return;
            }
            if (message.type === 'capacityExceeded') {
                session.setPhase(requestId, 'capacity-stopped');
                session.addDiagnostic(requestId, createIntakeDiagnostic({
                    category: 'capacity',
                    reasonCode: 'capacity-exceeded',
                    observedValue: message.observed,
                    supportedValue: message.supported,
                    capacityDimension: message.dimension,
                    measuredDimensions: Object.fromEntries(
                        (message.crossings ?? [{
                            dimension: message.dimension,
                            observed: message.observed,
                            supported: message.supported
                        }]).map(crossing => [
                            crossing.dimension,
                            {
                                observed: crossing.observed,
                                supported: crossing.supported
                            }
                        ])
                    )
                }));
                finish(resolve, { type: 'capacityExceeded', message });
                return;
            }
            if (message.type === 'cancelled') {
                session.cancel(requestId);
                finish(reject, new DOMException('Archive loading was cancelled.', 'AbortError'));
                return;
            }
            if (message.type === 'failed') {
                session.addDiagnostic(requestId, createIntakeDiagnostic({
                    category: message.category ?? 'archive-integrity',
                    reasonCode: message.reasonCode ?? 'archive-processing-failed',
                    identifiers: message.entryPath ? [message.entryPath] : []
                }));
                session.discard(requestId, 'failed');
                const error = new Error(message.error || 'Unable to load project archive.');
                error.category = message.category;
                error.reasonCode = message.reasonCode;
                error.entryPath = message.entryPath;
                error.retryEligible = false;
                finish(reject, error);
                return;
            }
            if (message.type === 'ready') {
                try {
                    const validatedProject = await validateProjectWithApprovals(message.stagedProject, {
                        sourceId: session.sourceId,
                        pageUrl: options.pageUrl,
                        projectUrl: options.projectUrl,
                        currentOrigin: options.currentOrigin,
                        reviewedOrigins: options.reviewedOrigins,
                        allowLocalhost: options.allowLocalhost,
                        confirmDestinationOrigin: options.confirmDestinationOrigin,
                        confirmPrivateDestination: options.confirmPrivateDestination
                    });
                    if (validatedProject.status === 'declined') {
                        session.discard(requestId, 'declined');
                        finish(resolve, {
                            type: 'declined',
                            decision: validatedProject.decision
                        });
                        return;
                    }
                    const staged = createStagedResult({
                        kind: 'project',
                        payload: validatedProject,
                        renderPayload: {
                            ...message.renderPayload,
                            destinationDecisions: validatedProject.destinationDecisions
                        },
                        sourceId: session.sourceId,
                        diagnostics: session.diagnostics,
                        commitToken: message.commitToken
                    });
                    if (!session.stage(requestId, staged)) {
                        finish(reject, new Error('The archive result is no longer active.'));
                        return;
                    }
                    const committed = session.commit(requestId, message.commitToken);
                    finish(resolve, {
                        type: 'ready',
                        project: committed.payload,
                        accounting: message.accounting,
                        manifest: message.manifest,
                        overrideAttempt
                    });
                } catch (error) {
                    session.discard(requestId, 'failed');
                    error.retryEligible = false;
                    finish(reject, error);
                }
            }
        };
        worker.onerror = event => {
            session.discard(requestId, 'failed');
            finish(reject, new Error(event.message || 'Archive worker failed.'));
        };

        if (options.signal) {
            const cancel = () => {
                worker.postMessage({ type: 'cancel', requestId });
                setTimeout(() => {
                    if (!settled) {
                        session.cancel(requestId);
                        finish(reject, new DOMException('Archive loading was cancelled.', 'AbortError'));
                    }
                }, options.cancelTimeoutMs ?? 1000);
            };
            if (options.signal.aborted) {
                cancel();
                return;
            }
            options.signal.addEventListener('abort', cancel, { once: true });
        }

        session.setPhase(requestId, 'reading');
        worker.postMessage({
            type: 'start',
            requestId,
            sourceId: session.sourceId,
            source: fileBlob,
            readResults,
            boundaries: options.boundaries ?? {},
            overrideCapacity: overrideAttempt?.used === true,
            colorPalette: appSettings.colorPalette,
            commitToken: uniqueId('archive-commit')
        });
    });
}

export class ProjectUtils {
    static async readProjectFile(fileBlob, readResults = false, options = {}) {
        if (!(fileBlob instanceof Blob)) {
            throw new TypeError('A project archive Blob is required.');
        }
        const normalized = normalizeArguments(readResults, options);
        normalized.options.pageUrl ??= globalThis.location?.href;
        const source = createUntrustedSource({
            id: uniqueId('archive-source'),
            kind: 'archive',
            displayName: fileBlob.name || 'project archive',
            format: 'zip',
            declaredBytes: fileBlob.size,
            observedBytes: fileBlob.size,
            foreground: true,
            automatic: false
        });
        const firstSession = new IntakeSession({
            id: uniqueId('archive-session'),
            source,
            requestId: uniqueId('archive-request')
        });
        const firstOutcome = await runWorker(
            fileBlob,
            normalized.readResults,
            normalized.options,
            firstSession
        );
        if (firstOutcome.type === 'ready') {
            return firstOutcome.project;
        }
        if (firstOutcome.type === 'declined') {
            return Object.freeze({
                status: 'declined',
                decision: firstOutcome.decision
            });
        }

        const capacity = firstOutcome.message;
        if (capacity.type !== 'capacityExceeded'
            || typeof normalized.options.confirmCapacityOverride !== 'function') {
            const error = new Error('Project archive exceeded an injected processing boundary.');
            error.category = 'capacity';
            error.reasonCode = 'capacity-exceeded';
            error.dimension = capacity.dimension;
            error.observed = capacity.observed;
            error.supported = capacity.supported;
            error.retryEligible = true;
            throw error;
        }

        const attempt = createCapacityOverrideAttempt({
            id: uniqueId('archive-override'),
            sourceId: source.id,
            originalSessionId: firstSession.id,
            dimension: capacity.dimension,
            observedValue: capacity.observed,
            supportedValue: capacity.supported,
            crossings: capacity.crossings
        });
        const approved = await normalized.options.confirmCapacityOverride({
            attempt,
            source,
            acknowledge: () => attempt.acknowledge()
        });
        if (approved !== true || !attempt.acknowledged) {
            const error = new Error('Project archive capacity retry was not approved.');
            error.name = 'AbortError';
            throw error;
        }
        attempt.markUsed();

        const retrySession = new IntakeSession({
            id: uniqueId('archive-session'),
            source,
            requestId: uniqueId('archive-request')
        });
        retrySession.overrideAttemptId = attempt.id;
        const retryOutcome = await runWorker(
            fileBlob,
            normalized.readResults,
            normalized.options,
            retrySession,
            attempt
        );
        return retryOutcome.project;
    }
}
