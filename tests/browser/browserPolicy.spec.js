import { expect, test } from '@playwright/test';

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
            const directives = [];
            document.addEventListener('securitypolicyviolation', event => {
                directives.push(event.violatedDirective);
            });

            const frame = document.createElement('iframe');
            frame.name = 'blocked-frame';
            frame.src = '/tests/fixtures/blank.html';
            document.body.appendChild(frame);

            const object = document.createElement('object');
            object.data = '/tests/fixtures/blank.html';
            document.body.appendChild(object);

            const form = document.createElement('form');
            form.action = 'https://blocked.example/submit';
            form.method = 'post';
            form.target = 'blocked-frame';
            document.body.appendChild(form);
            try {
                form.submit();
            } catch {
                // Firefox surfaces the blocked submission as an exception.
            }

            await new Promise(resolve => setTimeout(resolve, 100));
            return directives;
        });
        expect(blocked).toContain('frame-src');
        const markup = await page.evaluate(url => fetch(url).then(response => response.text()), path);
        expect(markup).not.toMatch(/\son(?:focus|input)\s*=/i);
    });
}

test('project name becomes editable without an inline handler', async ({ page }) => {
    await page.goto('/src/projectBuilder.html');
    const projectName = page.locator('#projectName');
    await expect(projectName).toHaveAttribute('readonly', '');
    await projectName.focus();
    await expect(projectName).not.toHaveAttribute('readonly', '');
    await projectName.fill('Example project');
    await expect(projectName).toHaveValue('Example project');
});

test('labeler filter outputs update without inline handlers', async ({ page }) => {
    await page.goto('/src/labeler.html');
    const brightness = page.locator('#maxBrightness');
    await brightness.evaluate(input => {
        input.value = '0.5';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(() => page.locator('output[for="maxBrightness"]').evaluate(output => output.value)).toBe('0.5');
});
