import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests-e2e',
  timeout: 30_000,
  retries: process.env['CI'] ? 1 : 0,
  webServer: {
    command: 'node tests-e2e/serve.mjs',
    port: 8787,
    reuseExistingServer: !process.env['CI'],
  },
});
