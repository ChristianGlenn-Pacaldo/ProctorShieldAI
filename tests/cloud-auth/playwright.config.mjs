import { defineConfig } from '@playwright/test';
import { loadConfig, ORIGIN, PRIVATE } from './runtime.mjs';
loadConfig();
export default defineConfig({
  testDir: '.', testMatch: 'authentication.spec.mjs', fullyParallel: false, workers: 1,
  retries: 0, forbidOnly: true, timeout: 90_000,
  reporter: [['../../scripts/ci/auth-reporter.mjs']],
  outputDir: PRIVATE + '/playwright-output',
  use: { baseURL: ORIGIN, ignoreHTTPSErrors: true, trace: 'off', screenshot: 'off', video: 'off',
    launchOptions: { args: ['--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } },
});
