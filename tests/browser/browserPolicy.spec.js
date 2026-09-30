import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const pages = [
    '/src/labeler.html',
    '/src/projectBuilder.html',
    '/src/projectViewer.html'
];

const expectedPolicy = [
    "default-src 'none'",
    "base-uri 'self'",
    "script-src 'self' https://atlas.microsoft.com",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://atlas.microsoft.com",
    "font-src 'self' https://atlas.microsoft.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https:",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'self'"
];

for (const path of pages) {
    test(`${path} starts with the required restrictive browser policy`, async ({ page }) => {
        await page.goto(path);
        const meta = page.locator('head > meta').first();
        await expect(meta).toHaveAttribute('http-equiv', 'Content-Security-Policy');
        const policy = await meta.getAttribute('content');
        for (const directive of expectedPolicy) {
            expect(policy).toContain(directive);
        }
        expect(policy).not.toMatch(/script-src[^;]*(?:'unsafe-inline'|'unsafe-eval'|\*|data:|blob:)/);

        try {
            await page.addScriptTag({ content: 'window.__cspInline = true' });
        } catch {
            // Firefox rejects the blocked insertion; other engines resolve without executing it.
        }
        expect(await page.evaluate(() => window.__cspInline === true)).toBe(false);

        const blocked = await page.evaluate(async () => {
            const waitForViolation = (expected, action, timeoutMs = 3000) =>
                new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        document.removeEventListener('securitypolicyviolation', onViolation);
                        reject(new Error(`Timed out waiting for ${expected} CSP violation.`));
                    }, timeoutMs);
                    const onViolation = event => {
                        if (event.violatedDirective === expected) {
                            clearTimeout(timeout);
                            document.removeEventListener('securitypolicyviolation', onViolation);
                            resolve(event.violatedDirective);
                        }
                    };
                    document.addEventListener('securitypolicyviolation', onViolation);
                    action();
                });

            const frameDirective = await waitForViolation('frame-src', () => {
                const frame = document.createElement('iframe');
                frame.src = '/tests/fixtures/blank.html';
                document.body.appendChild(frame);
            });
            const objectDirective = await waitForViolation('object-src', () => {
                const object = document.createElement('object');
                object.data = '/tests/fixtures/blank.html';
                document.body.appendChild(object);
            });
            const formDirective = await waitForViolation('form-action', () => {
                const form = document.createElement('form');
                form.action = 'https://blocked.example/submit';
                form.method = 'post';
                document.body.appendChild(form);
                try {
                    form.submit();
                } catch {
                    // Firefox may also expose the blocked submission synchronously.
                }
            });

            return [frameDirective, objectDirective, formDirective];
        });
        expect(blocked).toEqual(['frame-src', 'object-src', 'form-action']);
        const markup = await page.evaluate(url => fetch(url).then(response => response.text()), path);
        expect(markup).not.toMatch(/\son(?:focus|input)\s*=/i);
    });
}

test('direct filesystem use shows dismissible local-server guidance once', async ({ page }) => {
    const fileUrl = pathToFileURL(
        path.resolve('src', 'projectBuilder.html')
    ).href;
    await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });

    const notice = page.getByRole('status', { name: 'Local server recommended' });
    await expect(notice).toContainText('response headers and cross-origin isolation');
    await expect(notice).toContainText('local HTTP server');
    await notice.getByRole('button', { name: 'Dismiss local-server guidance' }).click();
    await expect(notice).toBeHidden();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('status', { name: 'Local server recommended' })).toHaveCount(0);
});

test('policy supports repository and blob workers', async ({ page }) => {
    await page.goto('/tests/fixtures/blank.html');
    const outcome = await page.evaluate(async () => {
        const run = worker => new Promise((resolve, reject) => {
            worker.onmessage = event => {
                worker.terminate();
                resolve(event.data);
            };
            worker.onerror = event => reject(new Error(event.message));
            worker.postMessage('ping');
        });
        const repository = await run(new Worker('/tests/fixtures/cspWorker.js'));
        const blobUrl = URL.createObjectURL(new Blob([
            'onmessage = event => postMessage(`blob:${event.data}`);'
        ], { type: 'text/javascript' }));
        try {
            const blob = await run(new Worker(blobUrl));
            return { repository, blob };
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    });

    expect(outcome).toEqual({
        repository: 'repository:ping',
        blob: 'blob:ping'
    });
});

test('policy supports pinned Azure Maps, local fonts, and generated images', async ({ page }) => {
    await page.goto('/src/projectBuilder.html');
    await expect.poll(() => page.evaluate(() => typeof atlas?.Map)).toBe('function');

    const assets = await page.locator(
        'script[src*="atlas.microsoft.com"], link[href*="atlas.microsoft.com"]'
    ).evaluateAll(elements => elements.map(element => ({
        integrity: element.integrity,
        crossOrigin: element.crossOrigin
    })));
    expect(assets).toHaveLength(5);
    expect(assets.every(asset =>
        asset.integrity.startsWith('sha384-') && asset.crossOrigin === 'anonymous'
    )).toBe(true);

    const supported = await page.evaluate(async () => {
        await document.fonts.load('16px "Material Symbols Outlined"');
        const loadImage = source => new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(true);
            image.onerror = reject;
            image.src = source;
        });
        const dataImage = await loadImage(
            'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
        );
        const blobUrl = URL.createObjectURL(new Blob([
            '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
        ], { type: 'image/svg+xml' }));
        try {
            return {
                font: document.fonts.check('16px "Material Symbols Outlined"'),
                dataImage,
                blobImage: await loadImage(blobUrl)
            };
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    });

    expect(supported).toEqual({
        font: true,
        dataImage: true,
        blobImage: true
    });
});

test('policy permits only validated HTTPS data and image workflows', async ({ page }) => {
    let dataRequests = 0;
    let imageRequests = 0;
    await page.route('https://services.example/data.json', route => {
        dataRequests += 1;
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{"ok":true}'
        });
    });
    await page.route('https://images.example/pixel.svg', route => {
        imageRequests += 1;
        return route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
        });
    });
    await page.goto('/tests/fixtures/blank.html');

    const outcome = await page.evaluate(async () => {
        const { createDestinationDecision, requireAllowedDestination } =
            await import('/src/modules/remoteDestination.js');
        const options = {
            baseUrl: location.href,
            currentOrigin: location.origin,
            reviewedOrigins: ['https://services.example', 'https://images.example']
        };
        const dataDecision = requireAllowedDestination(createDestinationDecision(
            'https://services.example/data.json',
            options
        ));
        const imageDecision = requireAllowedDestination(createDestinationDecision(
            'https://images.example/pixel.svg',
            options
        ));
        const data = await fetch(dataDecision.resolvedUrl, { redirect: 'error' })
            .then(response => response.json());
        const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(true);
            element.onerror = reject;
            element.src = imageDecision.resolvedUrl;
        });
        return { data, image };
    });

    expect(outcome).toEqual({ data: { ok: true }, image: true });
    expect(dataRequests).toBe(1);
    expect(imageRequests).toBe(1);
});

test('project name becomes editable without an inline handler', async ({ page }) => {
    await page.goto('/src/projectBuilder.html');
    await expect.poll(() => page.evaluate(() => Boolean(window.app))).toBe(true);
    const projectName = page.locator('#projectName');
    await expect(projectName).toHaveAttribute('readonly', '');
    await projectName.focus();
    await expect(projectName).not.toHaveAttribute('readonly', '');
    await projectName.fill('Example project');
    await expect(projectName).toHaveValue('Example project');
});

test('labeler filter outputs update without inline handlers', async ({ page }) => {
    await page.goto('/src/labeler.html');
    await expect(page.locator('button[title="Layers"]')).toHaveCount(1);
    const brightness = page.locator('#maxBrightness');
    await brightness.evaluate(input => {
        input.value = '0.5';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(() => page.locator('output[for="maxBrightness"]').evaluate(output => output.value)).toBe('0.5');
});
