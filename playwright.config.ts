import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const authenticatedRun = process.env.RUN_AUTHENTICATED_E2E === "true";
const authenticatedDatabaseUrl = process.env.E2E_DATABASE_URL?.trim();
const baseURL = process.env.E2E_BASE_URL || (authenticatedRun ? "http://localhost:3100" : "http://localhost:3000");
const webServerPort = new URL(baseURL).port || (baseURL.startsWith("https:") ? "443" : "80");

function normalizedDatabaseEndpoint(value: string) {
  return new URL(value).hostname.toLowerCase().replace("-pooler.", ".");
}

if (authenticatedRun) {
  if (!authenticatedDatabaseUrl) {
    throw new Error("RUN_AUTHENTICATED_E2E requires a disposable E2E_DATABASE_URL");
  }
  if (
    process.env.DATABASE_URL
    && normalizedDatabaseEndpoint(authenticatedDatabaseUrl) === normalizedDatabaseEndpoint(process.env.DATABASE_URL)
  ) {
    throw new Error("Authenticated E2E tests cannot use the production DATABASE_URL endpoint");
  }
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
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
    env: authenticatedRun && authenticatedDatabaseUrl
      ? {
          DATABASE_URL: authenticatedDatabaseUrl,
          PORT: webServerPort,
          HOSTNAME: "127.0.0.1",
        }
      : undefined,
    reuseExistingServer: authenticatedRun ? false : !process.env.CI,
    timeout: 120_000,
  },
});
