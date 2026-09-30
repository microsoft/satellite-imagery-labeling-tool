importScripts('../libs/turf.min.js');
importScripts('../libs/clarinet.js');
importScripts('../modules/workerDestination.js');
importScripts('../modules/workerProtocol.js');

let activeRequest = null;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

onmessage = function (event) {
    const message = event.data ?? {};
    try {
        WorkerProtocol.validateWorkerCommand({
            ...message,
            type: message.type ?? 'start'
        });
    } catch (error) {
        postMessage({
            type: 'failed',
            requestId: typeof message.requestId === 'string' && message.requestId
                ? message.requestId
                : 'invalid-request',
            error: error.message
        });
        return;
    }
    if (message.type === 'cancel') {
        if (!activeRequest || message.requestId === activeRequest.id) {
            activeRequest?.controller.abort();
            activeRequest = null;
        }
        return;
    }
    if (message.type === 'pause' || message.type === 'resume') {
        postMessage({
            type: 'pauseUnsupported',
            requestId: message.requestId
        });
        return;
    }

    const requestId = message.requestId;
    activeRequest?.controller.abort();
    const request = {
        id: requestId,
        controller: new AbortController(),
        cancelled: false
    };
    request.progressReporters = new Map();
    activeRequest = request;
    runRequest(request, message);
};

async function runRequest(request, options) {
    try {
        const requestUrl = WorkerDestination.requireAllowedRequest(options);
        if (options.overrideCapacity === true
            && options.capacityOverride?.used !== true) {
            throw new TypeError('A used capacity override is required for an unbounded retry.');
        }
        validateConditionalIdentity(options);
        postProgress(request, 'requesting', 0, { bytesRead: 0, featuresSeen: 0 });
        const headers = {};
        if (options.overrideCapacity === true
            && options.conditionalIdentity?.type === 'etag') {
            headers['If-Match'] = options.conditionalIdentity.value;
        } else if (options.overrideCapacity === true
            && options.conditionalIdentity?.type === 'last-modified') {
            headers['If-Unmodified-Since'] = options.conditionalIdentity.value;
        }
        const response = await fetch(requestUrl, {
            mode: 'cors',
            cache: 'no-cache',
            redirect: 'error',
            signal: request.controller.signal,
            headers
        });
        if (response.status === 412) {
            throw new Error('Custom data changed before the approved retry could complete.');
        }
        if (!response.ok) {
            throw new Error(`Custom data request failed with status ${response.status}.`);
        }

        const conditionalIdentity = getConditionalIdentity(response);
        if (options.overrideCapacity === true && options.conditionalIdentity
            && (conditionalIdentity?.type !== options.conditionalIdentity.type
                || conditionalIdentity.value !== options.conditionalIdentity.value)) {
            throw new Error('Custom data identity changed before the approved retry completed.');
        }
        const received = await readJsonResponse(
            response,
            request,
            options,
            conditionalIdentity
        );
        request.declaredBytes = received.declaredBytes ?? received.bytesRead;
        ensureActive(request);
        request.featureTotal = Array.isArray(received.data?.features)
            ? received.filterAccounting.featuresSeen
            : 0;
        const result = {
            features: received.data.features,
            accounting: received.filterAccounting
        };
        postProgress(request, 'filtered', 99, {
            featuresSeen: result.accounting.featuresSeen,
            featuresAccepted: result.accounting.featuresAccepted,
            intersectionChecks: result.accounting.intersectionChecks
        });
        result.accounting.responseBytes = received.bytesRead;
        ensureActive(request);
        postMessage({
            type: 'ready',
            requestId: request.id,
            data: result.features,
            accounting: result.accounting,
            conditionalIdentity
        });
    } catch (error) {
        if (error.name === 'AbortError' || !isActive(request)) {
            postMessage({ type: 'cancelled', requestId: request.id });
        } else if (error.name === 'CapacityError') {
            postMessage({
                type: 'capacityExceeded',
                requestId: request.id,
                dimension: error.dimension,
                observed: error.observed,
                supported: error.supported,
                conditionalIdentity: error.conditionalIdentity,
                crossings: error.crossings
            });
        } else {
            postMessage({
                type: 'failed',
                requestId: request.id,
                error: error.message || 'Unable to retrieve or process data from the custom data service.'
            });
        }
    } finally {
        for (const reporter of request.progressReporters.values()) {
            reporter.stop();
        }
        if (isActive(request)) {
            activeRequest = null;
        }
    }
}

class CapacityError extends Error {
    constructor(dimension, observed, supported, conditionalIdentity, crossings = null) {
        super(`Custom data exceeded the ${dimension} boundary.`);
        this.name = 'CapacityError';
        this.dimension = dimension;
        this.observed = observed;
        this.supported = supported;
        this.conditionalIdentity = conditionalIdentity;
        this.crossings = crossings ?? [{ dimension, observed, supported }];
    }
}

function validateConditionalIdentity(options) {
    const identity = options.conditionalIdentity;
    if (!identity) {
        return;
    }
    if (options.overrideCapacity !== true
        || !['etag', 'last-modified'].includes(identity.type)
        || typeof identity.value !== 'string'
        || identity.value.length === 0
        || /[\r\n]/.test(identity.value)) {
        throw new TypeError('The conditional remote identity is invalid.');
    }
}

function getConditionalIdentity(response) {
    const etag = response.headers.get('etag');
    if (etag && !etag.trim().startsWith('W/')) {
        return { type: 'etag', value: etag };
    }
    const lastModified = response.headers.get('last-modified');
    return lastModified
        ? { type: 'last-modified', value: lastModified }
        : null;
}

function enforceResponseBoundary(options, observed, conditionalIdentity) {
    const supported = options.boundaries?.responseBytes;
    if (options.overrideCapacity !== true
        && Number.isFinite(supported)
        && observed > supported) {
        throw new CapacityError(
            'responseBytes',
            observed,
            supported,
            conditionalIdentity
        );
    }
}

async function readJsonResponse(response, request, options, conditionalIdentity) {
    const declaredBytes = Number(response.headers.get('content-length')) || 0;
    request.declaredBytes = declaredBytes;
    try {
        enforceResponseBoundary(options, declaredBytes, conditionalIdentity);
    } catch (error) {
        await response.body?.cancel();
        throw error;
    }
    if (!response.body?.getReader) {
        throw new Error('Custom data intake requires a streaming response body.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const featureFilter = createFeatureFilter(options, request);
    const parser = createIncrementalJsonParser(featureFilter.consider);
    let bytesRead = 0;
    try {
        while (true) {
            ensureActive(request);
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            bytesRead += value.byteLength;
            enforceResponseBoundary(options, bytesRead, conditionalIdentity);
            const decoded = decoder.decode(value, { stream: true });
            for (let offset = 0; offset < decoded.length; offset += 64 * 1024) {
                ensureActive(request);
                parser.write(decoded.slice(offset, offset + 64 * 1024));
                await yieldToWorker();
            }
            const percent = declaredBytes > 0
                ? Math.min(45, Math.floor(bytesRead / declaredBytes * 45))
                : Math.min(44, 5 + Math.floor(Math.log2(bytesRead + 1)));
            postProgress(request, 'receiving', percent, {
                bytesRead,
                featuresSeen: featureFilter.accounting.featuresSeen,
                intersectionChecks: featureFilter.accounting.intersectionChecks
            });
        }
    } catch (error) {
        await reader.cancel();
        throw error;
    }

    parser.write(decoder.decode());
    ensureActive(request);
    const data = parser.finish();
    postProgress(request, 'received', 45, { bytesRead });
    return {
        data,
        bytesRead,
        declaredBytes,
        filterAccounting: featureFilter.accounting
    };
}

function createIncrementalJsonParser(considerFeature) {
    const parser = clarinet.parser();
    const stack = [];
    let root;
    let completed = false;

    const append = value => {
        if (stack.length === 0) {
            if (root !== undefined) {
                throw new SyntaxError('Custom data must contain one JSON value.');
            }
            root = value;
            return;
        }
        const parent = stack[stack.length - 1];
        if (parent.type === 'array') {
            parent.value.push(value);
        } else {
            if (parent.key === null) {
                throw new SyntaxError('Custom data contains an object value without a key.');
            }
            parent.value[parent.key] = value;
            parent.key = null;
        }
    };

    parser.onopenobject = firstKey => {
        if (DANGEROUS_KEYS.has(firstKey)) {
            throw new SyntaxError(`Custom data contains the disallowed key ${firstKey}.`);
        }
        const value = {};
        append(value);
        stack.push({ type: 'object', value, key: firstKey ?? null });
    };
    parser.onkey = key => {
        if (DANGEROUS_KEYS.has(key)) {
            throw new SyntaxError(`Custom data contains the disallowed key ${key}.`);
        }
        stack[stack.length - 1].key = key;
    };
    parser.onopenarray = () => {
        const parent = stack[stack.length - 1];
        const isFeatureArray = stack.length === 1
            && parent?.type === 'object'
            && parent.value === root
            && parent.key === 'features';
        const value = [];
        append(value);
        stack.push({ type: 'array', value, key: null, isFeatureArray });
    };
    parser.onvalue = value => {
        const parent = stack[stack.length - 1];
        append(value);
        if (parent?.isFeatureArray && considerFeature(value) !== true) {
            parent.value.pop();
        }
    };
    parser.oncloseobject = () => {
        const frame = stack[stack.length - 1];
        const parent = stack[stack.length - 2];
        if (parent?.isFeatureArray && considerFeature(frame.value) !== true) {
            parent.value.pop();
        }
        stack.pop();
    };
    parser.onclosearray = () => {
        stack.pop();
    };
    parser.onend = () => {
        completed = true;
    };
    parser.onerror = error => {
        throw error;
    };

    return {
        write(value) {
            if (value) {
                parser.write(value);
            }
        },
        finish() {
            parser.close();
            if (!completed || root === undefined || stack.length !== 0) {
                throw new SyntaxError('Custom data response is incomplete.');
            }
            if (!root || root.type !== 'FeatureCollection' || !Array.isArray(root.features)) {
                throw new TypeError('Custom data must be a GeoJSON FeatureCollection.');
            }
            return root;
        }
    };
}

function createFeatureFilter(options, request) {
    const existing = Array.isArray(options.existingGeoms) ? options.existingGeoms : [];
    const accounting = {
        featuresSeen: 0,
        featuresAccepted: 0,
        peakRetainedFeatures: 0,
        intersectionChecks: 0
    };

    return {
        accounting,
        consider(feature) {
            ensureActive(request);
            accounting.featuresSeen++;
            const geometryType = feature?.geometry?.type || '';
            const allowed = (geometryType.includes('LineString') && options.allowLines)
                || (geometryType.includes('Polygon') && options.allowPolygons);

            if (!allowed) {
                return false;
            }
            const inArea = !options.aoi?.type
                || turf.booleanIntersects(options.aoi, feature.geometry);
            accounting.intersectionChecks++;
            if (!inArea) {
                return false;
            }
            for (const existingFeature of existing) {
                ensureActive(request);
                accounting.intersectionChecks++;
                if (turf.booleanIntersects(existingFeature.geometry, feature.geometry)) {
                    return false;
                }
            }
            accounting.featuresAccepted++;
            accounting.peakRetainedFeatures = Math.max(
                accounting.peakRetainedFeatures,
                accounting.featuresAccepted
            );
            return true;
        }
    };
}

function postProgress(request, phase, percent, accounting) {
    if (isActive(request)) {
        const receiving = phase === 'requesting' || phase === 'receiving' || phase === 'received';
        const unit = receiving ? 'bytes' : 'features';
        let reporter = request.progressReporters.get(unit);
        if (!reporter) {
            reporter = WorkerProtocol.createProgressReporter({
                requestId: request.id,
                operation: 'custom-data',
                unit,
                post: progressMessage => postMessage(progressMessage)
            });
            request.progressReporters.set(unit, reporter);
        }
        const completed = receiving
            ? (accounting.bytesRead ?? 0)
            : (accounting.featuresSeen ?? 0);
        reporter.report({
            phase,
            completed,
            total: receiving
                ? Math.max(completed, request.declaredBytes ?? completed)
                : Math.max(completed, request.featureTotal ?? completed),
            percent: Math.max(0, Math.min(99, percent)),
            accounting,
            counters: accounting
        }, phase === 'received');
    }
}

function ensureActive(request) {
    if (!isActive(request) || request.controller.signal.aborted) {
        throw new DOMException('The request was cancelled.', 'AbortError');
    }
}

function isActive(request) {
    return activeRequest === request;
}

function yieldToWorker() {
    return new Promise(resolve => setTimeout(resolve, 0));
}
