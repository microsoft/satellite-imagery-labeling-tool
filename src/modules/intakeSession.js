const SOURCE_KINDS = new Set([
    'local-file',
    'archive',
    'task-url',
    'task-file',
    'project-file',
    'remote-import',
    'custom-data',
    'osm-search',
    'url-parameter',
    'configuration'
]);

const PHASES = new Set([
    'created',
    'validating-source',
    'reading',
    'parsing',
    'validating',
    'preparing-render',
    'capacity-stopped',
    'awaiting-partial-confirmation',
    'awaiting-override-confirmation',
    'paused',
    'ready',
    'committing',
    'completed',
    'cancelled',
    'failed'
]);

const DIAGNOSTIC_CATEGORIES = new Set([
    'syntax',
    'schema',
    'dangerous-key',
    'destination',
    'redirect',
    'archive-integrity',
    'capacity',
    'network',
    'render',
    'cancelled'
]);

const STAGED_KINDS = new Set([
    'task',
    'project',
    'geometry',
    'feature subset',
    'custom data',
    'search result'
]);

const SAMPLE_LIMIT = 5;

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`${name} must be a non-empty string.`);
    }
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createUntrustedSource(input) {
    if (!isRecord(input)) {
        throw new TypeError('Source must be an object.');
    }
    requireString(input.id, 'source.id');
    requireString(input.displayName, 'source.displayName');
    requireString(input.format, 'source.format');
    if (!SOURCE_KINDS.has(input.kind)) {
        throw new TypeError(`Unsupported source kind: ${input.kind}`);
    }

    return Object.freeze({
        id: input.id,
        kind: input.kind,
        displayName: input.displayName,
        format: input.format,
        declaredBytes: input.declaredBytes,
        observedBytes: input.observedBytes ?? 0,
        foreground: input.foreground === true,
        automatic: input.automatic === true,
        destinationDecisionId: input.destinationDecisionId,
        conditionalIdentity: input.conditionalIdentity,
        overrideEligible: input.foreground === true
            && input.automatic !== true
            && input.displayName.trim() !== ''
    });
}

export function createIntakeDiagnostic(input) {
    if (!isRecord(input) || !DIAGNOSTIC_CATEGORIES.has(input.category)) {
        throw new TypeError('Unsupported diagnostic category.');
    }
    requireString(input.reasonCode, 'diagnostic.reasonCode');

    const identifiers = Array.isArray(input.identifiers)
        ? input.identifiers
        : (input.sampleIdentifiers ?? []);

    return Object.freeze({
        category: input.category,
        reasonCode: input.reasonCode,
        totalCount: Number.isInteger(input.totalCount) && input.totalCount >= 0
            ? input.totalCount
            : identifiers.length,
        sampleIdentifiers: Object.freeze(
            identifiers.slice(0, SAMPLE_LIMIT).map(value => String(value))
        ),
        bytesScanned: Number.isFinite(input.bytesScanned) ? input.bytesScanned : 0,
        messageArguments: Object.freeze({ ...(input.messageArguments ?? {}) }),
        observedValue: input.observedValue,
        supportedValue: input.supportedValue,
        capacityDimension: input.capacityDimension
    });
}

export function createStagedResult(input) {
    if (!isRecord(input) || !STAGED_KINDS.has(input.kind)) {
        throw new TypeError('Unsupported staged result kind.');
    }
    requireString(input.sourceId, 'stagedResult.sourceId');
    requireString(input.commitToken, 'stagedResult.commitToken');
    if (input.payload === undefined || input.renderPayload === undefined) {
        throw new TypeError('Staged results require payload and renderPayload.');
    }

    return Object.freeze({
        kind: input.kind,
        payload: input.payload,
        renderPayload: input.renderPayload,
        sourceId: input.sourceId,
        warnings: Object.freeze([...(input.warnings ?? [])]),
        diagnostics: Object.freeze([...(input.diagnostics ?? [])]),
        commitToken: input.commitToken
    });
}

export class IntakeSession {
    constructor({ id, source, requestId = null }) {
        requireString(id, 'session.id');
        if (!source || !SOURCE_KINDS.has(source.kind)) {
            throw new TypeError('A validated source is required.');
        }

        this.id = id;
        this.sourceId = source.id;
        this.source = source;
        this.requestId = requestId;
        this.phase = 'created';
        this.progress = {
            bytesRead: 0,
            recordsSeen: 0,
            validationOperations: 0
        };
        this.checkpoint = null;
        this.diagnostics = [];
        this.stagedResult = null;
        this.overrideAttemptId = null;
        this.cancelRequested = false;
    }

    isActive(requestId) {
        return this.requestId === null || requestId === this.requestId;
    }

    setPhase(requestId, phase) {
        if (!this.isActive(requestId) || !PHASES.has(phase)) {
            return false;
        }
        this.phase = phase;
        return true;
    }

    updateProgress(requestId, progress) {
        if (!this.isActive(requestId) || this.cancelRequested) {
            return false;
        }
        this.progress = {
            ...this.progress,
            ...progress
        };
        return true;
    }

    addDiagnostic(requestId, diagnostic) {
        if (!this.isActive(requestId)) {
            return false;
        }
        this.diagnostics.push(diagnostic);
        return true;
    }

    setCheckpoint(requestId, checkpoint) {
        if (!this.isActive(requestId) || !isRecord(checkpoint)) {
            return false;
        }
        this.checkpoint = Object.freeze({ ...checkpoint });
        return true;
    }

    stage(requestId, stagedResult) {
        if (!this.isActive(requestId) || this.cancelRequested
            || stagedResult.sourceId !== this.sourceId) {
            return false;
        }
        this.stagedResult = stagedResult;
        this.phase = 'ready';
        return true;
    }

    canCommit(requestId, commitToken) {
        return this.isActive(requestId)
            && !this.cancelRequested
            && this.phase === 'ready'
            && this.stagedResult !== null
            && this.stagedResult.commitToken === commitToken;
    }

    commit(requestId, commitToken) {
        if (!this.canCommit(requestId, commitToken)) {
            throw new Error('The staged result is no longer eligible to commit.');
        }
        this.phase = 'committing';
        const committed = this.stagedResult;
        this.stagedResult = null;
        this.checkpoint = null;
        this.phase = 'completed';
        return committed;
    }

    pause(requestId) {
        if (!this.isActive(requestId) || !this.checkpoint || this.cancelRequested) {
            return false;
        }
        this.phase = 'paused';
        return true;
    }

    resume(requestId) {
        if (!this.isActive(requestId) || this.phase !== 'paused' || this.cancelRequested) {
            return false;
        }
        this.phase = 'reading';
        return true;
    }

    discard(requestId, phase = 'failed') {
        if (!this.isActive(requestId) || !PHASES.has(phase)) {
            return false;
        }
        this.stagedResult = null;
        this.checkpoint = null;
        this.phase = phase;
        return true;
    }

    cancel(requestId) {
        if (!this.isActive(requestId)) {
            return false;
        }
        this.cancelRequested = true;
        return this.discard(requestId, 'cancelled');
    }
}

export class CapacityOverrideAttempt {
    constructor(input) {
        if (!isRecord(input)) {
            throw new TypeError('Capacity override attempt must be an object.');
        }
        for (const field of ['id', 'sourceId', 'originalSessionId', 'dimension']) {
            requireString(input[field], `capacityOverride.${field}`);
        }
        if (!Number.isFinite(input.observedValue) || !Number.isFinite(input.supportedValue)) {
            throw new TypeError('Capacity override values must be finite numbers.');
        }

        this.id = input.id;
        this.sourceId = input.sourceId;
        this.originalSessionId = input.originalSessionId;
        this.dimension = input.dimension;
        this.observedValue = input.observedValue;
        this.supportedValue = input.supportedValue;
        this.approvedAt = null;
        this.used = false;
        this.conditionalIdentity = input.conditionalIdentity;
        this.acknowledged = false;
    }

    acknowledge() {
        if (this.used) {
            throw new Error('A used capacity override cannot be acknowledged again.');
        }
        this.acknowledged = true;
        this.approvedAt = new Date().toISOString();
    }

    markUsed() {
        if (!this.acknowledged || this.used) {
            throw new Error('Capacity override requires fresh acknowledgment and may be used once.');
        }
        this.used = true;
    }
}

export function createCapacityOverrideAttempt(input) {
    return new CapacityOverrideAttempt(input);
}
