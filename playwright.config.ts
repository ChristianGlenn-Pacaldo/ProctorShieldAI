import { defineConfig, devices } from "@playwright/test";
import { assertIsolatedNetwork, assertNoTestEnvFiles, authenticatedTestEnvironment } from "./tests/helpers/isolated-test-environment.ts";

const authenticatedRun = process.env.RUN_AUTHENTICATED_E2E === "true";
const reuseExistingServer = process.env.E2E_REUSE_SERVER === "true";
if (authenticatedRun) { assertNoTestEnvFiles(); assertIsolatedNetwork(); }
const isolated = authenticatedRun ? authenticatedTestEnvironment() : null;
const baseURL = isolated?.origin || process.env.E2E_BASE_URL || "http://localhost:3000";
const webServerPort = isolated ? "3100" : (new URL(baseURL).port || "3000");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    ignoreHTTPSErrors: authenticatedRun,
    extraHTTPHeaders: isolated ? { Origin: isolated.origin } : undefined,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: process.env.E2E_WEB_SERVER_COMMAND || "npm run prepare:standalone && node .next/standalone/server.js",
    url: baseURL,
    env: isolated
      ? {
          DATABASE_URL: isolated.database.connectionString,
          REDIS_URL: isolated.redisUrl,
          NEXT_PUBLIC_APP_URL: isolated.origin,
          PORT: webServerPort,
          HOSTNAME: "127.0.0.1",
        }
      : undefined,
    reuseExistingServer: reuseExistingServer || (authenticatedRun ? false : !process.env.CI),
    timeout: 120_000,
  },
});
