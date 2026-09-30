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
    expect(result.prompt).toContain('Measured dimensions:');
    expect(result.prompt).toContain('positions=');
    expect(result.prompt).toContain('validationOperations=');
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

test('labeler renders custom-data and OSM destination refusals without error alerts or requests', async ({ page }) => {
    let customRequests = 0;
    let osmRequests = 0;
    const unexpectedAlerts = [];
    const destinationPrompts = [];
    const task = await page.evaluate(() =>
        fetch('/tests/fixtures/v2/task.json').then(response => response.json())
    );
    task.features[0].properties.customDataService =
        'https://declined-custom.example/data?bbox={bbox}';
    task.features[0].properties.customDataServiceLabel = 'Add declined custom data';

    await page.route('https://tasks.example/task.json', route => route.fulfill({
        status: 200,
        contentType: 'application/geo+json',
        body: JSON.stringify(task)
    }));
    await page.route('https://declined-custom.example/**', route => {
        customRequests += 1;
        return route.abort();
    });
    await page.route('https://declined-osm.example/**', route => {
        osmRequests += 1;
        return route.abort();
    });
    page.on('dialog', async dialog => {
        const message = dialog.message();
        if (message.includes('This task will be loaded from')) {
            await dialog.accept();
        } else if (dialog.type() === 'confirm'
            && (message.includes('Custom data import will contact')
                || message.includes('OSM search will contact'))) {
            destinationPrompts.push(message);
            await dialog.dismiss();
        } else {
            unexpectedAlerts.push(`${dialog.type()}: ${message}`);
            await dialog.dismiss();
        }
    });

    await page.goto(
        '/src/labeler.html?taskUrl=https%3A%2F%2Ftasks.example%2Ftask.json'
    );
    await expect(page.locator('#appTitle')).toHaveText('Example project');

    const importDataButton = page.locator('button[title="Import data"]');
    await importDataButton.click();
    await page.locator('#customImportBtn').click();
    await expect(page.getByRole('status', { name: 'Destination declined' })).toContainText(
        'Custom data import was declined'
    );

    await importDataButton.click();
    await importDataButton.click();
    await expect(page.locator('#importDataCard')).toBeVisible();
    await page.locator('#loadOsmWizard').click();
    await page.locator('#osmServers').evaluate(select => {
        const option = document.createElement('option');
        option.value = 'https://declined-osm.example/api/';
        option.textContent = option.value;
        select.replaceChildren(option);
        select.value = option.value;
    });
    await page.locator('#importWizard textarea').fill('[out:json];node(0,0,1,1);out;');
    await page.locator('#importWizard button').click();

    await expect.poll(() => destinationPrompts).toHaveLength(2);
    await expect(page.getByRole('status', { name: 'Destination declined' })).toHaveCount(2);
    await expect(page.getByRole('status', { name: 'Destination declined' }).filter({
        hasText: 'OSM search was declined'
    })).toHaveCount(1);
    expect(customRequests).toBe(0);
    expect(osmRequests).toBe(0);
    expect(unexpectedAlerts).toEqual([]);
});
