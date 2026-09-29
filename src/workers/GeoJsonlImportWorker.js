'use strict';

importScripts('../libs/clarinet.js', '../modules/geoJsonlParser.js');

const operations = new Map();
const CHUNK_SIZE = 64 * 1024;
const PROGRESS_INTERVAL_MS = 100;

function post(requestId, type, detail = {}, transfer = []) {
    self.postMessage({ type, requestId, ...detail }, transfer);
}

function transferListForCompactGeometry(compact) {
    if (!compact) {
        return [];
    }
    return [
        compact.coordinates.buffer,
        compact.ringOffsets.buffer,
        compact.polygonOffsets.buffer,
        compact.bbox.buffer,
        compact.signedAreas.buffer
    ];
}

function nextTask() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

async function waitWhilePaused(operation, parser) {
    if (!operation.pauseRequested || operation.cancelRequested) {
        return;
    }

    operation.paused = true;
    const checkpoint = {
        byteOffset: operation.offset,
        recordsSeen: parser.recordsSeen
    };
    post(operation.requestId, 'checkpoint', { checkpoint });
    post(operation.requestId, 'paused', { checkpoint });
    await new Promise(resolve => {
        operation.resume = resolve;
    });
    operation.resume = null;
    operation.paused = false;
    operation.pauseRequested = false;
    post(operation.requestId, 'resumed', { checkpoint });
}

function progressDetail(operation, parser, phase = 'parsing') {
    return {
        phase,
        bytesRead: operation.offset,
        recordsSeen: parser.recordsSeen,
        validationOperations: parser.accounting.counters.validationOperations,
        knownTotalBytes: operation.file.size,
        counters: parser.accounting.snapshot()
    };
}

async function processFile(operation, message) {
    const parser = new GeoJsonlParser.IncrementalGeoJsonlParser({
        clarinet,
        mode: message.mode,
        boundaries: message.boundaries,
        overrideCapacity: message.overrideCapacity === true
    });
    const decoder = new TextDecoder();
    let lastProgress = 0;

    post(operation.requestId, 'started', {
        effectiveBoundaries: { ...(message.boundaries || {}) },
        overrideCapacity: message.overrideCapacity === true
    });

    try {
        while (operation.offset < operation.file.size && !parser.stopped) {
            if (operation.cancelRequested) {
                post(operation.requestId, 'cancelled', progressDetail(operation, parser, 'cancelled'));
                return;
            }

            await waitWhilePaused(operation, parser);
            if (operation.cancelRequested) {
                post(operation.requestId, 'cancelled', progressDetail(operation, parser, 'cancelled'));
                return;
            }

            const end = Math.min(operation.offset + (message.chunkSize || CHUNK_SIZE), operation.file.size);
            const chunk = await operation.file.slice(operation.offset, end).arrayBuffer();
            operation.offset = end;
            parser.write(decoder.decode(chunk, { stream: operation.offset < operation.file.size }));

            const now = performance.now();
            if (now - lastProgress >= PROGRESS_INTERVAL_MS || operation.offset === operation.file.size) {
                post(operation.requestId, 'progress', progressDetail(operation, parser));
                lastProgress = now;
            }
            await nextTask();
        }

        parser.write(decoder.decode());
        const result = parser.finish();
        if (operation.cancelRequested) {
            post(operation.requestId, 'cancelled', progressDetail(operation, parser, 'cancelled'));
            return;
        }

        if (message.mode === 'builder' && !result.candidate) {
            post(operation.requestId, 'failed', {
                diagnostic: {
                    category: 'schema',
                    reasonCode: 'no-supported-feature',
                    totalCount: result.invalidCount,
                    sampleIdentifiers: result.invalidSamples.map(sample => `record-${sample.recordNumber}`),
                    bytesScanned: result.bytesRead
                },
                summary: result
            });
            return;
        }
        if (message.mode === 'labeler' && result.validCount === 0) {
            post(operation.requestId, 'failed', {
                diagnostic: {
                    category: 'schema',
                    reasonCode: 'no-valid-features',
                    totalCount: result.invalidCount,
                    sampleIdentifiers: result.invalidSamples.map(sample => `record-${sample.recordNumber}`),
                    bytesScanned: result.bytesRead
                },
                summary: result
            });
            return;
        }

        const transfer = transferListForCompactGeometry(result.candidate);
        post(operation.requestId, 'ready', {
            stagedResult: {
                kind: message.mode === 'builder' ? 'geometry' : 'feature subset',
                sourceId: message.sourceId,
                commitToken: message.commitToken,
                payload: message.mode === 'builder' ? result.candidate : result.features,
                renderPayload: message.mode === 'builder'
                    ? result.candidate.rendererPayload
                    : { featureCount: result.features.length },
                warnings: result.invalidCount > 0 ? ['partial-record-set'] : [],
                diagnostics: result.invalidSamples
            },
            summary: {
                recordsSeen: result.recordsSeen,
                validCount: result.validCount,
                invalidCount: result.invalidCount,
                invalidSamples: result.invalidSamples,
                counters: result.counters,
                bytesRead: result.bytesRead
            }
        }, transfer);
    } catch (error) {
        if (error instanceof GeoJsonlParser.CapacityError || error.name === 'CapacityError') {
            post(operation.requestId, 'capacityExceeded', {
                dimension: error.dimension,
                observed: error.observed,
                supported: error.supported,
                bytesScanned: operation.offset,
                invalidRecordsBeforeCandidate: parser.invalidCount,
                sourceLabel: operation.file.name,
                counters: error.counters
            });
            return;
        }

        post(operation.requestId, 'failed', {
            diagnostic: {
                category: error.reasonCode === 'dangerous-key' ? 'dangerous-key' : 'syntax',
                reasonCode: error.reasonCode || 'worker-failure',
                totalCount: 1,
                sampleIdentifiers: [`record-${error.recordNumber || parser.recordNumber || 1}`],
                bytesScanned: operation.offset,
                messageArguments: { message: error.message }
            }
        });
    } finally {
        operations.delete(operation.requestId);
    }
}

self.onmessage = event => {
    const message = event.data || {};
    if (message.type === 'start') {
        if (!message.requestId || !(message.source instanceof Blob)) {
            post(message.requestId, 'failed', {
                diagnostic: {
                    category: 'schema',
                    reasonCode: 'invalid-start-message',
                    totalCount: 1,
                    sampleIdentifiers: [],
                    bytesScanned: 0
                }
            });
            return;
        }
        const operation = {
            requestId: message.requestId,
            file: message.source,
            offset: message.checkpoint?.byteOffset || 0,
            pauseRequested: false,
            paused: false,
            cancelRequested: false,
            resume: null
        };
        operations.set(message.requestId, operation);
        processFile(operation, message);
        return;
    }

    const operation = operations.get(message.requestId);
    if (!operation) {
        return;
    }
    if (message.type === 'pause') {
        operation.pauseRequested = true;
    } else if (message.type === 'resume') {
        operation.pauseRequested = false;
        if (operation.resume) {
            operation.resume();
        }
    } else if (message.type === 'cancel') {
        operation.cancelRequested = true;
        if (operation.resume) {
            operation.resume();
        }
    }
};
