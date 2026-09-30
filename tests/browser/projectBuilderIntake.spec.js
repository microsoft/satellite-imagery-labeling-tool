import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/tests/fixtures/blank.html');
});

test('builder worker selects the first polygon and transfers exact compact accounting', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { startGeoJsonlIntake } = await import('/src/modules/geoJsonlIntake.js');
        await import('/src/modules/geoJsonlParser.js');
        const point = {
            type: 'Feature',
            properties: { ignored: true },
            geometry: { type: 'Point', coordinates: [5, 6] }
        };
        const polygon = {
            type: 'Feature',
            properties: { ignored: 'large property is not retained in the compact result' },
            geometry: {
                type: 'Polygon',
                coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]]
            }
        };
        const later = structuredClone(polygon);
        later.geometry.coordinates[0][1][0] = 9;
        const file = new File(
            [[point, polygon, later].map(JSON.stringify).join('\n')],
            'area.geojsonl'
        );
        const operation = startGeoJsonlIntake(file, {
            mode: 'builder',
            workerFactory: () => new Worker('/src/workers/GeoJsonlImportWorker.js'),
            chunkSize: 9
        });
        const message = await operation.completion;
        const compact = message.stagedResult.payload;
        return {
            recordsSeen: message.summary.recordsSeen,
            geometry: globalThis.GeoJsonlParser.compactGeometryToGeoJson(compact),
            positionCount: compact.positionCount,
            renderVertexCount: compact.renderVertexCount,
            retainedBytes: message.summary.counters.typedArrayBytes,
            actualBytes: compact.coordinates.byteLength
                + compact.ringOffsets.byteLength
                + compact.polygonOffsets.byteLength
                + compact.bbox.byteLength
                + compact.signedAreas.byteLength
        };
    });

    expect(result.recordsSeen).toBe(2);
    expect(result.geometry.coordinates[0][1]).toEqual([2, 0]);
    expect(result.positionCount).toBe(4);
    expect(result.renderVertexCount).toBe(4);
    expect(result.retainedBytes).toBe(result.actualBytes);
});

test('builder staging preserves current state on cancel and stale ready identity', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const {
            isMatchingReadyResult,
            startGeoJsonlIntake
        } = await import('/src/modules/geoJsonlIntake.js');
        const records = Array.from({ length: 5000 }, (_, index) => JSON.stringify({
            type: 'Feature',
            properties: { index },
            geometry: { type: 'Point', coordinates: [index, index] }
        })).join('\n');
        const file = new File([records], 'cancel.geojsonl');
        let currentState = 'existing-area';
        let operation;
        operation = startGeoJsonlIntake(file, {
            mode: 'builder',
            workerFactory: () => new Worker('/src/workers/GeoJsonlImportWorker.js'),
            chunkSize: 1024,
            onMessage: message => {
                if (message.type === 'progress') {
                    operation.cancel();
                }
            }
        });
        let terminalType;
        try {
            const message = await operation.completion;
            if (isMatchingReadyResult(operation, message)) {
                currentState = 'new-area';
            }
        } catch (error) {
            terminalType = error.result.type;
        }

        const staleAccepted = isMatchingReadyResult(operation, {
            type: 'ready',
            requestId: 'stale-request',
            stagedResult: { commitToken: operation.commitToken }
        });
        return { currentState, terminalType, staleAccepted };
    });

    expect(result).toEqual({
        currentState: 'existing-area',
        terminalType: 'cancelled',
        staleAccepted: false
    });
});

test('checkpointable worker pause and resume stay responsive', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { startGeoJsonlIntake } = await import('/src/modules/geoJsonlIntake.js');
        const points = Array.from({ length: 4000 }, (_, index) => JSON.stringify({
            type: 'Feature',
            properties: { index },
            geometry: { type: 'Point', coordinates: [index, index] }
        }));
        points.push(JSON.stringify({
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Polygon',
                coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
            }
        }));
        const file = new File([points.join('\n')], 'pause.geojsonl');
        let operation;
        let pauseRequestedAt;
        let pausedAt;
        let checkpoint;
        operation = startGeoJsonlIntake(file, {
            mode: 'builder',
            workerFactory: () => new Worker('/src/workers/GeoJsonlImportWorker.js'),
            chunkSize: 1024,
            onMessage: message => {
                if (message.type === 'started' && !pauseRequestedAt) {
                    pauseRequestedAt = performance.now();
                    operation.pause();
                } else if (message.type === 'paused') {
                    pausedAt = performance.now();
                    checkpoint = message.checkpoint;
                    operation.resume();
                }
            }
        });
        const ready = await operation.completion;
        return {
            pauseLatency: pausedAt - pauseRequestedAt,
            checkpoint,
            readyRecords: ready.summary.recordsSeen
        };
    });

    expect(result.pauseLatency).toBeLessThan(1000);
    expect(result.checkpoint.byteOffset).toBeGreaterThan(0);
    expect(result.checkpoint.recordsSeen).toBeGreaterThan(0);
    expect(result.readyRecords).toBe(4001);
});

test('builder and labeler expose accessible pause, resume, cancel status controls', async ({ page }) => {
    const markup = await page.evaluate(async () => {
        const [builder, labeler] = await Promise.all([
            fetch('/src/projectBuilder.html').then(response => response.text()),
            fetch('/src/labeler.html').then(response => response.text())
        ]);
        return { builder, labeler };
    });

    for (const html of [markup.builder, markup.labeler]) {
        expect(html).toContain('role="status"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('>Pause</button>');
        expect(html).toContain('>Resume</button>');
        expect(html).toContain('>Cancel import</button>');
    }
});
