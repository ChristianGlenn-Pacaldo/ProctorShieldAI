import fs from 'node:fs';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { hashPassword } from '../../src/lib/password-hash.ts';
import { assertIsolatedNetwork, assertNoTestEnvFiles, authenticatedTestEnvironment, verifyIsolatedDatabaseIdentity } from '../helpers/isolated-test-environment.ts';

export const ORIGIN = 'https://127.0.0.1:3443';
export const GOOGLE_AUDIENCE = 'synthetic-cloud.apps.googleusercontent.com';
export const PRIVATE = '/tmp/psai-private';
export const RESULTS = '/tmp/psai-results';
export function check(condition, label) { if (!condition) throw new Error(label); }

export function loadConfig() {
  assertIsolatedNetwork();
  assertNoTestEnvFiles();
  assertRuntimeEnvironment(process.env);
  const config = JSON.parse(fs.readFileSync('/run/psai/auth-config.json', 'utf8'));
  return validateConfig(config);
}

export function assertRuntimeEnvironment(env) {
  check(!Object.entries(env).some(([name, value]) => value && (/^PG/i.test(name)
    || /^(?:DATABASE_URL|DIRECT_URL|REDIS_URL|PUSHER_|SMTP_|GMAIL_|RESEND_|PAYMONGO_|AWS_|S3_|GEMINI_API_KEY|GOOGLE_CLIENT_SECRET|NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED)/.test(name))), 'Inherited connection/provider/loader overrides forbidden');
  check(!env.NODE_EXTRA_CA_CERTS || env.NODE_EXTRA_CA_CERTS === '/run/psai/ca.pem', 'Unreviewed TLS trust override forbidden');
}

export function validateConfig(config) {
  const names = ['PSAI_ISOLATED_TESTS_APPROVED', 'PSAI_TEST_INSTANCE_ID', 'RUN_AUTHENTICATED_E2E', 'E2E_BASE_URL', 'E2E_DATABASE_URL', 'E2E_REDIS_URL', 'NEXTAUTH_SECRET'];
  const extra = ['controlToken', 'mailApiKey', 'pusherSecret'];
  check(Object.keys(config).every(name => [...names, ...extra].includes(name)) && names.every(name => typeof config[name] === 'string'), 'Unexpected private configuration');
  for (const name of extra) check(typeof config[name] === 'string' && config[name].length >= 32, 'Synthetic transport secret missing');
  const env = Object.fromEntries(names.map(name => [name, config[name]]));
  const isolated = authenticatedTestEnvironment(env);
  check(isolated.origin === ORIGIN, 'Unexpected local HTTPS origin');
  return { config, env, isolated };
}

export function remember(...values) {
  fs.mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
  const file = PRIVATE + '/secrets.json';
  const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  fs.writeFileSync(file, JSON.stringify([...new Set([...prior, ...values.filter(value => typeof value === 'string' && value.length >= 6)])]), { mode: 0o600 });
}

export function sanitize(value) {
  let text = String(value);
  const file = PRIVATE + '/secrets.json';
  const secrets = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  for (const secret of secrets.sort((a, b) => b.length - a.length)) text = text.split(secret).join('[SYNTHETIC-SECRET-REDACTED]');
  return text.replace(/(postgresql:\/\/[^:/\s]+:)[^@\s]+@/g, '$1[REDACTED]@');
}

export async function database() {
  const runtime = loadConfig();
  const pool = new Pool({ ...runtime.isolated.database.connection, max: 3 });
  try {
    await verifyIsolatedDatabaseIdentity(pool, runtime.isolated.database);
    const { rows } = await pool.query(`SELECT pg_get_userbyid(d.datdba) AS owner,
      current_setting('server_version_num')::int AS version,current_setting('listen_addresses') AS address,
      (SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=current_user) AS memberships,
      has_database_privilege(current_user,'postgres','CONNECT') AS other_access
      FROM pg_database d WHERE d.datname=current_database()`);
    check(rows.length === 1 && rows[0].owner === runtime.isolated.database.user && rows[0].memberships === 0 && rows[0].other_access === false
      && rows[0].version >= 180000 && rows[0].version < 190000 && rows[0].address === '127.0.0.1', 'Auth database owner/membership/version isolation failed');
    return pool;
  }
  catch { await pool.end(); throw new Error('Disposable authentication database identity failed'); }
}

export async function account(pool, { role = 'student', version = 'v1', password, status = 'active', malformedHash } = {}) {
  await verifyIsolatedDatabaseIdentity(pool, loadConfig().isolated.database);
  check(['student', 'teacher', 'admin'].includes(role), 'Invalid synthetic role');
  const id = crypto.randomUUID();
  password ??= 'PsaiSynthetic12!' + crypto.randomBytes(12).toString('hex');
  const stored = malformedHash ?? (version === 'legacy' ? await bcrypt.hash(password, 12) : await hashPassword(password));
  remember(password, stored);
  const email = 'psai-auth-' + id + '@example.invalid';
  const result = await pool.query(`INSERT INTO users (id,full_name,email,password,role_id,status,session_version)
    SELECT $1,$2,$3,$4,id,$5,0 FROM roles WHERE role_name=$6 RETURNING id`, [id, 'Synthetic ' + role, email, stored, status, role]);
  check(result.rowCount === 1, 'Synthetic role record missing');
  return { id, email, password, role, stored };
}

export async function state(pool, user) {
  const result = await pool.query('SELECT password,session_version,status,full_name FROM users WHERE id=$1', [user.id]);
  check(result.rows.length === 1, 'Owned synthetic account missing');
  remember(result.rows[0].password);
  return result.rows[0];
}

let ipCounter = 1;
export async function context(browser, options = {}) {
  const ip = '192.0.2.' + ((ipCounter++ % 240) + 1);
  return browser.newContext({ ignoreHTTPSErrors: true, extraHTTPHeaders: { Origin: ORIGIN, 'x-forwarded-for': ip }, ...options });
}

export async function call(context, path, data, method = 'POST', extra = {}) {
  const response = await context.request.fetch(ORIGIN + path, { method, ...(data === undefined ? {} : { data }), maxRedirects: 0, ...extra });
  const text = await response.text();
  if (data) for (const key of ['password', 'newPassword', 'currentPassword', 'otpCode']) {
    if (typeof data[key] === 'string' && data[key].length >= 6) {
      remember(data[key]);
      check(!text.includes(data[key]) && !response.url().includes(data[key]) && !(response.headers().location || '').includes(data[key]), 'Sensitive value reflected by authentication response or URL');
    }
  }
  const cookies = await context.cookies(ORIGIN);
  remember(...cookies.map(cookie => cookie.value));
  let body = {}; try { body = JSON.parse(text); } catch { /* HTML native fallback is not parsed as authentication success. */ }
  return { response, body, status: response.status() };
}

export async function bootstrapCall(context, path, data) {
  let result = await call(context, path, data);
  if (result.status === 409 && result.body.code === 'BROWSER_AUTH_INITIALIZED') result = await call(context, path, data);
  return result;
}

export async function login(context, user, password = user.password) {
  const result = await bootstrapCall(context, '/api/auth/login', { email: user.email, password });
  check(result.status === 200 && result.body.success === true && result.body.user?.id === user.id && result.body.user?.role === user.role, 'Actual stored-account password login failed');
  check(!('token' in result.body), 'Session token returned in JSON');
  const cookies = await context.cookies(ORIGIN);
  const kind = user.role === 'admin' ? 'admin' : 'user';
  const cookie = cookies.find(value => value.name === 'ps_session_' + kind);
  check(cookie?.httpOnly && cookie?.secure && cookie?.sameSite === 'Lax' && cookie?.path === '/', 'Session cookie security attributes failed');
  check(!cookies.some(value => value.name === 'ps_session_' + (kind === 'admin' ? 'user' : 'admin')), 'Opposite session cookie survived login');
  const accepted = await call(context, '/api/auth/session?scope=' + kind + (kind === 'user' ? '&role=' + user.role : ''), undefined, 'GET');
  check(accepted.status === 200 && accepted.body.user?.userId === user.id && accepted.body.user?.role === user.role, 'Actual session reader rejected stored identity');
  const denied = await call(context, '/api/auth/session?scope=' + (kind === 'admin' ? 'user' : 'admin'), undefined, 'GET');
  check(denied.status === 401, 'Admin/User reader isolation failed');
  return cookie;
}

export async function control(action, data = {}) {
  const { config } = loadConfig();
  const response = await fetch('https://127.0.0.1:3444/' + action, { method: 'POST', headers: { Authorization: 'Bearer ' + config.controlToken, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  check(response.ok, 'Local transport controller rejected request');
  const body = await response.json();
  remember(body.otp, body.credential);
  return body;
}
