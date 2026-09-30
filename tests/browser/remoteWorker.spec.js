import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/tests/fixtures/blank.html');
});

test('custom-data worker rejects missing destination decisions before fetch', async ({ page }) => {
    let requestCount = 0;
    await page.route('https://data.example/**', route => {
        requestCount += 1;
        return route.abort();
    });

    const result = await page.evaluate(() => new Promise(resolve => {
        const worker = new Worker('/src/workers/CustomDataWorker.js');
        worker.onmessage = event => {
            if (event.data.type !== 'progress') {
                worker.terminate();
                resolve(event.data);
            }
        };
        worker.postMessage({
            requestId: 'missing-decision',
            requestUrl: 'https://data.example/items'
        });
    }));

    expect(result.type).toBe('failed');
    expect(requestCount).toBe(0);
});

test('custom-data capacity retry preserves ETag identity and repeats validation', async ({ page }) => {
    const body = JSON.stringify({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Polygon',
                coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
            }
        }]
    });
    const requestHeaders = [];
    await page.route(/^https:\/\/data\.example\/items\?bbox=0,0,1,1$/, route => {
        if (route.request().method() === 'OPTIONS') {
            return route.fulfill({
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET',
                    'Access-Control-Allow-Headers': 'If-Match'
                }
            });
        }
        requestHeaders.push(route.request().headers());
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Expose-Headers': 'ETag, Content-Length',
                'Content-Length': String(Buffer.byteLength(body)),
                ETag: '"version-1"'
            },
            body
        });
    });

    const result = await page.evaluate(async () => {
        const {
            createDestinationDecision,
            requireAllowedDestination,
            validateExpandedDestination
        } = await import('/src/modules/remoteDestination.js');
        const templateDecision = requireAllowedDestination(createDestinationDecision(
            'https://data.example/items?bbox={bbox}',
            {
                baseUrl: location.href,
                currentOrigin: location.origin,
                reviewedOrigins: ['https://data.example'],
                allowedPlaceholders: ['bbox'],
                redirectPolicy: 'block-all'
            }
        ));
        const destinationDecision = requireAllowedDestination(validateExpandedDestination(
            templateDecision,
            'https://data.example/items?bbox=0,0,1,1',
            {
                baseUrl: location.href,
                currentOrigin: location.origin,
                reviewedOrigins: ['https://data.example']
            }
        ));
        const worker = new Worker('/src/workers/CustomDataWorker.js');
        const run = message => new Promise(resolve => {
            worker.onmessage = event => {
                if (event.data.type !== 'progress') {
                    resolve(event.data);
                }
            };
            worker.postMessage(message);
        });
        const common = {
            templateDecision,
            destinationDecision,
            requestUrl: destinationDecision.resolvedUrl,
            bbox: [0, 0, 1, 1],
            aoi: {},
            existingGeoms: [],
            allowLines: false,
            allowPolygons: true,
            boundaries: { responseBytes: 1 }
        };
        const first = await run({
            ...common,
            requestId: 'custom-first'
        });
        const retry = await run({
            ...common,
            requestId: 'custom-retry',
            overrideCapacity: true,
            capacityOverride: { id: 'override-1', used: true },
            conditionalIdentity: first.conditionalIdentity
        });
        worker.terminate();
        return {
            first,
            retry: {
                type: retry.type,
                accepted: retry.accounting?.featuresAccepted,
                responseBytes: retry.accounting?.responseBytes
            }
        };
    });

    expect(result.first).toMatchObject({
        type: 'capacityExceeded',
        requestId: 'custom-first',
        dimension: 'responseBytes',
        supported: 1,
        conditionalIdentity: {
            type: 'etag',
            value: '"version-1"'
        }
    });
    expect(result.retry).toEqual({
        type: 'ready',
        accepted: 1,
        responseBytes: Buffer.byteLength(body)
    });
    expect(requestHeaders).toHaveLength(2);
    expect(requestHeaders[0]['if-match']).toBeUndefined();
    expect(requestHeaders[1]['if-match']).toBe('"version-1"');
});

test('custom-data override keeps content validation enabled', async ({ page }) => {
    await page.route('https://data.example/invalid', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
            'Access-Control-Allow-Origin': '*'
        },
        body: '{"type":"FeatureCollection","features":"invalid"}'
    }));

    const result = await page.evaluate(async () => {
        const { createDestinationDecision } =
            await import('/src/modules/remoteDestination.js');
        const destination = createDestinationDecision(
            'https://data.example/invalid',
            {
                baseUrl: location.href,
                currentOrigin: location.origin,
                reviewedOrigins: ['https://data.example'],
                redirectPolicy: 'block-all'
            }
        );
        return new Promise(resolve => {
            const worker = new Worker('/src/workers/CustomDataWorker.js');
            worker.onmessage = event => {
                if (event.data.type !== 'progress') {
                    worker.terminate();
                    resolve(event.data);
                }
            };
            worker.postMessage({
                requestId: 'custom-invalid-retry',
                templateDecision: destination,
                destinationDecision: destination,
                requestUrl: destination.resolvedUrl,
                bbox: [0, 0, 1, 1],
                aoi: {},
                existingGeoms: [],
                allowLines: true,
                allowPolygons: true,
                boundaries: { responseBytes: 1 },
                overrideCapacity: true,
                capacityOverride: { id: 'override-1', used: true }
            });
        });
    });

    expect(result.type).toBe('failed');
    expect(result.error).toContain('FeatureCollection');
});

test('custom-data parsing incrementally drops rejected features instead of retaining the response', async ({ page }) => {
    const features = Array.from({ length: 100 }, (_, index) => ({
        type: 'Feature',
        properties: { id: `point-${index}` },
        geometry: { type: 'Point', coordinates: [index, index] }
    }));
    features.push({
        type: 'Feature',
        properties: { id: 'accepted-polygon' },
        geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
        }
    });
    await page.route('https://data.example/incremental', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ type: 'FeatureCollection', features })
    }));

    const result = await page.evaluate(async () => {
        const { createDestinationDecision } =
            await import('/src/modules/remoteDestination.js');
        const destination = createDestinationDecision(
            'https://data.example/incremental',
            {
                baseUrl: location.href,
                currentOrigin: location.origin,
                reviewedOrigins: ['https://data.example'],
                redirectPolicy: 'block-all'
            }
        );
        return new Promise(resolve => {
            const worker = new Worker('/src/workers/CustomDataWorker.js');
            worker.onmessage = event => {
                if (event.data.type === 'ready' || event.data.type === 'failed') {
                    worker.terminate();
                    resolve(event.data);
                }
            };
            worker.postMessage({
                requestId: 'custom-incremental',
                templateDecision: destination,
                destinationDecision: destination,
                requestUrl: destination.resolvedUrl,
                bbox: [0, 0, 1, 1],
                aoi: {},
                existingGeoms: [],
                allowLines: false,
                allowPolygons: true,
                boundaries: {}
            });
        });
    });

    expect(result.type).toBe('ready');
    expect(result.data).toHaveLength(1);
    expect(result.accounting).toMatchObject({
        featuresSeen: 101,
        featuresAccepted: 1,
        peakRetainedFeatures: 1
    });
});

test('OSM search rejects capacity overrides before fetch', async ({ page }) => {
    let requestCount = 0;
    await page.route('https://overpass.example/**', route => {
        requestCount += 1;
        return route.abort();
    });

    const result = await page.evaluate(async () => {
        const { createDestinationDecision } =
            await import('/src/modules/remoteDestination.js');
        const destination = createDestinationDecision(
            'https://overpass.example/interpreter',
            {
                baseUrl: location.href,
                currentOrigin: location.origin,
                reviewedOrigins: ['https://overpass.example'],
                redirectPolicy: 'block-all'
            }
        );
        return new Promise(resolve => {
            const worker = new Worker('/src/workers/OsmSearchWorker.js');
            worker.onmessage = event => {
                if (event.data.type !== 'progress') {
                    worker.terminate();
                    resolve(event.data);
                }
            };
            worker.postMessage({
                requestId: 'osm-override',
                templateDecision: destination,
                destinationDecision: destination,
                requestUrl: destination.resolvedUrl,
                overrideCapacity: true,
                capacityOverride: { id: 'not-allowed', used: true }
            });
        });
    });

    expect(result.type).toBe('failed');
    expect(result.error).toContain('not eligible');
    expect(requestCount).toBe(0);
});

test('OSM search requires and consumes an allowed destination decision', async ({ page }) => {
    const methods = [];
    await page.route('https://overpass.example/interpreter', route => {
        methods.push(route.request().method());
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: {
                'Access-Control-Allow-Origin': '*'
            },
            body: '{"elements":[]}'
        });
    });

    const result = await page.evaluate(async () => {
        const { createDestinationDecision } =
            await import('/src/modules/remoteDestination.js');
        const destination = createDestinationDecision(
            'https://overpass.example/interpreter',
            {
                baseUrl: location.href,
                currentOrigin: location.origin,
                reviewedOrigins: ['https://overpass.example'],
                redirectPolicy: 'block-all'
            }
        );
        return new Promise(resolve => {
            const worker = new Worker('/src/workers/OsmSearchWorker.js');
            worker.onmessage = event => {
                if (event.data.type !== 'progress') {
                    worker.terminate();
                    resolve(event.data);
                }
            };
            worker.postMessage({
                requestId: 'osm-allowed',
                templateDecision: destination,
                destinationDecision: destination,
                requestUrl: destination.resolvedUrl,
                query: '[out:json];node({{bbox}});out;',
                center: [0, 0],
                bbox: [0, 0, 1, 1],
                aoi: {},
                existingGeoms: [],
                allowLines: true,
                allowPolygons: true,
                overrideCapacity: false,
                capacityOverride: null
            });
        });
    });

    expect(result.type).toBe('ready');
    expect(result.accounting.featuresSeen).toBe(0);
    expect(methods).toEqual(['POST']);
});

test('custom-data and OSM workers acknowledge pause and cancel within one second', async ({ page }) => {
    await page.route('https://slow.example/**', async route => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: '{"type":"FeatureCollection","features":[],"elements":[]}'
        });
    });

    const outcomes = await page.evaluate(async () => {
        const { createDestinationDecision } =
            await import('/src/modules/remoteDestination.js');
        const destination = createDestinationDecision(
            'https://slow.example/data',
            {
                baseUrl: location.href,
                currentOrigin: location.origin,
                reviewedOrigins: ['https://slow.example'],
                redirectPolicy: 'block-all'
            }
        );
        async function exercise(workerUrl, request) {
            const worker = new Worker(workerUrl);
            let controlStarted = 0;
            let controlTimeout;
            const seen = [];
            return new Promise((resolve, reject) => {
                const startupTimeout = setTimeout(() => {
                    worker.terminate();
                    reject(new Error(`${workerUrl} did not start.`));
                }, 5000);
                worker.onmessage = event => {
                    if (event.data.type === 'progress') {
                        if (controlStarted) {
                            return;
                        }
                        clearTimeout(startupTimeout);
                        controlStarted = performance.now();
                        controlTimeout = setTimeout(() => {
                            worker.terminate();
                            reject(new Error(`${workerUrl} did not respond to controls.`));
                        }, 1000);
                        worker.postMessage({ type: 'pause', requestId: request.requestId });
                        return;
                    }
                    seen.push(event.data.type);
                    if (event.data.type === 'pauseUnsupported') {
                        worker.postMessage({ type: 'cancel', requestId: request.requestId });
                    } else if (event.data.type === 'cancelled') {
                        clearTimeout(controlTimeout);
                        worker.terminate();
                        resolve({ seen, elapsed: performance.now() - controlStarted });
                    }
                };
                worker.postMessage(request);
            });
        }

        const common = {
            templateDecision: destination,
            destinationDecision: destination,
            requestUrl: destination.resolvedUrl,
            bbox: [0, 0, 1, 1],
            center: [0, 0],
            aoi: {},
            existingGeoms: [],
            allowLines: true,
            allowPolygons: true
        };
        return {
            custom: await exercise('/src/workers/CustomDataWorker.js', {
                ...common,
                requestId: 'custom-controls'
            }),
            osm: await exercise('/src/workers/OsmSearchWorker.js', {
                ...common,
                requestId: 'osm-controls',
                query: '[out:json];node({{bbox}});out;'
            })
        };
    });

    for (const outcome of Object.values(outcomes)) {
        expect(outcome.seen).toEqual(['pauseUnsupported', 'cancelled']);
        expect(outcome.elapsed).toBeLessThanOrEqual(1000);
    }
});
