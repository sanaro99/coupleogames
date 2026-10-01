import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 90000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://localhost:3101', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  webServer: { command: 'npm run build && node server-dist/server/index.js', url: 'http://localhost:3101', reuseExistingServer: false, timeout: 60000, env: { NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3101', APP_ORIGIN: 'http://localhost:3101', DATABASE_PATH: './test-results/e2e.sqlite', PARTNER_ONE_KEY: 'e2e-first-private-key-123456789', PARTNER_TWO_KEY: 'e2e-second-private-key-123456789', PARTNER_ONE_NAME: '', PARTNER_TWO_NAME: '' } },
});
