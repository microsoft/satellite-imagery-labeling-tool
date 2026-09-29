import { expect, test } from '@playwright/test';

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
