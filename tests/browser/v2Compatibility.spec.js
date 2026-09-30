import { expect, test } from '@playwright/test';

async function readDownload(download) {
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

for (const path of [
    '/src/projectBuilder.html',
    '/src/labeler.html',
    '/src/projectViewer.html'
]) {
    test(`${path} starts with version 2 support modules`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(path);
        await expect(page.locator('body')).toBeVisible();
        const unexpected = errors.filter(message => !/unsafe-eval|trusted-types-eval|Function\(\) blocked by CSP/.test(message));
        expect(unexpected).toEqual([]);
    });
}

test('validates representative version 2 task, project, and result relationships', async ({ page }) => {
    await page.goto('/tests/fixtures/blank.html');
    const result = await page.evaluate(async () => {
        const { validateProject, validateProjectSettings, validateTask } =
            await import('/src/modules/schemaValidation.js');
        const [settings, task, resultDocument] = await Promise.all([
            fetch('/tests/fixtures/v2/project-settings.json').then(response => response.json()),
            fetch('/tests/fixtures/v2/task.json').then(response => response.json()),
            fetch('/tests/fixtures/v2/result.json').then(response => response.json())
        ]);
        const validatedTask = validateTask(task, { sourceId: 'v2-task' });
        const validatedSettings = validateProjectSettings(settings, { sourceId: 'v2-project' });
        const project = validateProject({
            settings,
            tasks: task.features,
            results: resultDocument.features
        }, { sourceId: 'v2-archive' });
        return {
            taskName: validatedTask.document.features[0].properties.name,
            projectName: validatedSettings.area.properties.project_name,
            results: project.results.length
        };
    });
    expect(result).toEqual({
        taskName: 'task-1',
        projectName: 'Example project',
        results: 1
    });
});

test('preserves validated direct HTTPS custom services', async ({ page }) => {
    await page.goto('/tests/fixtures/blank.html');
    const decision = await page.evaluate(async () => {
        const { createDestinationDecision } = await import('/src/modules/remoteDestination.js');
        return createDestinationDecision('https://services.example/data?bbox={bbox}', {
            baseUrl: location.href,
            currentOrigin: location.origin,
            allowedPlaceholders: ['bbox']
        });
    });
    expect(decision.status).toBe('allowed');
    expect(decision.scheme).toBe('https');
});

test('round-trips produced v2 artifacts through builder, labeler storage/save, and viewer export UI', async ({ page }) => {
    const alertMessages = [];
    page.on('dialog', dialog => {
        if (dialog.type() === 'alert') {
            alertMessages.push(dialog.message());
        }
        return dialog.accept();
    });
    const [settings, taskDocument, autosave] = await Promise.all([
        page.request.get('/tests/fixtures/v2/project-settings.json').then(response => response.json()),
        page.request.get('/tests/fixtures/v2/task.json').then(response => response.json()),
        page.request.get('/tests/fixtures/v2/autosave.json').then(response => response.json())
    ]);
    settings.features[0].properties.gridUnits = 'kilometers';
    settings.features[0].properties.gridSize = 1;
    settings.features[0].properties.layers = {
        'Representative imagery': {
            type: 'TileLayer',
            tileUrl: 'https://imagery.example/{z}/{x}/{y}.png',
            minSourceZoom: 1,
            maxSourceZoom: 19,
            tileSize: 256,
            enabled: true
        }
    };
    taskDocument.features[0].properties.layers =
        settings.features[0].properties.layers;
    taskDocument.features[0].properties.customDataService =
        'https://services.example/data?bbox={bbox}';
    taskDocument.features[0].properties.customDataServiceLabel = 'Load reference data';
    settings.features[0].properties.customDataService =
        taskDocument.features[0].properties.customDataService;
    settings.features[0].properties.customDataServiceLabel =
        taskDocument.features[0].properties.customDataServiceLabel;

    await page.goto('/src/projectBuilder.html');
    await expect.poll(() => page.evaluate(() => typeof JSZip)).toBe('function');
    await expect.poll(() => page.evaluate(() => Boolean(window.app))).toBe(true);
    const sourceArchive = await page.evaluate(async documents => {
        const zip = new JSZip();
        zip.file('project_builder_settings.json', JSON.stringify(documents.settings));
        zip.file('tasks/task-1.json', JSON.stringify(documents.task));
        return zip.generateAsync({ type: 'base64' });
    }, { settings, task: taskDocument });
    await page.locator('#loadLocalProjectFile').setInputFiles({
        name: 'representative-v2.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from(sourceArchive, 'base64')
    });
    await expect.poll(async () => ({
        projectName: await page.locator('#projectName').inputValue(),
        alerts: alertMessages
    })).toEqual({
        projectName: 'Example project',
        alerts: []
    });
    for (let step = 1; step <= 4; step += 1) {
        const next = page.locator(`#step-${step} .nextBtn`);
        await expect(next).toBeEnabled();
        await next.click();
    }
    await expect(page.locator('#step-5')).toBeVisible();
    const builderDownload = page.waitForEvent('download');
    await page.locator('#step-5 .downloadBtn').click();
    const builderArchive = await readDownload(await builderDownload);
    const produced = await page.evaluate(async archive => {
        const zip = await JSZip.loadAsync(archive, { base64: true });
        return {
            settings: JSON.parse(await zip.file('project_builder_settings.json').async('text')),
            task: JSON.parse(await zip.file('tasks/Example_project_0.json').async('text')),
            entries: Object.keys(zip.files).sort()
        };
    }, builderArchive.toString('base64'));
    expect(produced.entries).toEqual([
        'project_builder_settings.json',
        'results/',
        'summary.csv',
        'tasks/',
        'tasks/Example_project_0.json'
    ]);
    expect(produced.settings.features[0].properties.project_name).toBe('Example project');
    autosave.data.features.forEach(feature => {
        feature.properties.task_name = produced.task.features[0].properties.name;
    });

    let taskRequests = 0;
    let serviceRequests = 0;
    await page.route('https://tasks.example/task.json', route => {
        taskRequests += 1;
        return route.fulfill({
            status: 200,
            contentType: 'application/geo+json',
            body: JSON.stringify(produced.task)
        });
    });
    await page.route('https://services.example/data?bbox=*', route => {
        serviceRequests += 1;
        return route.fulfill({
            status: 200,
            contentType: 'application/geo+json',
            body: '{"type":"FeatureCollection","features":[]}'
        });
    });
    await page.goto('/src/labeler.html');
    await expect.poll(() => page.evaluate(() => typeof localforage)).toBe('object');
    await page.evaluate(async cached => {
        const storage = localforage.createInstance({ name: 'annotation-session-db' });
        await storage.setItem('Example_project_0', {
            ...cached,
            date: Date.now()
        });
    }, autosave);
    await page.goto(
        '/src/labeler.html?taskUrl=https%3A%2F%2Ftasks.example%2Ftask.json'
    );
    await expect(page.locator('#appTitle')).toHaveText('Example project');
    await expect(page.locator('#instructions')).toContainText('Draw the visible area.');
    await expect.poll(async () => page.evaluate(async () => {
        const storage = localforage.createInstance({ name: 'annotation-session-db' });
        return (await storage.getItem('Example_project_0'))?.data?.features?.length ?? 0;
    })).toBe(1);
    await page.locator('button[title="Import data"]').click();
    await page.locator('#customImportBtn').click();
    await expect.poll(() => serviceRequests).toBe(1);
    await expect(page.locator('#customImportLoadingScreen')).toBeHidden();

    await page.locator('button[title="Save"]').click();
    await page.locator('#save-file-name').fill('task-1-result');
    await page.locator('#save-file-format').selectOption({ label: 'GeoJSON' });
    const labelerDownload = page.waitForEvent('download');
    await page.locator('#saveCard button').evaluate(button => button.click());
    const resultBuffer = await readDownload(await labelerDownload);
    const savedResult = JSON.parse(resultBuffer.toString('utf8'));
    expect(savedResult.features).toHaveLength(1);
    expect(savedResult.features[0].properties.task_name).toBe('Example_project_0');

    await page.goto('/src/projectViewer.html');
    await expect.poll(() => page.evaluate(() => typeof JSZip)).toBe('function');
    await expect.poll(() => page.evaluate(() => Boolean(window.app))).toBe(true);
    const viewerArchive = await page.evaluate(async ({ archive, result }) => {
        const zip = await JSZip.loadAsync(archive, { base64: true });
        zip.file('results/Example_project_0.json', JSON.stringify(result));
        return zip.generateAsync({ type: 'base64' });
    }, {
        archive: builderArchive.toString('base64'),
        result: savedResult
    });

    await page.locator('#loadLocalProjectFile').setInputFiles({
        name: 'representative-v2-complete.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from(viewerArchive, 'base64')
    });
    await expect.poll(async () => ({
        stats: await page.locator('#statsPanel').innerText(),
        alerts: alertMessages
    })).toEqual({
        stats: expect.stringContaining('Task areas: 1'),
        alerts: []
    });
    await expect(page.locator('#statsPanel')).toContainText('Labeled features: 1');
    await page.locator('#exportBtn').click();
    const exportDialog = page.locator('.save-results-dialog');
    await expect(exportDialog).toBeVisible();
    await exportDialog.locator('input[type="text"]').fill('merged-v2-results');
    const viewerDownload = page.waitForEvent('download');
    await exportDialog.getByRole('button', { name: 'Save' }).click();
    const mergedResult = JSON.parse((await readDownload(await viewerDownload)).toString('utf8'));
    expect(mergedResult.features).toHaveLength(1);
    expect(taskRequests).toBe(1);
    expect(serviceRequests).toBe(1);
});
