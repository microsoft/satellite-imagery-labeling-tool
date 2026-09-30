import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/tests/fixtures/blank.html');
});

test('injected local GeoJSONL boundary stops normal intake and one comparison-free retry succeeds', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { startGeoJsonlIntake } = await import('/src/modules/geoJsonlIntake.js');
        const file = new File([JSON.stringify({
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Polygon',
                coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
            }
        })], 'capacity.geojsonl');
        const options = {
            mode: 'builder',
            boundaries: { positions: 3 },
            workerFactory: () => new Worker('/src/workers/GeoJsonlImportWorker.js'),
            chunkSize: 8
        };

        let first;
        try {
            await startGeoJsonlIntake(file, options).completion;
        } catch (error) {
            first = error.result;
        }
        const retry = await startGeoJsonlIntake(file, {
            ...options,
            overrideCapacity: true
        }).completion;
        return {
            firstType: first.type,
            dimension: first.dimension,
            observed: first.observed,
            supported: first.supported,
            retryCount: retry.stagedResult.payload.positionCount,
            retryCounter: retry.summary.counters.positions
        };
    });

    expect(result).toEqual({
        firstType: 'capacityExceeded',
        dimension: 'positions',
        observed: 4,
        supported: 3,
        retryCount: 4,
        retryCounter: 4
    });
});

test('GeoJSONL worker reports every dimension crossed by one accounting update', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { startGeoJsonlIntake } = await import('/src/modules/geoJsonlIntake.js');
        const file = new File([JSON.stringify({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [0, 0] }
        })], 'multi-capacity.geojsonl');

        try {
            await startGeoJsonlIntake(file, {
                mode: 'labeler',
                boundaries: {
                    nestingDepth: 0,
                    maxObservedDepth: 0
                },
                workerFactory: () => new Worker('/src/workers/GeoJsonlImportWorker.js'),
                chunkSize: 8
            }).completion;
        } catch (error) {
            return error.result;
        }
        return null;
    });

    expect(result.type).toBe('capacityExceeded');
    expect(result.crossings).toEqual([
        { dimension: 'nestingDepth', observed: 1, supported: 0 },
        { dimension: 'maxObservedDepth', observed: 1, supported: 0 }
    ]);
});

test('comparison-free retry still rejects non-capacity validation failures', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { startGeoJsonlIntake } = await import('/src/modules/geoJsonlIntake.js');
        const file = new File([JSON.stringify({
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Polygon',
                coordinates: [[[0, 0], [1, 0], [1, 1], [2, 2]]]
            }
        })], 'invalid.geojsonl');
        try {
            await startGeoJsonlIntake(file, {
                mode: 'builder',
                boundaries: { positions: 1 },
                overrideCapacity: true,
                workerFactory: () => new Worker('/src/workers/GeoJsonlImportWorker.js')
            }).completion;
        } catch (error) {
            return error.result.diagnostic.reasonCode;
        }
        return 'unexpected-success';
    });

    expect(result).toBe('no-supported-feature');
});

test('remote capacity warning discloses unavailable content identity', async ({ page }) => {
    await page.evaluate(async () => {
        const { confirmCapacityOverride } =
            await import('/src/modules/controls/dialogs.js');
        const {
            createCapacityOverrideAttempt,
            createUntrustedSource
        } = await import('/src/modules/intakeSession.js');
        const source = createUntrustedSource({
            id: 'custom-source',
            kind: 'custom-data',
            displayName: 'Buildings service',
            format: 'GeoJSON',
            foreground: true,
            automatic: false
        });
        const attempt = createCapacityOverrideAttempt({
            id: 'custom-override',
            sourceId: source.id,
            originalSessionId: 'custom-session',
            dimension: 'responseBytes',
            observedValue: 2,
            supportedValue: 1
        });
        globalThis.capacityWarningResult = confirmCapacityOverride({
            attempt,
            source,
            acknowledge: () => attempt.acknowledge(),
            warning: 'The service supplied no ETag or Last-Modified value, so the remote content may have changed before the retry.'
        });
    });

    const dialog = page.getByRole('dialog', {
        name: 'Retry without the processing boundary?'
    });
    await expect(dialog).toContainText('no ETag or Last-Modified');
    const retry = dialog.getByRole('button', { name: 'Retry once' });
    await expect(retry).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await expect(retry).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
});
