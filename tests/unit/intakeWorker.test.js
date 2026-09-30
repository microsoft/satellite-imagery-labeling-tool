import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    GeoJsonlIntakeError,
    startGeoJsonlIntake
} from '../../src/modules/geoJsonlIntake.js';

class FakeWorker {
    constructor() {
        this.messages = [];
        this.terminated = false;
    }

    postMessage(message) {
        this.messages.push(message);
    }

    terminate() {
        this.terminated = true;
    }

    emit(data) {
        this.onmessage?.({ data });
    }
}

function operation(options = {}) {
    const worker = new FakeWorker();
    const intake = startGeoJsonlIntake(new Blob(['{}']), {
        requestId: 'request-current',
        sourceId: 'source-1',
        commitToken: 'commit-1',
        workerFactory: () => worker,
        ...options
    });
    return { intake, worker };
}

test('dispatches a request-scoped start contract and control messages', async () => {
    const { intake, worker } = operation({ mode: 'builder', boundaries: { positions: 4 } });

    assert.deepEqual(worker.messages[0], {
        type: 'start',
        requestId: 'request-current',
        source: worker.messages[0].source,
        sourceId: 'source-1',
        commitToken: 'commit-1',
        mode: 'builder',
        boundaries: { positions: 4 },
        overrideCapacity: false,
        chunkSize: undefined
    });

    intake.pause();
    intake.resume();
    intake.cancel();
    assert.deepEqual(
        worker.messages.slice(1).map(message => message.type),
        ['pause', 'resume', 'cancel']
    );
    worker.emit({ type: 'cancelled', requestId: 'request-current' });
    await assert.rejects(intake.completion, GeoJsonlIntakeError);
});

test('ignores stale messages and resolves only the active transferable ready result', async () => {
    const seen = [];
    const { intake, worker } = operation({ onMessage: message => seen.push(message.type) });

    worker.emit({ type: 'ready', requestId: 'request-stale' });
    worker.emit({
        type: 'progress',
        requestId: 'request-current',
        operation: 'geojsonl-intake',
        phase: 'parsing',
        unit: 'bytes',
        completed: 4,
        total: 10,
        counters: { bytesRead: 4 },
        bytesRead: 4
    });
    worker.emit({
        type: 'ready',
        requestId: 'request-current',
        stagedResult: {
            kind: 'geometry',
            sourceId: 'source-1',
            commitToken: 'commit-1',
            payload: { coordinates: new Float64Array([0, 0]) },
            renderPayload: { positionCount: 1 },
            warnings: [],
            diagnostics: []
        },
        summary: {
            recordsSeen: 1,
            validCount: 1,
            invalidCount: 0,
            invalidSamples: [],
            counters: { positions: 1 },
            bytesRead: 8
        }
    });

    const result = await intake.completion;
    assert.equal(result.stagedResult.commitToken, 'commit-1');
    assert.deepEqual(seen, ['progress', 'ready']);
    assert.equal(worker.terminated, true);
});

test('rejects cancellation, failure, and capacity as non-success outcomes', async () => {
    for (const terminal of [
        { type: 'cancelled' },
        {
            type: 'failed',
            diagnostic: {
                category: 'schema',
                reasonCode: 'bad-input',
                totalCount: 1,
                sampleIdentifiers: [],
                bytesScanned: 0,
                messageArguments: { message: 'bad input' }
            }
        },
        {
            type: 'capacityExceeded',
            dimension: 'positions',
            observed: 4,
            supported: 3,
            crossings: [{ dimension: 'positions', observed: 4, supported: 3 }]
        }
    ]) {
        const { intake, worker } = operation();
        worker.emit({ ...terminal, requestId: 'request-current' });
        await assert.rejects(intake.completion, GeoJsonlIntakeError);
        assert.equal(worker.terminated, true);
    }
});

test('rejects malformed active worker payloads before they reach consumers', async () => {
    const malformedEvents = [
        {
            type: 'progress',
            phase: 'parsing',
            completed: 1
        },
        {
            type: 'ready',
            stagedResult: null
        },
        {
            type: 'paused',
            checkpoint: {}
        },
        {
            type: 'failed',
            error: ''
        }
    ];

    for (const malformed of malformedEvents) {
        const consumed = [];
        const { intake, worker } = operation({
            onMessage: message => consumed.push(message)
        });
        worker.emit({
            ...malformed,
            requestId: 'request-current'
        });

        await assert.rejects(intake.completion, GeoJsonlIntakeError);
        assert.deepEqual(consumed, []);
        assert.equal(worker.terminated, true);
    }
});

test('silence watchdog cancels, discards, and marks the operation retry eligible', async () => {
    const { intake, worker } = operation({ silenceTimeoutMs: 20 });

    await assert.rejects(
        intake.completion,
        error => error instanceof GeoJsonlIntakeError
            && error.result.type === 'unresponsive'
            && error.retryEligible === true
    );
    assert.equal(worker.messages.at(-1).type, 'cancel');
    assert.equal(worker.terminated, true);
});
