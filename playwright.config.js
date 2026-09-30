import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    outputDir: './test-results',
    reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
    workers: 4,
    use: {
        baseURL: 'http://localhost:4173',
        headless: true
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
        { name: 'firefox', use: { browserName: 'firefox' } },
        { name: 'webkit', use: { browserName: 'webkit' } }
    ],
    webServer: {
        command: 'python -m http.server 4173',
        port: 4173,
        reuseExistingServer: true
    }
});
