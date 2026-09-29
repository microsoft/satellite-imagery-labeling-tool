import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/tests/fixtures/blank.html');
});

test('labeler stages mixed Feature records and requires explicit partial confirmation', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const {
            confirmPartialGeoJsonlImport,
            startGeoJsonlIntake
        } = await import('/src/modules/geoJsonlIntake.js');
        const input = [
            JSON.stringify({
                type: 'Feature',
                properties: { name: 'point' },
                geometry: { type: 'Point', coordinates: [1, 2] }
            }),
            JSON.stringify({ type: 'Polygon', coordinates: [] }),
            '{ malformed',
            JSON.stringify({
                type: 'Feature',
                properties: { name: 'polygon' },
                geometry: {
                    type: 'Polygon',
                    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
                }
            })
        ].join('\n');
        const operation = startGeoJsonlIntake(new File([input], 'mixed.geojsonl'), {
            mode: 'labeler',
            workerFactory: () => new Worker('/src/workers/GeoJsonlImportWorker.js'),
            chunkSize: 5
        });
        const message = await operation.completion;
        let prompt = '';
        const declined = confirmPartialGeoJsonlImport(message.summary, text => {
            prompt = text;
            return false;
        });
        const accepted = confirmPartialGeoJsonlImport(message.summary, () => true);
        return {
            featureTypes: message.stagedResult.payload.map(feature => feature.geometry.type),
            validCount: message.summary.validCount,
            invalidCount: message.summary.invalidCount,
            declined,
            accepted,
            prompt
        };
    });

    expect(result.featureTypes).toEqual(['Point', 'Polygon']);
    expect(result.validCount).toBe(2);
    expect(result.invalidCount).toBe(2);
    expect(result.declined).toBe(false);
    expect(result.accepted).toBe(true);
    expect(result.prompt).toContain('2 valid Feature records and 2 invalid records');
    expect(result.prompt).toContain('Import only the previewed valid records?');
});

test('labeler GeoJSONL path no longer references an undefined parser result', async ({ page }) => {
    const source = await page.evaluate(() => fetch('/src/modules/labeler.js').then(response => response.text()));
    const geoJsonlBranch = source.slice(
        source.indexOf("if (file.name.toLowerCase().indexOf('.geojsonl') > -1)"),
        source.indexOf('//Try parsing the file using the Sptial IO module')
    );

    expect(geoJsonlBranch).not.toContain('r.features');
    expect(source).toContain('#importFeatures(message.stagedResult.payload, source, true, true)');
});
