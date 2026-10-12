import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { loadConfig, database, check, remember, sanitize, PRIVATE, RESULTS, GOOGLE_AUDIENCE, ORIGIN } from '../../tests/cloud-auth/runtime.mjs';

let app;
let applicationLog = '';
const servers = [];
let cache;
const messages = new Map();
const transports = { googleCertificates: 0, emailDeliveries: 0, pusherDeliveries: 0, unrelatedRequests: 0 };
const observations = [];
const safeEnv = () => ({ PATH: process.env.PATH, LANG: 'C.UTF-8', PLAYWRIGHT_BROWSERS_PATH: '/opt/psai-browsers', NODE_EXTRA_CA_CERTS: '/run/psai/ca.pem' });

async function waitApp() {
  for (let i = 0; i < 120; i++) {
    try { const response = await fetch('http://127.0.0.1:3100/login'); if (response.ok) return; } catch { /* Own application is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Owned optimized application did not become available');
}

async function startApp(runtime) {
  const env = { ...safeEnv(), NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3100', NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: runtime.isolated.database.connectionString, REDIS_URL: runtime.isolated.redisUrl,
    NEXTAUTH_SECRET: runtime.config.NEXTAUTH_SECRET, NEXT_PUBLIC_APP_URL: ORIGIN, NEXT_PUBLIC_GOOGLE_CLIENT_ID: GOOGLE_AUDIENCE,
    PUSHER_APP_ID: 'synthetic-app', PUSHER_SECRET: runtime.config.pusherSecret, NEXT_PUBLIC_PUSHER_KEY: 'synthetic-public-key', NEXT_PUBLIC_PUSHER_CLUSTER: 'mt1',
    EMAIL_PROVIDER: 'resend', RESEND_API_KEY: runtime.config.mailApiKey, EMAIL_FROM: 'ProctorShieldAI Synthetic <no-reply@example.invalid>' };
  app = spawn(process.execPath, ['.next/standalone/server.js'], { cwd: '/app', env, stdio: ['ignore', 'pipe', 'pipe'] });
  const collect = buffer => { applicationLog += buffer.toString(); check(applicationLog.length < 10_000_000, 'Application diagnostic log budget exceeded'); };
  app.stdout.on('data', collect); app.stderr.on('data', collect);
  await waitApp();
  // Warm only the owned instance through its real browser-initialization path;
  // do not replace an unavailable Redis reader with a test success response.
  for (let i = 0; i < 20; i++) {
    const response = await fetch('http://127.0.0.1:3100/api/auth/google', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.254' }, body: JSON.stringify({ mode: 'begin' }), signal: AbortSignal.timeout(5000) });
    if (response.status === 409 && (await response.json()).code === 'BROWSER_AUTH_INITIALIZED') return;
    check(response.status === 503, 'Owned authentication dependency preflight returned unexpected contract');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Owned authentication Redis state did not become ready');
}

async function stopApp() {
  if (!app || app.exitCode !== null) return;
  const current = app;
  await new Promise(resolve => { current.once('exit', resolve); current.kill('SIGTERM'); setTimeout(() => current.kill('SIGKILL'), 5000).unref(); });
}

function reply(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); }
async function payload(request) {
  let content = ''; for await (const chunk of request) { content += chunk; check(content.length <= 128_000, 'Synthetic transport payload limit'); }
  return content ? JSON.parse(content) : {};
}

async function listen(server, port) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  servers.push(server);
}

async function adapters(runtime) {
  const tls = { key: fs.readFileSync('/run/psai/tls-key.pem'), cert: fs.readFileSync('/run/psai/tls-cert.pem') };
  const signing = fs.readFileSync('/run/psai/google-key.pem', 'utf8');
  const publicKey = crypto.createPublicKey(signing).export({ type: 'spki', format: 'pem' });
  const provider = https.createServer(tls, async (request, response) => {
    try {
      const host = (request.headers.host || '').split(':')[0];
      const url = new URL(request.url, 'https://' + host);
      if (host === 'www.googleapis.com' && url.pathname === '/oauth2/v1/certs' && request.method === 'GET') {
        transports.googleCertificates++;
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' });
        return response.end(JSON.stringify({ 'psai-synthetic-rsa': publicKey }));
      }
      if (host === 'api.resend.com' && url.pathname === '/emails' && request.method === 'POST') {
        check(request.headers.authorization === 'Bearer ' + runtime.config.mailApiKey, 'Invalid synthetic email transport key');
        const body = await payload(request);
        check(typeof body.to === 'string' && body.to.endsWith('@example.invalid'), 'Non-synthetic email recipient rejected');
        const otp = String(body.html || '').match(/>(\d{6})<\/span>/)?.[1];
        if (otp) { messages.set(body.to, otp); remember(otp); }
        transports.emailDeliveries++;
        return reply(response, 200, { id: 'synthetic-mail-' + crypto.randomUUID() });
      }
      if (host === 'api-mt1.pusher.com' && url.pathname.startsWith('/apps/') && request.method === 'POST') {
        await payload(request); transports.pusherDeliveries++; return reply(response, 200, {});
      }
      transports.unrelatedRequests++; reply(response, 404, { error: 'No external provider exists in this isolated test environment' });
    } catch { reply(response, 400, { error: 'Controlled transport rejected request' }); }
  });
  await listen(provider, 443);
  const proxy = https.createServer(tls, (request, response) => {
    const observation = { path: request.url.split('?')[0], method: request.method, origin: request.headers.origin || null };
    const upstream = http.request({ host: '127.0.0.1', port: 3100, path: request.url, method: request.method,
      headers: { ...request.headers, host: '127.0.0.1:3443', 'x-forwarded-proto': 'https' } }, result => {
      observation.status = result.statusCode; observations.push(observation);
      response.writeHead(result.statusCode, result.headers); result.pipe(response);
    });
    upstream.on('error', () => reply(response, 503, { error: 'Owned local application unavailable' })); request.pipe(upstream);
  });
  await listen(proxy, 3443);
  const controller = https.createServer(tls, async (request, response) => {
    try {
      check(request.headers.authorization === 'Bearer ' + runtime.config.controlToken && request.method === 'POST', 'Unauthorized test controller');
      const body = await payload(request);
      if (request.url === '/mail') return reply(response, 200, { otp: messages.get(body.email) || null });
      if (request.url === '/google-token') {
        check(typeof body.email === 'string' && body.email.endsWith('@example.invalid') && typeof body.nonce === 'string', 'Non-synthetic Google identity rejected');
        const credential = jwt.sign({ email: body.email, email_verified: true, sub: 'synthetic-' + body.email, name: 'Synthetic Google User', nonce: body.nonce }, signing,
          { algorithm: 'RS256', keyid: 'psai-synthetic-rsa', issuer: 'https://accounts.google.com', audience: GOOGLE_AUDIENCE, expiresIn: '5m' });
        remember(credential); return reply(response, 200, { credential });
      }
      if (request.url === '/expire-browser') {
        check(/^[0-9a-f-]{36}$/.test(body.browserId), 'Invalid owned browser fixture');
        await cache.pexpire('proctorshield:browser-auth:' + body.browserId, 1);
        await new Promise(resolve => setTimeout(resolve, 20)); return reply(response, 200, { expired: true });
      }
      if (request.url === '/restart-application') { await stopApp(); await startApp(runtime); return reply(response, 200, { retainedVersionAwareReader: true }); }
      return reply(response, 404, { error: 'Unknown test operation' });
    } catch { reply(response, 400, { error: 'Test controller rejected request' }); }
  });
  await listen(controller, 3444);
}

async function main() {
  const runtime = loadConfig();
  fs.mkdirSync(PRIVATE, { recursive: true, mode: 0o700 }); fs.mkdirSync(RESULTS, { recursive: true });
  remember(...Object.values(runtime.config));
  check(Number(fs.readFileSync('/proc/sys/net/ipv4/ip_unprivileged_port_start', 'utf8')) <= 443, 'Isolated namespace cannot bind the required local TLS provider port');
  for (const host of ['www.googleapis.com', 'api.resend.com', 'api-mt1.pusher.com']) check((await dns.lookup(host)).address === '127.0.0.1', 'Provider hostname is not pinned to isolated loopback');
  const pool = await database();
  try {
    const existing = await pool.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'"); check(existing.rows[0].count === 0, 'Authentication database was not fresh');
    for (const directory of fs.readdirSync('prisma/migrations').sort()) {
      const file = 'prisma/migrations/' + directory + '/migration.sql';
      if (fs.existsSync(file)) await pool.query(fs.readFileSync(file, 'utf8'));
    }
    await pool.query("INSERT INTO roles(role_name) VALUES('student'),('teacher'),('admin')");
    const storage = await pool.query("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='password'");
    check(storage.rows[0]?.data_type === 'text', 'Versioned password storage is incompatible');
    fs.writeFileSync(RESULTS + '/storage-identity.json', JSON.stringify({ database: runtime.isolated.database.database,
      versionAwareStorage: 'TEXT', syntheticOnly: true, migrations: fs.readdirSync('prisma/migrations').filter(value => fs.existsSync('prisma/migrations/' + value + '/migration.sql')).length }, null, 2));
  } finally { await pool.end(); }
  cache = new Redis(runtime.isolated.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await cache.connect(); check(await cache.ping() === 'PONG', 'Disposable Redis unavailable');
  check(await cache.dbsize() === 0, 'Redis was not a fresh synthetic cache');
  const bind = await cache.config('GET', 'bind'); check(bind[1] === '127.0.0.1', 'Redis listener is not loopback-only');
  await cache.set('psai:disposable-instance', runtime.isolated.database.instanceId);
  await adapters(runtime); await startApp(runtime);
  const env = { ...safeEnv(), ...runtime.env, CI: 'true' };
  const exit = await new Promise(resolve => {
    const tests = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=tests/cloud-auth/playwright.config.mjs'], { cwd: '/app', env, stdio: ['ignore', 'pipe', 'pipe'] });
    tests.stdout.on('data', buffer => process.stdout.write(sanitize(buffer.toString())));
    tests.stderr.on('data', buffer => process.stderr.write(sanitize(buffer.toString())));
    tests.once('exit', resolve);
  });
  check(exit === 0, 'Actual authenticated browser/API tests failed');
  const { nativeZoomChecks, normalMobileChecks } = await import('../../tests/cloud-auth/native-zoom.mjs');
  const mobile = await normalMobileChecks();
  fs.writeFileSync(RESULTS + '/normal-mobile-results.json', JSON.stringify(mobile, null, 2));
  check(mobile.status === 'PASS', 'Actual normal mobile layout/accessibility checks failed');
  const zoom = await nativeZoomChecks();
  fs.writeFileSync(RESULTS + '/native-zoom-results.json', JSON.stringify(zoom, null, 2));
  check(zoom.status !== 'FAIL', 'Native zoom exposed an actual accessibility defect');
  await stopApp();
  const tracked = JSON.parse(fs.readFileSync(PRIVATE + '/secrets.json', 'utf8'));
  const leaks = tracked.filter(secret => applicationLog.includes(secret));
  fs.writeFileSync(RESULTS + '/sensitive-log-check.json', JSON.stringify({ status: leaks.length ? 'FAIL' : 'PASS', detectedValues: leaks.length, rawLogsPublished: false }, null, 2));
  check(leaks.length === 0, 'Sensitive synthetic values appeared in application logs; raw logs withheld');
  fs.writeFileSync(RESULTS + '/application-sanitized.log', sanitize(applicationLog));
  fs.writeFileSync(RESULTS + '/provider-distinction.json', JSON.stringify({ ...transports, GoogleEmailTransport: 'SIMULATED_LOCAL_TLS', liveGoogleOAuth: 'UNVERIFIED', liveEmail: 'UNVERIFIED', providerLayout: 'UNVERIFIED', sourceSHA: process.env.PSAI_SOURCE_SHA }, null, 2));
  console.log('Actual optimized authentication, PostgreSQL and Redis integration completed; external providers remain UNVERIFIED.');
}

try { await main(); }
catch (error) { console.error(sanitize(error.message || 'Authentication worker failed')); process.exitCode = 1; }
finally {
  await stopApp();
  if (fs.existsSync(RESULTS)) {
    const secretFile = PRIVATE + '/secrets.json';
    const tracked = fs.existsSync(secretFile) ? JSON.parse(fs.readFileSync(secretFile, 'utf8')) : [];
    const count = tracked.filter(secret => applicationLog.includes(secret)).length;
    fs.writeFileSync(RESULTS + '/sensitive-log-check.json', JSON.stringify({ status: count ? 'FAIL' : 'PASS', detectedValues: count, rawLogsPublished: false }, null, 2));
    fs.writeFileSync(RESULTS + '/application-sanitized.log', sanitize(applicationLog));
    fs.writeFileSync(RESULTS + '/http-boundary-observations.json', JSON.stringify(observations, null, 2));
    if (count) process.exitCode = 1;
  }
  for (const server of servers) await new Promise(resolve => server.close(resolve));
  if (cache) await cache.quit().catch(() => {});
}
