import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/tests/fixtures/blank.html');
});

test('allows a direct HTTPS request and rejects redirects', async ({ page }) => {
    await page.route('https://public.example/direct', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"ok":true}'
    }));
    const result = await page.evaluate(async () => {
        const direct = await fetch('https://public.example/direct', { redirect: 'error' }).then(r => r.json());
        let redirectRejected = false;
        try {
            await fetch('/tests/fixtures', { redirect: 'error' });
        } catch {
            redirectRejected = true;
        }
        return { direct, redirectRejected };
    });
    expect(result.direct).toEqual({ ok: true });
    expect(result.redirectRejected).toBe(true);
});

test('classifies plaintext, task-introduced, and private destinations before request', async ({ page }) => {
    const decisions = await page.evaluate(async () => {
        const { createDestinationDecision } = await import('/src/modules/remoteDestination.js');
        const options = {
            baseUrl: location.href,
            currentOrigin: location.origin,
            requireTaskConsent: true
        };
        return {
            plaintext: createDestinationDecision('http://example.com/task.json', options),
            taskOrigin: createDestinationDecision('https://tasks.example/task.json', options),
            approvedTask: createDestinationDecision('https://tasks.example/task.json', {
                ...options,
                consent: 'task-load-approved'
            }),
            privateAddress: createDestinationDecision('https://192.168.1.4/task.json', options)
        };
    });

    expect(decisions.plaintext.reason).toBe('scheme-not-allowed');
    expect(decisions.taskOrigin.reason).toBe('task-origin-approval-required');
    expect(decisions.approvedTask.status).toBe('allowed');
    expect(decisions.privateAddress.reason).toBe('private-address-approval-required');
});

test('stages labeler task URLs with page-relative resolution and redirect blocking', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { loadValidatedTaskFromUrl } = await import('/src/modules/labelerTaskIntake.js');
        const task = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                id: 'task-1',
                properties: {
                    project_name: 'Project',
                    name: 'task-1',
                    instructions: '',
                    drawing_type: 'polygons',
                    layers: {},
                    primary_classes: {
                        display_name: 'Class',
                        property_name: 'class',
                        names: [],
                        colors: []
                    }
                },
                geometry: {}
            }]
        };
        const requests = [];
        const loaded = await loadValidatedTaskFromUrl('../task.json', {
            sourceId: 'browser-task',
            defaultTask: task.features[0],
            pageUrl: `${location.origin}/tools/labeler.html`,
            currentOrigin: location.origin,
            reviewedOrigins: [],
            allowLocalhost: true,
            fetchImpl: async (url, init) => {
                requests.push({ url, init });
                return {
                    ok: true,
                    status: 200,
                    json: async () => task
                };
            }
        });
        return {
            requests,
            taskName: loaded.validated.task.properties.name
        };
    });

    expect(result.requests).toEqual([{
        url: `${new URL(page.url()).origin}/task.json`,
        init: { redirect: 'error' }
    }]);
    expect(result.taskName).toBe('task-1');
});

test('requires an explicit checkbox before loading a private task URL', async ({ page }) => {
    await page.evaluate(async () => {
        const [{ confirmPrivateDestination }, { loadValidatedTaskFromUrl }] =
            await Promise.all([
                import('/src/modules/controls/dialogs.js'),
                import('/src/modules/labelerTaskIntake.js')
            ]);
        const task = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                id: 'private-task',
                properties: {
                    project_name: 'Private project',
                    name: 'private-task',
                    instructions: 'Label the image.',
                    drawing_type: 'polygons',
                    layers: {},
                    primary_classes: {
                        display_name: 'Class',
                        property_name: 'class',
                        names: [],
                        colors: []
                    }
                },
                geometry: {}
            }]
        };
        globalThis.privateTaskRequestCount = 0;
        globalThis.privateTaskLoad = loadValidatedTaskFromUrl(
            'https://10.0.0.7/task.json',
            {
                sourceId: 'private-browser-task',
                defaultTask: task.features[0],
                pageUrl: location.href,
                currentOrigin: location.origin,
                reviewedOrigins: [],
                allowLocalhost: false,
                fetchImpl: async () => {
                    globalThis.privateTaskRequestCount += 1;
                    return {
                        ok: true,
                        status: 200,
                        json: async () => task
                    };
                },
                confirmPrivateDestination: decision => confirmPrivateDestination({
                    title: 'Load task from a private address?',
                    description: `The task URL points to ${decision.origin}. Only continue if you trust this private network destination.`,
                    acknowledgment: 'I understand this task will contact a private network address.',
                    action: 'Load task from private address',
                    cancel: 'Cancel task load'
                })
            }
        );
    });

    const dialog = page.getByRole('dialog', {
        name: 'Load task from a private address?'
    });
    await expect(dialog).toBeVisible();
    const loadButton = dialog.getByRole('button', {
        name: 'Load task from private address'
    });
    await expect(loadButton).toBeDisabled();
    expect(await page.evaluate(() => globalThis.privateTaskRequestCount)).toBe(0);

    await dialog.getByLabel(
        'I understand this task will contact a private network address.'
    ).check();
    await expect(loadButton).toBeEnabled();
    await loadButton.click();
    const loaded = await page.evaluate(async () => {
        const result = await globalThis.privateTaskLoad;
        return {
            requestCount: globalThis.privateTaskRequestCount,
            taskName: result.validated.task.properties.name
        };
    });
    expect(loaded).toEqual({
        requestCount: 1,
        taskName: 'private-task'
    });
    await expect(dialog).toBeHidden();
});
