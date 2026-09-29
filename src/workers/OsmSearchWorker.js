importScripts('../libs/turf.min.js');
importScripts('../libs/osmtogeojson.js');
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
    const request = { id: requestId, controller: new AbortController() };
    activeRequest = request;
    runRequest(request, message);
};

async function runRequest(request, options) {
    try {
        if (options.overrideCapacity === true || options.capacityOverride) {
            throw new TypeError('OSM search requests are not eligible for capacity overrides.');
        }
        const requestUrl = WorkerDestination.requireAllowedRequest(options);
        postProgress(request, 'requesting', 0, { featuresSeen: 0, intersectionChecks: 0 });
        const response = await fetch(requestUrl, {
            method: 'POST',
            mode: 'cors',
            cache: 'no-cache',
            redirect: 'error',
            signal: request.controller.signal,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: 'data=' + cleanQuery(options.query, options.center, options.bbox)
        });
        if (!response.ok) {
            throw new Error(`OSM request failed with status ${response.status}.`);
        }

        const osmData = await response.json();
        ensureActive(request);
        postProgress(request, 'converting', 35, { featuresSeen: 0, intersectionChecks: 0 });
        const converted = osmtogeojson(osmData);
        ensureActive(request);
        const result = await filterNewData(converted, options, request);
        ensureActive(request);
        postMessage({
            type: 'ready',
            requestId: request.id,
            data: result.features,
            accounting: result.accounting
        });
    } catch (error) {
        if (error.name === 'AbortError' || !isActive(request)) {
            postMessage({ type: 'cancelled', requestId: request.id });
        } else {
            postMessage({
                type: 'failed',
                requestId: request.id,
                error: error.message || 'Unable to retrieve or process data from Overpass.'
            });
        }
    } finally {
        if (isActive(request)) {
            activeRequest = null;
        }
    }
}

function cleanQuery(query, center, bbox) {
    if (query.indexOf('{{center}}') > -1) {
        query = query.replace(/\{\{center\}\}/gi, `${center[1]},${center[0]}`);
    }
    if (query.indexOf('{{bbox}}') > -1) {
        query = query.replace(/\{\{bbox\}\}/gi, `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`);
    }
    return encodeURIComponent(
        query
            .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '')
            .replace(/[\s\t]*\n[\s\t]*/gi, '')
    );
}

async function filterNewData(data, options, request) {
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
        throw new TypeError('Converted OSM data must be a GeoJSON FeatureCollection.');
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
            postProgress(request, 'filtering', 35 + Math.floor((index + 1) / Math.max(1, data.features.length) * 64), {
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
