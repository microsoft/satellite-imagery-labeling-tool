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

test('dispatches a request-scoped start contract and control messages', () => {
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
});

test('ignores stale messages and resolves only the active transferable ready result', async () => {
    const seen = [];
    const { intake, worker } = operation({ onMessage: message => seen.push(message.type) });

    worker.emit({ type: 'ready', requestId: 'request-stale' });
    worker.emit({
        type: 'progress',
        requestId: 'request-current',
        bytesRead: 4
    });
    worker.emit({
        type: 'ready',
        requestId: 'request-current',
        stagedResult: {
            sourceId: 'source-1',
            commitToken: 'commit-1',
            payload: { coordinates: new Float64Array([0, 0]) }
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
        { type: 'failed', diagnostic: { messageArguments: { message: 'bad input' } } },
        { type: 'capacityExceeded', dimension: 'positions' }
    ]) {
        const { intake, worker } = operation();
        worker.emit({ ...terminal, requestId: 'request-current' });
        await assert.rejects(intake.completion, GeoJsonlIntakeError);
        assert.equal(worker.terminated, true);
    }
});
