importScripts('../libs/turf.min.js');
importScripts('../modules/workerDestination.js');

let activeRequest = null;

onmessage = function (event) {
    const message = event.data ?? {};
    if (message.type === 'cancel') {
        if (!activeRequest || message.requestId === activeRequest.id) {
            activeRequest?.controller.abort();
            activeRequest = null;
        }
        return;
    }

    const requestId = message.requestId || crypto.randomUUID();
    activeRequest?.controller.abort();
    const request = {
        id: requestId,
        controller: new AbortController(),
        cancelled: false
    };
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
        ensureActive(request);
        const result = await filterNewData(received.data, options, request);
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
                conditionalIdentity: error.conditionalIdentity
            });
        } else {
            postMessage({
                type: 'failed',
                requestId: request.id,
                error: error.message || 'Unable to retrieve or process data from the custom data service.'
            });
        }
    } finally {
        if (isActive(request)) {
            activeRequest = null;
        }
    }
}

class CapacityError extends Error {
    constructor(dimension, observed, supported, conditionalIdentity) {
        super(`Custom data exceeded the ${dimension} boundary.`);
        this.name = 'CapacityError';
        this.dimension = dimension;
        this.observed = observed;
        this.supported = supported;
        this.conditionalIdentity = conditionalIdentity;
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
    try {
        enforceResponseBoundary(options, declaredBytes, conditionalIdentity);
    } catch (error) {
        await response.body?.cancel();
        throw error;
    }
    if (!response.body?.getReader) {
        const text = await response.text();
        const bytesRead = new TextEncoder().encode(text).byteLength;
        enforceResponseBoundary(options, bytesRead, conditionalIdentity);
        postProgress(request, 'received', 45, { bytesRead });
        return {
            data: JSON.parse(text),
            bytesRead
        };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
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
            text += decoder.decode(value, { stream: true });
            const percent = declaredBytes > 0
                ? Math.min(45, Math.floor(bytesRead / declaredBytes * 45))
                : Math.min(44, 5 + Math.floor(Math.log2(bytesRead + 1)));
            postProgress(request, 'receiving', percent, { bytesRead });
        }
    } catch (error) {
        await reader.cancel();
        throw error;
    }

    text += decoder.decode();
    ensureActive(request);
    const data = JSON.parse(text);
    text = '';
    postProgress(request, 'received', 45, { bytesRead });
    return { data, bytesRead };
}

async function filterNewData(data, options, request) {
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
        throw new TypeError('Custom data must be a GeoJSON FeatureCollection.');
    }

    const filtered = [];
    const existing = Array.isArray(options.existingGeoms) ? options.existingGeoms : [];
    let intersectionChecks = 0;

    for (let index = 0; index < data.features.length; index++) {
        ensureActive(request);
        const feature = data.features[index];
        const geometryType = feature?.geometry?.type || '';
        const allowed = (geometryType.includes('LineString') && options.allowLines)
            || (geometryType.includes('Polygon') && options.allowPolygons);

        if (allowed) {
            const inArea = !options.aoi?.type
                || turf.booleanIntersects(options.aoi, feature.geometry);
            intersectionChecks++;
            if (inArea) {
                let overlaps = false;
                for (const existingFeature of existing) {
                    ensureActive(request);
                    intersectionChecks++;
                    if (turf.booleanIntersects(existingFeature.geometry, feature.geometry)) {
                        overlaps = true;
                        break;
                    }
                }
                if (!overlaps) {
                    filtered.push(feature);
                }
            }
        }

        if (index % 50 === 0) {
            postProgress(request, 'filtering', 45 + Math.floor((index + 1) / Math.max(1, data.features.length) * 54), {
                featuresSeen: index + 1,
                intersectionChecks
            });
            await yieldToWorker();
        }
    }

    return {
        features: filtered,
        accounting: {
            featuresSeen: data.features.length,
            featuresAccepted: filtered.length,
            intersectionChecks
        }
    };
}

function postProgress(request, phase, percent, accounting) {
    if (isActive(request)) {
        postMessage({
            type: 'progress',
            requestId: request.id,
            phase,
            percent: Math.max(0, Math.min(99, percent)),
            accounting
        });
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
