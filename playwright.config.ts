import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'node tests/e2e/fixture-server.mjs',
    url: 'http://127.0.0.1:4317/feed',
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
