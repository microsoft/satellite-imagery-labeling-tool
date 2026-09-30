import {
    createWorkflowDestinationDecision,
    requireAllowedDestination,
    validateExpandedDestination
} from './remoteDestination.js';

function declined(decision) {
    return Object.freeze({
        status: 'declined',
        decision
    });
}

export async function createApprovedServiceDestination(value, options = {}) {
    const decisionOptions = {
        workflow: 'service',
        pageUrl: options.pageUrl,
        taskUrl: options.taskUrl,
        currentOrigin: options.currentOrigin,
        reviewedOrigins: options.reviewedOrigins ?? [],
        allowLocalhost: options.allowLocalhost === true,
        requireTaskConsent: true,
        allowedPlaceholders: options.allowedPlaceholders ?? [],
        redirectPolicy: 'block-all'
    };
    let decision = createWorkflowDestinationDecision(value, decisionOptions);
    if (decision.reason === 'private-address-approval-required') {
        if (typeof options.confirmPrivateDestination !== 'function') {
            return requireAllowedDestination(decision);
        }
        if (await options.confirmPrivateDestination(decision) !== true) {
            return declined(decision);
        }
        decision = createWorkflowDestinationDecision(value, {
            ...decisionOptions,
            consent: 'private-explicitly-approved'
        });
    } else if (decision.reason === 'task-origin-approval-required') {
        if (typeof options.confirmDestinationOrigin !== 'function') {
            return requireAllowedDestination(decision);
        }
        if (await options.confirmDestinationOrigin(decision) !== true) {
            return declined(decision);
        }
        decision = createWorkflowDestinationDecision(value, {
            ...decisionOptions,
            consent: 'task-load-approved'
        });
    }

    return Object.freeze({
        status: 'ready',
        decision: requireAllowedDestination(decision)
    });
}

export async function createExpandedServiceDestination(
    template,
    expandedValue,
    options = {}
) {
    const approval = await createApprovedServiceDestination(template, options);
    if (approval.status === 'declined') {
        return approval;
    }
    const destinationDecision = requireAllowedDestination(validateExpandedDestination(
        approval.decision,
        expandedValue,
        {
            baseUrl: options.taskUrl,
            currentOrigin: options.currentOrigin,
            reviewedOrigins: options.reviewedOrigins ?? [],
            allowLocalhost: options.allowLocalhost === true
        }
    ));
    return Object.freeze({
        status: 'ready',
        templateDecision: approval.decision,
        destinationDecision,
        requestUrl: destinationDecision.resolvedUrl
    });
}
