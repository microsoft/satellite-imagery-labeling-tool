import {
    createWorkflowDestinationDecision,
    requireAllowedDestination
} from './remoteDestination.js';
import {
    SchemaValidationError,
    assertNoDangerousKeys,
    validateTask,
    validateTaskResults
} from './schemaValidation.js';

function cloneValue(value) {
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

function requireTaskDocument(document) {
    if (!document || document.type !== 'FeatureCollection'
        || !Array.isArray(document.features)
        || document.features.length === 0) {
        throw new SchemaValidationError(
            'A task must be a non-empty FeatureCollection.',
            'invalid-task-document',
            '$'
        );
    }
}

export function validateLabelerTask(document, options = {}) {
    assertNoDangerousKeys(document);
    requireTaskDocument(document);
    if (!options.defaultTask?.properties) {
        throw new TypeError('A default labeler task is required.');
    }

    const stagedDocument = cloneValue(document);
    if (!stagedDocument.features[0]
        || typeof stagedDocument.features[0] !== 'object'
        || Array.isArray(stagedDocument.features[0])) {
        throw new SchemaValidationError(
            'The task feature must be an object.',
            'invalid-feature',
            '$.features[0]'
        );
    }
    const suppliedProperties = stagedDocument.features[0].properties;
    if (suppliedProperties !== undefined
        && (suppliedProperties === null
            || typeof suppliedProperties !== 'object'
            || Array.isArray(suppliedProperties))) {
        throw new SchemaValidationError(
            'The task properties must be an object.',
            'invalid-type',
            '$.features[0].properties'
        );
    }
    validateTask(stagedDocument, {
        sourceId: options.sourceId,
        destinationDecisions: options.destinationDecisions,
        allowEmptyGeometry: true
    });
    stagedDocument.features[0].properties = {
        ...cloneValue(options.defaultTask.properties),
        ...suppliedProperties
    };

    return validateTask(stagedDocument, {
        sourceId: options.sourceId,
        destinationDecisions: options.destinationDecisions,
        allowEmptyGeometry: true
    });
}

function createTaskDecision(value, options, consent = 'not-required') {
    return createWorkflowDestinationDecision(value, {
        workflow: 'page',
        pageUrl: options.pageUrl,
        currentOrigin: options.currentOrigin,
        reviewedOrigins: options.reviewedOrigins,
        allowLocalhost: options.allowLocalhost,
        requireTaskConsent: true,
        consent,
        redirectPolicy: 'block-all'
    });
}

async function approveTaskDecision(value, options) {
    let decision = createTaskDecision(value, options);
    if (decision.reason === 'private-address-approval-required') {
        const approved = await options.confirmPrivateDestination?.(decision);
        if (approved !== true) {
            throw new TypeError('The private task destination was not approved.');
        }
        decision = createTaskDecision(value, options, 'private-explicitly-approved');
    } else if (decision.reason === 'task-origin-approval-required') {
        const approved = await options.discloseTaskOrigin?.(decision);
        if (approved !== true) {
            throw new TypeError('The task destination was not approved.');
        }
        decision = createTaskDecision(value, options, 'task-load-approved');
    }
    return requireAllowedDestination(decision);
}

export async function loadValidatedTaskFromUrl(value, options = {}) {
    if (typeof options.fetchImpl !== 'function') {
        throw new TypeError('A fetch implementation is required.');
    }

    const decision = await approveTaskDecision(value, options);
    const response = await options.fetchImpl(decision.resolvedUrl, {
        redirect: 'error'
    });
    if (!response?.ok) {
        throw new Error(`Task request failed with status ${response?.status ?? 'unknown'}.`);
    }

    const document = await response.json();
    const validated = validateLabelerTask(document, {
        sourceId: options.sourceId,
        defaultTask: options.defaultTask,
        destinationDecisions: [decision]
    });
    return Object.freeze({ decision, validated });
}

export function validateLabelerAutosave(envelope, task, options = {}) {
    assertNoDangerousKeys(envelope);
    const storedDate = envelope?.date ?? envelope?.timestamp;
    const date = Number.isFinite(storedDate)
        ? storedDate
        : Date.parse(storedDate);
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
        || !Number.isFinite(date)
        || !envelope.data
        || envelope.data.type !== 'FeatureCollection'
        || !Array.isArray(envelope.data.features)) {
        throw new SchemaValidationError(
            'The cached task data is invalid.',
            'invalid-autosave',
            '$'
        );
    }

    const features = validateTaskResults(task, envelope.data.features, {
        sourceId: options.sourceId,
        allowEmptyTaskGeometry: true
    });

    return Object.freeze({
        data: Object.freeze({
            type: 'FeatureCollection',
            features
        }),
        date
    });
}
