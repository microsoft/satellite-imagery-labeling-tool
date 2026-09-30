import assert from 'node:assert/strict';
import { test } from 'node:test';

await import('../../src/modules/workerProtocol.js');

const {
    createProgressReporter,
    createWorkerSilenceWatchdog,
    validateWorkerEvent
} = globalThis.WorkerProtocol;

test('validates strict progress and complete event-specific payloads', () => {
    assert.deepEqual(validateWorkerEvent({
        type: 'progress',
        requestId: 'request-1',
        operation: 'archive-intake',
        phase: 'validating',
        unit: 'entries',
        completed: 2,
        total: 4,
        counters: { bytesRead: 10 }
    }), {
        type: 'progress',
        requestId: 'request-1',
        operation: 'archive-intake',
        phase: 'validating',
        unit: 'entries',
        completed: 2,
        total: 4,
        counters: { bytesRead: 10 }
    });

    assert.throws(() => validateWorkerEvent({
        type: 'progress',
        requestId: 'request-1',
        phase: 'validating',
        completed: 1
    }), TypeError);
    assert.throws(() => validateWorkerEvent({
        type: 'ready',
        requestId: 'request-1',
        stagedResult: null
    }), TypeError);
    assert.throws(() => validateWorkerEvent({
        type: 'ready',
        requestId: 'request-1',
        stagedProject: {}
    }), TypeError);
    assert.throws(() => validateWorkerEvent({
        type: 'ready',
        requestId: 'request-1',
        data: null
    }), TypeError);
    assert.throws(() => validateWorkerEvent({
        type: 'failed',
        requestId: 'request-1',
        error: ''
    }), TypeError);
    assert.throws(() => validateWorkerEvent({
        type: 'failed',
        requestId: 'request-1',
        diagnostic: {
            category: 'schema'
        }
    }), TypeError);
    for (const type of ['checkpoint', 'paused', 'resumed']) {
        assert.throws(() => validateWorkerEvent({
            type,
            requestId: 'request-1',
            checkpoint: {}
        }), TypeError);
    }
    assert.throws(() => validateWorkerEvent({
        type: 'capacityExceeded',
        requestId: 'request-1',
        dimension: 'positions',
        observed: 4,
        supported: 3,
        crossings: []
    }), TypeError);

    const checkpoint = { byteOffset: 64, recordsSeen: 2 };
    for (const type of ['checkpoint', 'paused', 'resumed']) {
        assert.deepEqual(validateWorkerEvent({
            type,
            requestId: 'request-1',
            checkpoint
        }).checkpoint, checkpoint);
    }
    assert.equal(validateWorkerEvent({
        type: 'ready',
        requestId: 'request-1',
        data: [],
        accounting: { featuresSeen: 0 }
    }).type, 'ready');
    assert.equal(validateWorkerEvent({
        type: 'failed',
        requestId: 'request-1',
        diagnostic: {
            category: 'schema',
            reasonCode: 'invalid-record',
            totalCount: 1,
            sampleIdentifiers: [],
            bytesScanned: 8
        }
    }).type, 'failed');
});

test('progress reporters enforce monotonic counters and bounded cadence', () => {
    let now = 0;
    const messages = [];
    const reporter = createProgressReporter({
        requestId: 'request-1',
        operation: 'custom-data',
        unit: 'bytes',
        minIntervalMs: 100,
        maxIntervalMs: 1000,
        now: () => now,
        post: message => messages.push(message)
    });

    assert.equal(reporter.report({
        phase: 'receiving',
        completed: 1,
        total: 10,
        counters: { bytesRead: 1 }
    }), true);
    now = 50;
    assert.equal(reporter.report({
        phase: 'receiving',
        completed: 2,
        total: 10,
        counters: { bytesRead: 2 }
    }), false);
    now = 100;
    assert.equal(reporter.report({
        phase: 'receiving',
        completed: 2,
        total: 10,
        counters: { bytesRead: 2 }
    }), true);
    assert.throws(() => reporter.report({
        phase: 'receiving',
        completed: 1,
        total: 10,
        counters: { bytesRead: 1 }
    }, true), TypeError);
    assert.equal(messages.length, 2);
    reporter.stop();
});

test('silence watchdog cancels once and can be safely re-armed', async () => {
    let silenceCount = 0;
    const watchdog = createWorkerSilenceWatchdog({
        timeoutMs: 20,
        onSilence: () => {
            silenceCount++;
        }
    });

    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(silenceCount, 1);
    watchdog.touch();
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(silenceCount, 2);
    watchdog.stop();
});
