const TERMINAL_MESSAGES = new Set([
    'ready',
    'failed',
    'capacityExceeded',
    'cancelled'
]);

export class GeoJsonlIntakeError extends Error {
    constructor(message, result) {
        super(message);
        this.name = 'GeoJsonlIntakeError';
        this.result = result;
    }
}

export function isMatchingReadyResult(operation, message) {
    return Boolean(
        operation
        && message?.type === 'ready'
        && message.requestId === operation.requestId
        && message.stagedResult?.commitToken === operation.commitToken
    );
}

export function confirmPartialGeoJsonlImport(summary, confirmAction = globalThis.confirm) {
    if (!summary || summary.invalidCount === 0) {
        return true;
    }
    if (typeof confirmAction !== 'function') {
        throw new TypeError('A confirmation action is required for a partial import.');
    }

    const examples = (summary.invalidSamples || [])
        .map(sample => `record ${sample.recordNumber}: ${sample.reasonCode}`)
        .join('\n');
    return confirmAction(
        `${summary.validCount} valid Feature records and ${summary.invalidCount} invalid records were found.\n\n`
        + `${examples}\n\nImport only the previewed valid records?`
    ) === true;
}

export function startGeoJsonlIntake(file, options = {}) {
    if (!(file instanceof Blob)) {
        throw new TypeError('GeoJSONL intake requires a File or Blob.');
    }

    const requestId = options.requestId ?? crypto.randomUUID();
    const sourceId = options.sourceId ?? requestId;
    const commitToken = options.commitToken ?? crypto.randomUUID();
    const worker = (options.workerFactory ?? (() => new Worker('workers/GeoJsonlImportWorker.js')))();
    let settled = false;

    const completion = new Promise((resolve, reject) => {
        worker.onmessage = event => {
            const message = event.data || {};
            if (message.requestId !== requestId) {
                return;
            }

            options.onMessage?.(message);
            if (!TERMINAL_MESSAGES.has(message.type) || settled) {
                return;
            }

            settled = true;
            worker.terminate();
            if (message.type === 'ready') {
                resolve(message);
            } else {
                reject(new GeoJsonlIntakeError(
                    message.type === 'capacityExceeded'
                        ? `The ${message.dimension} processing boundary was exceeded.`
                        : (message.diagnostic?.messageArguments?.message || 'GeoJSONL intake did not complete.'),
                    message
                ));
            }
        };
        worker.onerror = event => {
            if (settled) {
                return;
            }
            settled = true;
            worker.terminate();
            reject(new GeoJsonlIntakeError(event.message || 'GeoJSONL worker failed.', {
                type: 'failed',
                requestId
            }));
        };
    });

    worker.postMessage({
        type: 'start',
        requestId,
        source: file,
        sourceId,
        commitToken,
        mode: options.mode === 'builder' ? 'builder' : 'labeler',
        boundaries: options.boundaries,
        overrideCapacity: options.overrideCapacity === true,
        chunkSize: options.chunkSize
    });

    const send = type => {
        if (!settled) {
            worker.postMessage({ type, requestId });
        }
    };

    return Object.freeze({
        requestId,
        sourceId,
        commitToken,
        completion,
        pause: () => send('pause'),
        resume: () => send('resume'),
        cancel: () => send('cancel')
    });
}
