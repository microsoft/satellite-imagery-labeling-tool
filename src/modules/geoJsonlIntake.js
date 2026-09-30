import './workerProtocol.js';

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
    const dimensions = Object.entries(summary.counters ?? {})
        .map(([name, value]) => `${name}=${value}`)
        .join(', ');
    return confirmAction(
        `${summary.validCount} valid Feature records and ${summary.invalidCount} invalid records were found.\n\n`
        + `${examples}\n\n`
        + `${dimensions ? `Measured dimensions: ${dimensions}\n\n` : ''}`
        + 'Import only the previewed valid records?'
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
    let rejectCompletion;
    const watchdog = globalThis.WorkerProtocol.createWorkerSilenceWatchdog({
        timeoutMs: options.silenceTimeoutMs ?? 1000,
        onSilence: () => {
            if (settled) {
                return;
            }
            worker.postMessage({ type: 'cancel', requestId });
            settled = true;
            worker.terminate();
            const error = new GeoJsonlIntakeError(
                'GeoJSONL worker stopped responding. The staged import was discarded and may be retried.',
                { type: 'unresponsive', requestId }
            );
            error.retryEligible = true;
            rejectCompletion(error);
        }
    });

    const completion = new Promise((resolve, reject) => {
        rejectCompletion = reject;
        worker.onmessage = event => {
            const rawMessage = event.data || {};
            if (rawMessage.requestId !== requestId) {
                return;
            }
            let message;
            try {
                message = globalThis.WorkerProtocol.validateWorkerEvent(rawMessage);
            } catch (error) {
                if (!settled) {
                    settled = true;
                    watchdog.stop();
                    worker.terminate();
                    reject(new GeoJsonlIntakeError(error.message, {
                        type: 'failed',
                        requestId
                    }));
                }
                return;
            }
            watchdog.touch();

            options.onMessage?.(message);
            if (!TERMINAL_MESSAGES.has(message.type) || settled) {
                return;
            }

            settled = true;
            watchdog.stop();
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
            watchdog.stop();
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
