import { test, expect } from '@playwright/test';

test('project builder loads without a page error', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    await page.goto('http://127.0.0.1:4173/src/projectBuilder.html');

    await expect(page).toHaveTitle(/Project Builder/i);
    const unexpected = errors.filter(error => !/unsafe-eval|trusted-types-eval|Function\(\) blocked by CSP/.test(String(error?.message ?? error)));
    expect(unexpected).toEqual([]);
});
