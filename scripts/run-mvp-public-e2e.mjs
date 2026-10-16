// Isolated production HTTP/browser checks; no database or live providers.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const review = path.resolve(process.env.MVP_PUBLIC_REVIEW_DIR || "release-review/mvp-2026-10-15/public-e2e");
const temp = path.resolve(".tmp-mvp-e2e");
const origin = "http://127.0.0.1:3181";
// NEXT_PUBLIC values are inlined during the production build. A database
// rehearsal may build for its separate HTTPS loopback origin.
const buildOrigin = process.env.MVP_BUILD_APP_ORIGIN || origin;
if (!["localhost", "127.0.0.1"].includes(new URL(buildOrigin).hostname)) throw Error("Loopback build origin required");
fs.mkdirSync(review, { recursive: true });
fs.mkdirSync(temp, { recursive: true });
try {
  await fetch(origin + "/login", { signal: AbortSignal.timeout(500) });
  throw Error("Port already owned");
} catch (error) {
  if (error.message === "Port already owned") throw error;
}
// Whitelist OS settings; never inherit provider credentials or a database URL.
const env = { NODE_ENV: "production" };
for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"])
  if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  PORT: "3181", HOSTNAME: "127.0.0.1", FRONTEND_ONLY: "false", POWER_ARENA_ENABLED: "false",
  DATABASE_URL: "postgresql://local:local@127.0.0.1:1/local", REDIS_URL: "redis://127.0.0.1:1",
  NEXTAUTH_SECRET: "fixture-only-session-signing-secret-at-least-32-characters",
  NEXT_PUBLIC_APP_URL: buildOrigin, E2E_BASE_URL: origin, RUN_AUTHENTICATED_E2E: "false",
  PUSHER_APP_ID: "synthetic", NEXT_PUBLIC_PUSHER_KEY: "synthetic", PUSHER_SECRET: "synthetic", NEXT_PUBLIC_PUSHER_CLUSTER: "ap1",
});
execFileSync(process.execPath, ["scripts/prepare-standalone.js"], { stdio: "ignore", env });
const config = {
  testDir: path.join(root, "e2e"), testMatch: ["security-flows.spec.ts", "public-entry-themes.spec.ts", "custom-404.spec.ts", "free-monthly-pricing.spec.ts"],
  workers: 1, retries: 0, timeout: 45000, expect: { timeout: 10000 }, outputDir: path.join(review, "artifacts"),
  reporter: [["list"], ["json", { outputFile: path.join(review, "results.json") }]],
  use: { baseURL: origin, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { browserName: "chromium", viewport: { width: 1280, height: 900 } } },
    { name: "mobile-chromium", use: { browserName: "chromium", viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
};
fs.writeFileSync(path.join(temp, "playwright.config.mjs"), "export default " + JSON.stringify(config));
const log = fs.openSync(path.join(review, "server.log"), "w");
let server;
try {
  server = spawn(process.execPath, [".next/standalone/server.js"], { cwd: root, env, windowsHide: true, stdio: ["ignore", log, log] });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw Error("Production server exited");
    try { if ((await fetch(origin + "/login", { signal: AbortSignal.timeout(1000) })).status === 200) { ready = true; break; } } catch {}
    await delay(250);
  }
  if (!ready) throw Error("Production server not ready");
  const tests = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", path.join(temp, "playwright.config.mjs"), ...process.argv.slice(2)],
    { cwd: root, env, windowsHide: true, stdio: "inherit" });
  process.exitCode = await new Promise(resolve => tests.once("exit", resolve));
} finally {
  if (server && server.exitCode === null) { const closed = new Promise(resolve => server.once("exit", resolve)); server.kill(); await closed; }
  fs.closeSync(log);
}
