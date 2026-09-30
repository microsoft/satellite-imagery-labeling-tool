import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    createApprovedServiceDestination,
    createExpandedServiceDestination
} from '../../src/modules/serviceDestinationIntake.js';

const baseOptions = {
    operation: 'Custom data import',
    pageUrl: 'https://app.example/labeler.html',
    taskUrl: 'https://tasks.example/task.json',
    currentOrigin: 'https://app.example',
    reviewedOrigins: [],
    allowLocalhost: false
};

test('returns a structured declined outcome for an unreviewed service without throwing', async () => {
    let disclosures = 0;
    const result = await createApprovedServiceDestination(
        'https://declined.example/data',
        {
            ...baseOptions,
            confirmDestinationOrigin: decision => {
                disclosures += 1;
                assert.equal(decision.origin, 'https://declined.example');
                return false;
            }
        }
    );

    assert.equal(disclosures, 1);
    assert.equal(result.status, 'declined');
    assert.equal(result.decision.reason, 'task-origin-approval-required');
});

test('does not expand or return a request URL after destination refusal', async () => {
    const result = await createExpandedServiceDestination(
        'https://declined.example/data?bbox={bbox}',
        'https://declined.example/data?bbox=0,0,1,1',
        {
            ...baseOptions,
            allowedPlaceholders: ['bbox'],
            confirmDestinationOrigin: () => false
        }
    );

    assert.equal(result.status, 'declined');
    assert.equal(Object.hasOwn(result, 'requestUrl'), false);
});

test('returns approved template and expanded decisions for a reviewed service', async () => {
    const result = await createExpandedServiceDestination(
        'https://reviewed.example/data?bbox={bbox}',
        'https://reviewed.example/data?bbox=0,0,1,1',
        {
            ...baseOptions,
            reviewedOrigins: ['https://reviewed.example'],
            allowedPlaceholders: ['bbox']
        }
    );

    assert.equal(result.status, 'ready');
    assert.equal(result.requestUrl, 'https://reviewed.example/data?bbox=0,0,1,1');
    assert.equal(result.templateDecision.status, 'allowed');
    assert.equal(result.destinationDecision.status, 'allowed');
});
