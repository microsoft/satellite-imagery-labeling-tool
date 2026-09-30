import { test, expect } from '@playwright/test';

test('sanitizes instructions and adds one accessible notice', async ({ page }) => {
    await page.goto('http://127.0.0.1:4173/');
    await page.addScriptTag({ url: '/src/libs/marked.min.js' });
    await page.addScriptTag({ url: '/src/libs/purify.min.js' });

    const result = await page.evaluate(async () => {
        const module = await import('/src/modules/safeRendering.js');
        const container = document.createElement('div');
        document.body.appendChild(container);
        const rendered = module.renderSafeMarkdown('[safe](https://example.test) <img src=x onerror=alert(1)>');
        module.renderInstruction(container, rendered);
        module.renderInstruction(container, rendered);
        return {
            html: container.innerHTML,
            notices: container.querySelectorAll('[data-safe-render-notice="true"]').length,
            role: container.querySelector('[data-safe-render-notice="true"]')?.getAttribute('role')
        };
    });

    expect(result.html).not.toContain('onerror');
    expect(result.html).not.toContain('<img');
    expect(result.notices).toBe(1);
    expect(result.role).toBe('status');
});
