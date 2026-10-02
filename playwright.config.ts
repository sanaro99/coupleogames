import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 90000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://localhost:3101', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  // The preserved UI suite uses a fresh browser identity per test with one shared
  // synthetic invitation. Production's five-device limit is covered by access tests.
  webServer: { command: 'npm run build && node --import tsx scripts/seed-test-rooms.ts && node server-dist/server/index.js', url: 'http://localhost:3101', reuseExistingServer: false, timeout: 60000, env: { NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3101', APP_ORIGIN: 'http://localhost:3101', DATABASE_PATH: './test-results/e2e.sqlite', TRUSTED_PROXY_ADDRESSES: '127.0.0.1,::1', MAX_ROOMS: '100', MAX_SESSIONS_PER_SEAT: '20', MAX_SOCKETS_PER_SESSION: '3' } },
});
