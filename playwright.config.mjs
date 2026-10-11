import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/ui',
    timeout: 30_000,
    fullyParallel: true,
    workers: 2,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:4173',
        browserName: 'chromium',
        headless: true,
        launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
            args: ['--no-sandbox', '--disable-dev-shm-usage']
        },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node server.mjs',
        url: 'http://127.0.0.1:4173/api/status',
        env: { PORT: '4173', HOST: '0.0.0.0', GEMINI_API_KEY: '', STUDIO_ACCESS_TOKEN: '' },
        reuseExistingServer: false
    }
});
