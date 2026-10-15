// Local-only synthetic database harness. Never accepts an existing database URL.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

const root = process.cwd(), temporary = path.resolve(".tmp-mvp-database");
const review = path.resolve("release-review/mvp-database-2026-10-15");
const dockerDesktop = path.join(process.env.LOCALAPPDATA || "", "Programs/DockerDesktop/resources/bin/docker.exe");
const docker = process.platform === "win32" && fs.existsSync(dockerDesktop) ? dockerDesktop : "docker";
const gitOpenSsl = path.join(process.env.ProgramFiles || "C:/Program Files", "Git/usr/bin/openssl.exe");
const openssl = process.platform === "win32" && fs.existsSync(gitOpenSsl) ? gitOpenSsl : "openssl";
fs.mkdirSync(temporary, { recursive: true }); fs.mkdirSync(review, { recursive: true });
const stateFile = path.join(temporary, "state.json");
const command = process.argv[2] || "prepare";
const run = (args, options = {}) => execFileSync(docker, args, { encoding: "utf8", windowsHide: true, ...options }).trim();
async function freePort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  await new Promise(resolve => server.close(resolve));
}
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : null;
if (!state) {
  if (command !== "prepare") throw Error("Prepare owned local resources first");
  const id = randomUUID().slice(0, 8);
  state = { runId: id, database: "proctorshield_mvp_" + id, pg: "ps-mvp-pg-" + id, redis: "ps-mvp-redis-" + id, pgPort: 25432, redisPort: 26379, prepared: false };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}
if (!/^[a-f0-9]{8}$/.test(state.runId) || state.database !== "proctorshield_mvp_" + state.runId
  || state.pg !== "ps-mvp-pg-" + state.runId || state.redis !== "ps-mvp-redis-" + state.runId
  || state.pgPort !== 25432 || state.redisPort !== 26379) throw Error("Owned local target mismatch");

// These are deliberately public fixture credentials, never account credentials.
const password = "LocalMvpFixture2026";
const databaseUrl = `postgresql://mvp_fixture:${password}@127.0.0.1:${state.pgPort}/${state.database}`;
const env = { NODE_ENV: "production" };
for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"])
  if (process.env[key]) env[key] = process.env[key];
env.Path = path.dirname(process.execPath) + path.delimiter + (process.env.Path || process.env.PATH || "");
Object.assign(env, {
  DATABASE_URL: databaseUrl, E2E_DATABASE_URL: databaseUrl,
  REDIS_URL: `redis://127.0.0.1:${state.redisPort}`, FRONTEND_ONLY: "false", POWER_ARENA_ENABLED: "false",
  NEXTAUTH_SECRET: "mvp-local-only-signing-fixture-2026-at-least-32-characters",
  NEXT_PUBLIC_APP_URL: "https://127.0.0.1:3186", E2E_BASE_URL: "https://127.0.0.1:3186",
  PORT: "3185", HOSTNAME: "127.0.0.1", RUN_AUTHENTICATED_E2E: "true",
  E2E_TEACHER_EMAIL: "teacher-a@mvp.example.test", E2E_STUDENT_EMAIL: "student-a@mvp.example.test", E2E_ACCOUNT_PASSWORD: password,
  PUSHER_APP_ID: "synthetic", NEXT_PUBLIC_PUSHER_KEY: "synthetic", PUSHER_SECRET: "synthetic", NEXT_PUBLIC_PUSHER_CLUSTER: "mvp-local-invalid",
  GEMINI_API_KEY: "", EVIDENCE_LOCAL_FALLBACK: "false",
});
function verifyOwned(name) {
  const label = run(["inspect", "--format", '{{ index .Config.Labels "proctorshield.mvp-run" }}', name]);
  if (label !== state.runId) throw Error("Container ownership mismatch");
}
function ensureContainer(name, args) {
  let exists = false;
  try { run(["inspect", "--format", "{{.Id}}", name], { stdio: ["ignore", "pipe", "ignore"] }); exists = true; } catch {}
  if (exists) { verifyOwned(name); run(["start", name]); }
  else run(["run", "-d", "--name", name, "--label", "proctorshield.mvp-run=" + state.runId, ...args]);
}
async function execute(args, file, extraEnv = {}) {
  const logPath = path.join(review, file);
  if (fs.existsSync(logPath)) fs.copyFileSync(logPath, logPath + ".previous-" + Date.now());
  const log = fs.openSync(logPath, "w");
  try {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...env, ...extraEnv }, windowsHide: true, stdio: ["ignore", log, log] });
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    if (code !== 0) throw Error(`${file} failed (${code}); inspect local log`);
  } finally { fs.closeSync(log); }
}
if (command === "prepare") {
  if (!state.prepared) {
    ensureContainer(state.pg, ["-p", `127.0.0.1:${state.pgPort}:5432`, "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_USER=mvp_fixture", "-e", "POSTGRES_PASSWORD=" + password, "-e", "POSTGRES_DB=" + state.database, "postgres:17-alpine"]);
    ensureContainer(state.redis, ["-p", `127.0.0.1:${state.redisPort}:6379`, "redis:8-alpine", "redis-server", "--save", "", "--appendonly", "no"]);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { run(["exec", state.pg, "pg_isready", "-U", "mvp_fixture", "-d", state.database], { stdio: ["ignore", "pipe", "ignore"] }); ready = true; break; } catch { await delay(300); }
    }
    if (!ready) throw Error("Owned PostgreSQL not ready");
    run(["exec", state.redis, "redis-cli", "ping"]);
    await execute(["node_modules/prisma/build/index.js", "migrate", "deploy"], "migrations.log");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      const count = await pool.query("SELECT count(*)::int AS n FROM users");
      if (count.rows[0].n !== 0) throw Error("Refusing to provision over existing users");
      const hash = await bcrypt.hash(password, 12);
      for (const role of ["admin", "teacher", "student"]) await pool.query("INSERT INTO roles(role_name) VALUES($1)", [role]);
      state.accounts = {};
      for (const [name, role] of [["admin", "admin"], ["teacher-a", "teacher"], ["teacher-b", "teacher"], ["teacher-free", "teacher"], ["student-a", "student"], ["student-b", "student"], ["student-outside", "student"]]) {
        const id = randomUUID(); state.accounts[name] = id;
        await pool.query("INSERT INTO users(id,full_name,email,password,role_id,updated_at) SELECT $1,$2,$3,$4,id,now() FROM roles WHERE role_name=$5", [id, "SYNTHETIC MVP " + name, name + "@mvp.example.test", hash, role]);
      }
      const plan = await pool.query("INSERT INTO subscription_plans(plan_name,yearly_price,duration_days) VALUES('Synthetic MVP Pro',500,365) RETURNING id");
      for (const name of ["teacher-a", "teacher-b"]) await pool.query("INSERT INTO user_subscriptions(id,user_id,plan_id,start_date,end_date,payment_status,subscription_status) VALUES($1,$2,$3,current_date,current_date+365,'paid','active')", [randomUUID(), state.accounts[name], plan.rows[0].id]);
      await pool.query("INSERT INTO settings(setting_key,setting_value) VALUES('evidence_retention_days','37')");
      // Separate empty databases satisfy existing integration-test safety guards.
      for (const name of ["proctorshield_arena_atomic_test", "proctorshield_paymongo_atomic_test"]) {
        const found = await pool.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]);
        if (!found.rowCount) await pool.query('CREATE DATABASE "' + name + '"');
      }
      state.prepared = true; fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } finally { await pool.end(); }
  }
  verifyOwned(state.pg); verifyOwned(state.redis);
  fs.writeFileSync(path.join(review, "LOCAL_TARGET.json"), JSON.stringify({ runId: state.runId, database: state.database, postgresContainer: state.pg, redisContainer: state.redis, ports: [state.pgPort, state.redisPort], syntheticAccounts: Object.keys(state.accounts), isolated: true, migrations: "applied only to newly created disposable database" }, null, 2));
  console.log("Owned disposable PostgreSQL/Redis prepared; synthetic accounts only. Run: " + state.runId);
} else {
  if (!state.prepared) throw Error("Provisioning incomplete"); verifyOwned(state.pg); verifyOwned(state.redis);
  if (command === "atomic") {
    const atomicEnv = {
      POWER_ARENA_ENABLED: "true", NEXT_PUBLIC_APP_URL: "https://test.invalid",
      ARENA_CONCURRENCY_TEST_DATABASE_URL: databaseUrl.replace(state.database, "proctorshield_arena_atomic_test"), ARENA_CONCURRENCY_TEST_DATABASE_APPROVED: "true",
      PAYMONGO_CONCURRENCY_TEST_DATABASE_URL: databaseUrl.replace(state.database, "proctorshield_paymongo_atomic_test"), PAYMONGO_CONCURRENCY_TEST_DATABASE_APPROVED: "true",
    };
    await execute(["--import", "./tests/helpers/test-feature-policy.ts", "--test", "--test-concurrency=1", "tests/arena-postgres-concurrency.test.ts", "tests/arena-expiry-postgres.test.ts", "tests/arena-realtime-postgres.test.ts", "tests/paymongo-postgres-concurrency.test.ts"], "atomic.log", atomicEnv);
    console.log("Independent PostgreSQL integration tests passed");
  } else if (command === "test" || command === "serve") {
    for (const location of [root, path.join(root, ".next/standalone")]) if (fs.readdirSync(location).some(name => /^\.env(?:\.(?:local|production|production\.local|development|development\.local|test|test\.local))?$/.test(name))) throw Error("Unexpected dotenv file; isolated server refused");
    await freePort(3185); await freePort(3186);
    const key = path.join(temporary, "key.pem"), cert = path.join(temporary, "cert.pem");
    if (!fs.existsSync(key)) execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost", "-days", "2"], { windowsHide: true, stdio: "ignore" });
    execFileSync(process.execPath, ["scripts/prepare-standalone.js"], { env, windowsHide: true, stdio: "ignore" });
    const log = fs.openSync(path.join(review, command + "-server.log"), "w");
    const server = spawn(process.execPath, [".next/standalone/server.js"], { cwd: root, env, windowsHide: true, stdio: ["ignore", log, log] });
    const proxy = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (request, response) => {
      const started = Date.now(), pathname = new URL(request.url, env.E2E_BASE_URL).pathname;
      const upstream = http.request({ hostname: "127.0.0.1", port: 3185, path: request.url, method: request.method, agent: false,
        headers: { ...request.headers, connection: "close", host: "127.0.0.1:3186", "x-forwarded-host": "127.0.0.1:3186", "x-forwarded-proto": "https" } }, result => { response.writeHead(result.statusCode, result.headers); result.pipe(response); });
      upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      upstream.setTimeout(15000, () => upstream.destroy(Error("Owned proxy upstream deadline")));
      response.on("finish", () => { if (pathname.startsWith("/api/")) fs.appendFileSync(path.join(review, "proxy-timing.log"), JSON.stringify({ method: request.method, pathname, status: response.statusCode, ms: Date.now() - started }) + "\n"); });
      response.on("close", () => { if (!response.writableFinished) upstream.destroy(); });
      request.pipe(upstream);
    });
    await new Promise(resolve => proxy.listen(3186, "127.0.0.1", resolve));
    try {
      let ready = false;
      for (let i = 0; i < 120; i++) { if (server.exitCode !== null) throw Error("Owned app server exited"); try { if ((await fetch("http://127.0.0.1:3185/login", { signal: AbortSignal.timeout(1000) })).status === 200) { ready = true; break; } } catch {} await delay(250); }
      if (!ready) throw Error("Owned app server not ready");
      // Start the shared auth store without an account, record, or provider write.
      await fetch("http://127.0.0.1:3185/api/auth/login", { method: "POST", headers: { Origin: env.E2E_BASE_URL, "Content-Type": "application/json", "X-Forwarded-For": "127.12.0.1" }, body: JSON.stringify({ email: "warmup@mvp.example.test", password: "InvalidFixturePassword2026" }) });
      await delay(500);
      if (command === "serve") { console.log("Database-backed synthetic app ready: " + env.E2E_BASE_URL + "/login"); await new Promise(resolve => server.once("exit", resolve)); }
      else {
        const runDirectory = path.join(review, "browser-" + Date.now()); fs.mkdirSync(runDirectory);
        const config = { testDir: path.join(root, "e2e"), testMatch: ["mvp-database.spec.ts", "authenticated-flows.spec.ts"], workers: 1, retries: 0, timeout: 90000, expect: { timeout: 15000 }, outputDir: path.join(runDirectory, "artifacts"), reporter: [["list"], ["json", { outputFile: path.join(runDirectory, "playwright-results.json") }]], use: { baseURL: env.E2E_BASE_URL, ignoreHTTPSErrors: true, trace: "retain-on-failure", screenshot: "only-on-failure" }, projects: [{ name: "desktop-chromium", use: { browserName: "chromium", viewport: { width: 1280, height: 900 } } }, { name: "mobile-chromium", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" } }] };
        fs.writeFileSync(path.join(temporary, "playwright.config.mjs"), "export default " + JSON.stringify(config));
        await execute(["node_modules/@playwright/test/cli.js", "test", "--config", path.join(temporary, "playwright.config.mjs"), ...process.argv.slice(3)], "browser.log");
        console.log("Database-backed browser tests passed");
      }
    } finally { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); if (server.exitCode === null) { const ended = new Promise(resolve => server.once("exit", resolve)); server.kill(); await ended; } fs.closeSync(log); }
  } else throw Error("Unknown local test command");
}
