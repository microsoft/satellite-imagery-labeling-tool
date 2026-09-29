import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    createDestinationDecision,
    requireAllowedDestination,
    validateExpandedDestination
} from '../../src/modules/remoteDestination.js';

const options = {
    baseUrl: 'https://app.example/tools/labeler.html',
    currentOrigin: 'https://app.example',
    reviewedOrigins: ['https://services.example']
};

test('resolves workflow-relative destinations and classifies reviewed origins', () => {
    const relative = createDestinationDecision('../tasks/a.json', options);
    assert.equal(relative.status, 'allowed');
    assert.equal(relative.resolvedUrl, 'https://app.example/tasks/a.json');
    assert.equal(relative.originClass, 'same-origin');

    const reviewed = createDestinationDecision('https://services.example/data', options);
    assert.equal(reviewed.originClass, 'reviewed-default');
    assert.equal(reviewed.consent, 'not-required');
});

test('rejects plaintext remote HTTP and embedded credentials', () => {
    assert.equal(
        createDestinationDecision('http://example.com/data', options).reason,
        'scheme-not-allowed'
    );
    assert.equal(
        createDestinationDecision('https://user:pass@example.com/data', options).reason,
        'credentials-not-allowed'
    );
});

test('permits explicitly configured local development HTTP only', () => {
    const blocked = createDestinationDecision('http://localhost:4173/data', options);
    assert.equal(blocked.status, 'blocked');
    const allowed = createDestinationDecision('http://127.0.0.1:4173/data', {
        ...options,
        allowLocalhost: true
    });
    assert.equal(allowed.status, 'allowed');
    assert.equal(allowed.addressClass, 'loopback');
});

test('requires explicit private-literal and task-origin consent', () => {
    const privateAddress = createDestinationDecision('https://192.168.1.10/data', options);
    assert.equal(privateAddress.reason, 'private-address-approval-required');
    assert.equal(createDestinationDecision('https://192.168.1.10/data', {
        ...options,
        consent: 'private-explicitly-approved'
    }).status, 'allowed');

    const taskOrigin = createDestinationDecision('https://new.example/task.json', {
        ...options,
        requireTaskConsent: true
    });
    assert.equal(taskOrigin.reason, 'task-origin-approval-required');
    assert.equal(createDestinationDecision('https://new.example/task.json', {
        ...options,
        requireTaskConsent: true,
        consent: 'task-load-approved'
    }).status, 'allowed');
});

test('validates templates before expansion and blocks origin changes', () => {
    const decision = createDestinationDecision('https://services.example/data?bbox={bbox}', {
        ...options,
        allowedPlaceholders: ['bbox']
    });
    requireAllowedDestination(decision);
    assert.deepEqual(decision.templateContext.usedPlaceholders, ['bbox']);
    assert.equal(
        validateExpandedDestination(decision, 'https://evil.example/data', options).reason,
        'template-origin-changed'
    );
    assert.equal(
        createDestinationDecision('https://services.example/{unknown}', {
            ...options,
            allowedPlaceholders: ['bbox']
        }).reason,
        'unsupported-template-placeholder'
    );
});
