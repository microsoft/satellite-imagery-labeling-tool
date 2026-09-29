import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    CapacityOverrideAttempt,
    IntakeSession,
    createCapacityOverrideAttempt,
    createIntakeDiagnostic,
    createStagedResult,
    createUntrustedSource
} from '../../src/modules/intakeSession.js';

function source() {
    return createUntrustedSource({
        id: 'source-1',
        kind: 'local-file',
        displayName: 'area.geojsonl',
        format: 'geojsonl',
        foreground: true,
        automatic: false
    });
}

test('only accepts updates from the active request', () => {
    const session = new IntakeSession({ id: 'session-1', source: source(), requestId: 'request-1' });
    assert.equal(session.updateProgress('request-2', { bytesRead: 10 }), false);
    assert.equal(session.updateProgress('request-1', { bytesRead: 10 }), true);
    assert.equal(session.progress.bytesRead, 10);
});

test('stages and commits only a matching ready operation', () => {
    const session = new IntakeSession({ id: 'session-1', source: source(), requestId: 'request-1' });
    const staged = createStagedResult({
        kind: 'geometry',
        payload: { type: 'Polygon' },
        renderPayload: { positions: new Float64Array([0, 0]) },
        sourceId: 'source-1',
        commitToken: 'token-1'
    });

    session.stage('request-1', staged);
    assert.equal(session.canCommit('request-1', 'wrong-token'), false);
    assert.equal(session.canCommit('request-1', 'token-1'), true);
    assert.equal(session.commit('request-1', 'token-1'), staged);
    assert.equal(session.phase, 'completed');
});

test('cancellation discards staged state and checkpoints', () => {
    const session = new IntakeSession({ id: 'session-1', source: source(), requestId: 'request-1' });
    session.setCheckpoint('request-1', { record: 4 });
    session.stage('request-1', createStagedResult({
        kind: 'task',
        payload: {},
        renderPayload: {},
        sourceId: 'source-1',
        commitToken: 'token-1'
    }));

    session.cancel('request-1');
    assert.equal(session.phase, 'cancelled');
    assert.equal(session.checkpoint, null);
    assert.equal(session.stagedResult, null);
});

test('pause requires a validated checkpoint', () => {
    const session = new IntakeSession({ id: 'session-1', source: source(), requestId: 'request-1' });
    assert.equal(session.pause('request-1'), false);
    session.setCheckpoint('request-1', { record: 2 });
    assert.equal(session.pause('request-1'), true);
    assert.equal(session.phase, 'paused');
    assert.equal(session.resume('request-1'), true);
    assert.equal(session.phase, 'reading');
});

test('diagnostic samples are bounded while totals remain exact', () => {
    const diagnostic = createIntakeDiagnostic({
        category: 'schema',
        reasonCode: 'invalid-record',
        identifiers: Array.from({ length: 20 }, (_, index) => `record-${index + 1}`),
        totalCount: 20,
        bytesScanned: 200
    });

    assert.equal(diagnostic.totalCount, 20);
    assert.equal(diagnostic.sampleIdentifiers.length, 5);
});

test('capacity approval is explicit, one-use, and remains in memory', () => {
    const attempt = createCapacityOverrideAttempt({
        id: 'override-1',
        sourceId: 'source-1',
        originalSessionId: 'session-1',
        dimension: 'actualExpandedBytes',
        observedValue: 11,
        supportedValue: 10
    });

    assert.ok(attempt instanceof CapacityOverrideAttempt);
    assert.equal(attempt.acknowledged, false);
    assert.throws(() => attempt.markUsed());
    attempt.acknowledge();
    attempt.markUsed();
    assert.equal(attempt.used, true);
    assert.throws(() => attempt.markUsed());
});
