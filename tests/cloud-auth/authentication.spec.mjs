import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { verifyPassword } from '../../src/lib/password-hash.ts';
import { verifyIsolatedDatabaseIdentity } from '../helpers/isolated-test-environment.ts';
import { ORIGIN, check, loadConfig, remember, database, account, state, context, call, bootstrapCall, login, control } from './runtime.mjs';

test.describe.configure({ mode: 'default' });
let pool;
let contexts = [];
const sessionPath = user => '/api/auth/session?scope=' + (user.role === 'admin' ? 'admin' : 'user&role=' + user.role);
const profilePath = user => '/api/auth/profile?scope=' + (user.role === 'admin' ? 'admin' : 'user&role=' + user.role);
async function browserContext(browser, options) { const value = await context(browser, options); contexts.push(value); return value; }
test.beforeAll(async () => { pool = await database(); });
test.beforeEach(async () => { await verifyIsolatedDatabaseIdentity(pool, loadConfig().isolated.database); });
test.afterEach(async () => { await Promise.all(contexts.map(value => value.close())); contexts = []; });
test.afterAll(async () => { await pool.end(); });

for (const role of ['student', 'teacher', 'admin']) for (const version of ['legacy', 'v1']) {
  test(`AUTH01 ${role} ${version}: actual login, stored reader, HttpOnly cookies and dashboard refresh`, async ({ browser }) => {
    const user = await account(pool, { role, version });
    const c = await browserContext(browser);
    await login(c, user);
    check((await state(pool, user)).password === user.stored, 'Login silently rewrote stored password');
    check((await state(pool, user)).session_version === 0, 'Login unexpectedly incremented sessionVersion');
    const page = await c.newPage();
    await page.goto(ORIGIN + '/dashboard/' + role, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp('/dashboard/' + role + '(?:/|$)'));
    await expect(page.locator('h1').first()).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    check((await call(c, sessionPath(user), undefined, 'GET')).status === 200, 'Refresh lost actual session');
  });
}

for (const role of ['student', 'teacher', 'admin']) {
  test(`AUTH02 ${role}: wrong password, wrong requested role, inactive and suspended accounts rejected`, async ({ browser }) => {
    const user = await account(pool, { role });
    const c = await browserContext(browser);
    check((await bootstrapCall(c, '/api/auth/login', { email: user.email, password: 'SyntheticWrong12!' })).status === 401, 'Wrong password accepted');
    check((await call(c, '/api/auth/login', { email: user.email, password: user.password, role: role === 'student' ? 'teacher' : 'student' })).status === 403, 'Wrong requested role accepted');
    for (const status of ['disabled', 'inactive', 'suspended']) {
      const blocked = await account(pool, { role, status });
      check((await call(c, '/api/auth/login', { email: blocked.email, password: blocked.password })).status === 403, 'Blocked account accepted');
      check((await state(pool, blocked)).session_version === 0, 'Rejected login changed account version');
    }
    check((await call(c, sessionPath(user), undefined, 'GET')).status === 401, 'Rejected credentials issued an accepted session');
  });
}

for (const role of ['student', 'teacher', 'admin']) {
  test(`AUTH03 ${role}: actual hydrated unified form reaches the correct role dashboard`, async ({ browser }) => {
    const user = await account(pool, { role });
    const c = await browserContext(browser);
    const page = await c.newPage();
    await page.goto(ORIGIN + '/login', { waitUntil: 'domcontentloaded' });
    const form = page.locator('form').filter({ has: page.locator('input[name="password"]') });
    await form.locator('input[name="email"]').fill(user.email);
    await form.locator('input[name="password"]').fill(user.password);
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp('/dashboard/' + role + '(?:/|$)'), { timeout: 20_000 });
    check((await call(c, sessionPath(user), undefined, 'GET')).status === 200, 'UI success did not establish actual persisted session');
    remember(...(await c.cookies(ORIGIN)).map(cookie => cookie.value));
  });
}

test('AUTH04 actual protected API role boundaries and anonymous access', async ({ browser }) => {
  const unauthenticated = await browserContext(browser);
  check((await call(unauthenticated, '/api/dashboard/admin', undefined, 'GET')).status === 401, 'Anonymous Admin API access accepted');
  for (const role of ['student', 'teacher', 'admin']) {
    const user = await account(pool, { role }); const c = await browserContext(browser); await login(c, user);
    const admin = await call(c, '/api/dashboard/admin', undefined, 'GET');
    check(admin.status === (role === 'admin' ? 200 : 401), 'Admin API role isolation failed');
    const teacher = await call(c, '/api/dashboard/teacher', undefined, 'GET');
    check(teacher.status === (role === 'teacher' ? 200 : 401), 'Teacher API role isolation failed');
    if (role === 'student') check((await call(c, '/api/quizzes', { subjectName: 'Synthetic', title: 'Unauthorized' })).status === 401, 'Student created Teacher quiz');
  }
});

const boundaries = [
  ['ASCII71', 'A'.repeat(70) + '1', true], ['ASCII72', 'A'.repeat(71) + '1', true], ['ASCII73', 'A'.repeat(72) + '1', false],
  ['Unicode71', 'A' + 'é'.repeat(34) + '12', true], ['Unicode72', 'A' + 'é'.repeat(35) + '1', true], ['Unicode73', 'A' + 'é'.repeat(35) + '12', false],
  ['embeddedNUL', 'Synthetic\0Password12!', false], ['appendedNUL', 'SyntheticPassword12!\0', false],
];
for (const [label, password, valid] of boundaries) {
  test(`AUTH05 registration ${label}: actual writer boundary`, async ({ browser }) => {
    remember(password); const email = 'psai-registration-' + crypto.randomUUID() + '@example.invalid';
    const c = await browserContext(browser);
    const result = await bootstrapCall(c, '/api/auth/register', { fullName: 'Synthetic Registration', email, password, confirmPassword: password, role: 'student' });
    check(result.status === (valid ? 201 : 400), 'Registration byte/NUL policy failed');
    const rows = await pool.query('SELECT password,session_version FROM users WHERE email=$1', [email]);
    check(rows.rowCount === (valid ? 1 : 0), 'Rejected registration persisted an account');
    if (valid) {
      remember(rows.rows[0].password);
      check(rows.rows[0].password.startsWith('psai:pw:v1:$2b$12$') && await verifyPassword(password, rows.rows[0].password), 'Registration did not store compatible strict cost12 hash');
    }
  });
}

test('AUTH06 Teacher registration and restricted Admin self-registration', async ({ browser }) => {
  for (const role of ['teacher', 'admin']) {
    const c = await browserContext(browser); const email = 'psai-register-role-' + crypto.randomUUID() + '@example.invalid';
    const password = 'SyntheticRegister12!' + crypto.randomBytes(8).toString('hex'); remember(password);
    const result = await bootstrapCall(c, '/api/auth/register', { fullName: 'Synthetic Role', email, password, role });
    check(result.status === (role === 'teacher' ? 201 : 403), 'Registration role boundary failed');
    check((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rowCount === (role === 'teacher' ? 1 : 0), 'Admin registration persisted');
  }
});

test('AUTH07 strict suffix rejection and overlong legacy login compatibility', async ({ browser }) => {
  const exact = 'A'.repeat(71) + '1';
  const strict = await account(pool, { password: exact }); const legacy = await account(pool, { password: exact + 'historic-suffix', version: 'legacy' });
  const one = await browserContext(browser); const two = await browserContext(browser);
  check((await bootstrapCall(one, '/api/auth/login', { email: strict.email, password: exact + 'x' })).status === 401, 'Strict suffix accepted');
  for (const invalid of [exact + '\0', 'A\0' + exact.slice(1)]) check((await call(one, '/api/auth/login', { email: strict.email, password: invalid })).status === 401, 'Strict NUL verification accepted');
  await login(one, strict); await login(two, legacy, exact + 'different-legacy-suffix');
  check((await state(pool, legacy)).password === legacy.stored, 'Legacy hash automatically migrated');
});

test('AUTH08 malformed and unknown stored hash versions reject without mutation', async ({ browser }) => {
  const payload = await bcrypt.hash('SyntheticMalformed12!', 12);
  for (const malformedHash of ['psai:pw:v2:' + payload, 'psai:pw:v1:' + payload + 'x', 'psai:pw:v1:invalid', 'not-a-bcrypt-record']) {
    const user = await account(pool, { malformedHash }); const c = await browserContext(browser);
    check((await bootstrapCall(c, '/api/auth/login', { email: user.email, password: 'SyntheticMalformed12!' })).status === 401, 'Malformed hash accepted');
    check((await state(pool, user)).password === malformedHash, 'Malformed record overwritten');
  }
});

for (const role of ['student', 'teacher', 'admin']) {
  test(`AUTH09 ${role}: legacy password change commits strict hash/version and revokes another browser`, async ({ browser }) => {
    const user = await account(pool, { role, version: 'legacy' });
    const one = await browserContext(browser); const two = await browserContext(browser); await login(one, user); await login(two, user);
    const newPassword = 'ChangedSynthetic12!' + crypto.randomBytes(8).toString('hex'); remember(newPassword);
    check((await call(one, profilePath(user), { currentPassword: user.password, newPassword }, 'PUT')).status === 200, 'Password change failed');
    const stored = await state(pool, user);
    check(stored.session_version === 1 && stored.password.startsWith('psai:pw:v1:') && await verifyPassword(newPassword, stored.password), 'Password/version were not committed atomically');
    check((await call(two, sessionPath(user), undefined, 'GET')).status === 401, 'Another browser retained revoked version');
    check((await call(one, sessionPath(user), undefined, 'GET')).status === 200, 'Committed new cookie rejected');
    const retry = await browserContext(browser);
    check((await bootstrapCall(retry, '/api/auth/login', { email: user.email, password: user.password })).status === 401, 'Old password still valid');
    await login(retry, { ...user, password: newPassword });
  });
}

test('AUTH10 name-only, no-op and rejected password changes preserve version/hash', async ({ browser }) => {
  const user = await account(pool); const c = await browserContext(browser); await login(c, user);
  check((await call(c, profilePath(user), { fullName: 'Synthetic Edited Name' }, 'PUT')).status === 200, 'Name update failed');
  check((await state(pool, user)).session_version === 0 && (await state(pool, user)).password === user.stored, 'Name update revoked sessions');
  check((await call(c, profilePath(user), {}, 'PUT')).status === 200, 'No-op profile failed');
  for (const newPassword of ['A'.repeat(72) + '1', 'SyntheticNew12!\0']) check((await call(c, profilePath(user), { currentPassword: user.password, newPassword }, 'PUT')).status === 400, 'Unsafe password update accepted');
  check((await call(c, profilePath(user), { currentPassword: 'WrongSynthetic12!', newPassword: 'ValidSynthetic12!' }, 'PUT')).status === 400, 'Wrong current password accepted');
  check((await state(pool, user)).session_version === 0 && (await state(pool, user)).password === user.stored, 'Rejected update changed account');
});

test('AUTH11 concurrent actual profile requests commit exactly one password/session version', async ({ browser }) => {
  const user = await account(pool); const one = await browserContext(browser); const two = await browserContext(browser); await login(one, user); await login(two, user);
  const passwords = ['ConcurrentSynthetic12A!', 'ConcurrentSynthetic12B!']; remember(...passwords);
  const results = await Promise.all([one, two].map((c, i) => call(c, profilePath(user), { currentPassword: user.password, newPassword: passwords[i] }, 'PUT')));
  check(results.filter(value => value.status === 200).length === 1 && results.filter(value => value.status === 401).length === 1, 'Concurrent changes did not serialize');
  const stored = await state(pool, user); check(stored.session_version === 1, 'Concurrent changes incremented twice');
  const winner = results.findIndex(value => value.status === 200); check(await verifyPassword(passwords[winner], stored.password) && !await verifyPassword(passwords[1-winner], stored.password), 'Stored password does not match committed winner');
});

async function fault(user, operation) {
  const name = 'psai_fault_' + crypto.randomBytes(8).toString('hex');
  await pool.query(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${user.id}' AND NEW.activity IN ('Updated profile settings','Password reset via forgot password flow') THEN RAISE EXCEPTION 'Synthetic audit rollback fault'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER "${name}" BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
  try { await operation(); }
  finally { await pool.query(`DROP TRIGGER "${name}" ON activity_logs`); await pool.query(`DROP FUNCTION "${name}"()`); }
}

test('AUTH12 profile audit failure rolls back actual hash and sessionVersion transaction', async ({ browser }) => {
  const user = await account(pool); const c = await browserContext(browser); await login(c, user); const before = await state(pool, user);
  await fault(user, async () => {
    check((await call(c, profilePath(user), { currentPassword: user.password, newPassword: 'RollbackSynthetic12!' }, 'PUT')).status === 500, 'Synthetic audit fault did not fail profile transaction');
  });
  const after = await state(pool, user); check(after.password === before.password && after.session_version === before.session_version, 'Failed profile transaction partially committed');
  check((await call(c, sessionPath(user), undefined, 'GET')).status === 200, 'Rolled-back account lost valid session');
});

async function recovery(c, user) {
  check((await call(c, '/api/auth/forgot-password', { email: user.email })).status === 200, 'Forgot-password request failed');
  const mail = await control('mail', { email: user.email }); check(/^\d{6}$/.test(mail.otp), 'Controlled email did not capture actual generated OTP');
  return mail.otp;
}

for (const role of ['student', 'teacher', 'admin']) {
  test(`AUTH13 ${role}: actual recovery consumes OTP, writes v1, revokes old sessions and rejects replay`, async ({ browser }) => {
    const user = await account(pool, { role, version: 'legacy' }); const c = await browserContext(browser); await login(c, user);
    const otpCode = await recovery(c, user); const newPassword = 'RecoveredSynthetic12!' + crypto.randomBytes(8).toString('hex'); remember(newPassword);
    const storedOtp = await pool.query('SELECT code FROM otp_codes WHERE user_id=$1', [user.id]); check(storedOtp.rowCount === 1 && storedOtp.rows[0].code !== otpCode, 'OTP persisted in plaintext'); remember(storedOtp.rows[0].code);
    check((await call(c, '/api/auth/reset-password', { email: user.email, otpCode, newPassword })).status === 200, 'Actual reset failed');
    const stored = await state(pool, user); check(stored.session_version === 1 && stored.password.startsWith('psai:pw:v1:') && await verifyPassword(newPassword, stored.password), 'Recovery did not commit version-aware hash');
    check((await call(c, sessionPath(user), undefined, 'GET')).status === 401, 'Reset did not revoke old cookie');
    check((await call(c, '/api/auth/reset-password', { email: user.email, otpCode, newPassword })).status === 401, 'OTP replay accepted');
    await login(await browserContext(browser), { ...user, password: newPassword });
  });
}

test('AUTH14 expired, invalid and wrong-purpose OTP cannot change an owned account', async ({ browser }) => {
  const user = await account(pool); const c = await browserContext(browser); const otpCode = await recovery(c, user);
  await pool.query("UPDATE otp_codes SET expires_at=now()-interval '1 second' WHERE user_id=$1", [user.id]);
  check((await call(c, '/api/auth/reset-password', { email: user.email, otpCode, newPassword: 'NotChangedSynthetic12!' })).status === 401, 'Expired OTP accepted');
  const currentReset = await recovery(c, user);
  check((await bootstrapCall(c, '/api/auth/verify-otp', { userId: user.id, otpCode: currentReset })).status === 401, 'Valid reset OTP accepted for login purpose');
  check((await state(pool, user)).password === user.stored && (await state(pool, user)).session_version === 0, 'Invalid OTP changed account');
});

test('AUTH15 actual reset audit failure rolls back OTP consumption/hash/version', async ({ browser }) => {
  const user = await account(pool); const c = await browserContext(browser); const otpCode = await recovery(c, user);
  await fault(user, async () => check((await call(c, '/api/auth/reset-password', { email: user.email, otpCode, newPassword: 'ResetRollbackSynthetic12!' })).status === 500, 'Reset fault did not fail'));
  check((await state(pool, user)).password === user.stored && (await state(pool, user)).session_version === 0, 'Reset partially committed');
  check((await pool.query('SELECT id FROM otp_codes WHERE user_id=$1', [user.id])).rowCount === 1, 'Rollback consumed OTP');
  check((await call(c, '/api/auth/reset-password', { email: user.email, otpCode, newPassword: 'ResetRollbackSynthetic12!' })).status === 200, 'Retry after rollback failed');
});

test('AUTH16 concurrent recovery commits one reset; current conflict response is recorded honestly', async ({ browser }) => {
  const user = await account(pool); const one = await browserContext(browser); const two = await browserContext(browser); const otpCode = await recovery(one, user);
  const results = await Promise.all([one, two].map((c, i) => call(c, '/api/auth/reset-password', { email: user.email, otpCode, newPassword: 'ResetRaceSynthetic12' + i + '!' })));
  check(results.filter(value => value.status === 200).length === 1, 'Concurrent reset committed more than once');
  check(results.filter(value => [401, 500].includes(value.status)).length === 1, 'Unexpected conflicting reset contract');
  check((await state(pool, user)).session_version === 1, 'Concurrent reset incremented twice');
});

test('AUTH17 logout revokes other devices and retained old cookies fail the actual reader', async ({ browser }) => {
  const user = await account(pool); const one = await browserContext(browser); const two = await browserContext(browser); await login(one, user); await login(two, user);
  check((await call(one, '/api/auth/logout', {})).status === 200, 'Logout failed');
  check((await state(pool, user)).session_version === 1, 'Logout did not commit revocation');
  check((await call(one, sessionPath(user), undefined, 'GET')).status === 401 && (await call(two, sessionPath(user), undefined, 'GET')).status === 401, 'Revoked session remained accepted');
});

test('AUTH18 actual session reader rejects expired/tampered tokens derived from real login', async ({ browser }) => {
  const user = await account(pool); const c = await browserContext(browser); const cookie = await login(c, user);
  const payload = jwt.decode(cookie.value); check(payload && typeof payload === 'object', 'Issued JWT shape invalid');
  // Negative fixture only: never use a hand-signed token to establish successful authentication.
  const expired = jwt.sign({ ...payload, exp: Math.floor(Date.now()/1000)-60 }, loadConfig().config.NEXTAUTH_SECRET, { algorithm: 'HS256' }); remember(expired);
  await c.addCookies([{ ...cookie, value: expired }]);
  check((await call(c, sessionPath(user), undefined, 'GET')).status === 401, 'Expired JWT accepted');
  const parts = cookie.value.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1); remember(parts.join('.'));
  await c.addCookies([{ ...cookie, value: parts.join('.') }]);
  check((await call(c, sessionPath(user), undefined, 'GET')).status === 401, 'Tampered JWT accepted');
});

test('AUTH19 status/role changes and Redis browser-generation revocation fail closed', async ({ browser }) => {
  const user = await account(pool); const c = await browserContext(browser); await login(c, user);
  await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [user.id]);
  check((await call(c, sessionPath(user), undefined, 'GET')).status === 401, 'Suspended stored account accepted');
  await pool.query("UPDATE users SET status='active',role_id=(SELECT id FROM roles WHERE role_name='teacher') WHERE id=$1", [user.id]);
  check((await call(c, sessionPath(user), undefined, 'GET')).status === 401, 'Stale role accepted');
  const other = await account(pool); const second = await browserContext(browser); await login(second, other);
  const browserId = (await second.cookies(ORIGIN)).find(value => value.name === 'ps_browser_auth').value;
  await control('expire-browser', { browserId });
  check((await call(second, sessionPath(other), undefined, 'GET')).status === 401, 'Expired Redis browser state accepted');
});

for (const role of ['student', 'teacher']) {
  test(`AUTH20 ${role}: actual Google signature/OTP lifecycle using simulated certificate/email transport`, async ({ browser }) => {
    const user = await account(pool, { role, version: 'legacy' }); const c = await browserContext(browser);
    const begin = await bootstrapCall(c, '/api/auth/google', { mode: 'begin' }); check(begin.status === 200, 'Google intent failed');
    const token = await control('google-token', { email: user.email, nonce: begin.body.nonce });
    const challenge = await call(c, '/api/auth/google', { mode: 'signin', intent: begin.body.intent, credential: token.credential });
    check(challenge.status === 200 && challenge.body.requiresMfa === true && challenge.body.role === role, 'Google challenge failed');
    const mail = await control('mail', { email: user.email });
    const done = await call(c, '/api/auth/verify-otp', { userId: user.id, otpCode: mail.otp, challenge: challenge.body.challenge });
    check(done.status === 200, 'Google OTP verification failed');
    check((await call(c, sessionPath(user), undefined, 'GET')).status === 200, 'Google OTP did not create actual stored session');
    check((await state(pool, user)).password === user.stored, 'Google login rewrote legacy password');
    check((await call(c, '/api/auth/verify-otp', { userId: user.id, otpCode: mail.otp, challenge: challenge.body.challenge })).status === 401, 'Google OTP replay accepted');
  });
}

test('AUTH21 Admin Google login remains forbidden despite a valid simulated provider token', async ({ browser }) => {
  const user = await account(pool, { role: 'admin' }); const c = await browserContext(browser);
  const begin = await bootstrapCall(c, '/api/auth/google', { mode: 'begin' }); const token = await control('google-token', { email: user.email, nonce: begin.body.nonce });
  check((await call(c, '/api/auth/google', { mode: 'signin', intent: begin.body.intent, credential: token.credential })).status === 403, 'Admin Google authentication enabled');
  check((await call(c, sessionPath(user), undefined, 'GET')).status === 401, 'Admin Google issued accepted session');
});

test('AUTH22 stale Google OTP challenge after actual password replacement cannot authenticate', async ({ browser }) => {
  const user = await account(pool); const google = await browserContext(browser); const password = await browserContext(browser); await login(password, user);
  const begin = await bootstrapCall(google, '/api/auth/google', { mode: 'begin' }); const token = await control('google-token', { email: user.email, nonce: begin.body.nonce });
  const challenge = await call(google, '/api/auth/google', { mode: 'signin', intent: begin.body.intent, credential: token.credential });
  check(challenge.status === 200, 'Initial Google OTP challenge failed'); const mail = await control('mail', { email: user.email });
  check((await call(password, profilePath(user), { currentPassword: user.password, newPassword: 'ChangedBeforeOtp12!' }, 'PUT')).status === 200, 'Actual password replacement failed');
  check((await call(google, '/api/auth/verify-otp', { userId: user.id, otpCode: mail.otp, challenge: challenge.body.challenge })).status === 401, 'Stale Google challenge accepted new account state');
});

test('AUTH23 compatible-reader restart preserves mixed legacy/v1 sessions and logins', async ({ browser }) => {
  const legacy = await account(pool, { version: 'legacy' }); const strict = await account(pool);
  const one = await browserContext(browser); const two = await browserContext(browser); await login(one, legacy); await login(two, strict);
  await control('restart-application');
  check((await call(one, sessionPath(legacy), undefined, 'GET')).status === 200 && (await call(two, sessionPath(strict), undefined, 'GET')).status === 200, 'Compatible reader restart invalidated persisted sessions');
  await login(await browserContext(browser), legacy); await login(await browserContext(browser), strict);
});

test('AUTH24 create/join/start/answer/submit/readback uses actual authenticated endpoints and PostgreSQL', async ({ browser }) => {
  const teacher = await account(pool, { role: 'teacher' }); const student = await account(pool); const tc = await browserContext(browser); const sc = await browserContext(browser); await login(tc, teacher); await login(sc, student);
  const create = await call(tc, '/api/quizzes', { subjectName: 'Synthetic Integration', title: 'Synthetic Assessment', duration: 10, isGamified: false, isAiGenerated: false,
    quizMode: 'proctored', questions: [{ questionText: 'Select the correct synthetic answer', questionType: 'multiple_choice', points: 1,
      choices: [{ choiceText: 'Correct synthetic answer', isCorrect: true }, { choiceText: 'Other synthetic answer', isCorrect: false }] }] });
  check(create.status === 201 && create.body.quiz?.id, 'Actual Teacher quiz creation failed'); const quiz = create.body.quiz;
  check((await call(sc, '/api/quizzes/join', { accessCode: quiz.accessCode })).status === 201, 'Actual Student enrollment failed');
  check((await call(tc, '/api/quizzes/' + quiz.id + '/start', {})).status === 200, 'Actual Teacher start failed');
  const detail = await call(sc, '/api/quizzes/' + quiz.id, undefined, 'GET'); check(detail.status === 200 && detail.body.studentQuizId, 'Actual attempt detail failed');
  await sc.grantPermissions(['camera', 'microphone']);
  const probe = await sc.newPage(); await probe.goto(ORIGIN + '/login/student', { waitUntil: 'domcontentloaded' });
  const capabilities = await probe.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const value = { deviceType: 'desktop', secureContext: isSecureContext, cameraSupported: true,
      cameraPermission: stream.getVideoTracks().length > 0, microphoneSupported: true,
      microphonePermission: stream.getAudioTracks().length > 0, mediaRecorderSupported: typeof MediaRecorder !== 'undefined',
      fullscreenSupported: Boolean(document.documentElement.requestFullscreen), visibilitySupported: 'hidden' in document,
      viewportWidth: innerWidth, viewportHeight: innerHeight };
    stream.getTracks().forEach(track => track.stop()); return value;
  });
  check((await call(sc, '/api/quizzes/session', { quizId: quiz.id, capabilities })).status === 200, 'Actual device-profile preflight failed');
  const begin = await call(sc, '/api/quizzes/session', { action: 'start', quizId: quiz.id, studentQuizId: detail.body.studentQuizId }); check(begin.status === 200, 'Actual attempt entry failed');
  const question = await pool.query('SELECT q.id AS question_id,c.id AS choice_id FROM questions q JOIN choices c ON c.question_id=q.id WHERE q.quiz_id=$1 AND c.is_correct=true', [quiz.id]);
  const answer = question.rows[0]; check(Boolean(answer), 'Created assessment lacks persisted answer');
  check((await call(sc, '/api/quizzes/answer', { quizId: quiz.id, questionId: answer.question_id, choiceId: answer.choice_id,
    studentQuizId: detail.body.studentQuizId, sessionId: begin.body.sessionId })).status === 200, 'Actual answer persistence failed');
  const submit = await call(sc, '/api/quizzes/submit', { quizId: quiz.id, studentQuizId: detail.body.studentQuizId,
    sessionId: begin.body.sessionId, reason: 'manual', answers: { [answer.question_id]: answer.choice_id } }); check(submit.status === 200, 'Actual grading/submission failed');
  const stored = await pool.query('SELECT score,quiz_status,end_time FROM student_quizzes WHERE id=$1 AND student_id=$2', [detail.body.studentQuizId, student.id]);
  check(stored.rowCount === 1 && Number(stored.rows[0].score) === 100 && stored.rows[0].quiz_status === 'completed' && stored.rows[0].end_time, 'Actual result not durable');
  check((await call(sc, '/api/quizzes', undefined, 'GET')).status === 200, 'Actual Student results list failed');
});

for (const [label, newPassword, valid] of [boundaries[1], boundaries[4], boundaries[2], boundaries[6]]) {
  test(`AUTH25 profile ${label}: actual byte/NUL boundary preserves rejected records`, async ({ browser }) => {
    const user = await account(pool, { role: 'teacher', version: 'legacy' }); const c = await browserContext(browser); await login(c, user);
    const result = await call(c, profilePath(user), { currentPassword: user.password, newPassword }, 'PUT');
    check(result.status === (valid ? 200 : 400), 'Actual profile boundary failed');
    const stored = await state(pool, user);
    if (valid) check(stored.session_version === 1 && stored.password.startsWith('psai:pw:v1:') && await verifyPassword(newPassword, stored.password), 'Valid profile boundary did not persist strict hash');
    else check(stored.session_version === 0 && stored.password === user.stored, 'Rejected profile boundary changed record');
  });
}

test('AUTH26 recovery rejects overlong/NUL inputs without consuming OTP; exact Unicode72 succeeds', async ({ browser }) => {
  const user = await account(pool); const c = await browserContext(browser); const otpCode = await recovery(c, user);
  for (const newPassword of [boundaries[2][1], boundaries[6][1]]) {
    check((await call(c, '/api/auth/reset-password', { email: user.email, otpCode, newPassword })).status === 400, 'Recovery setting policy rejected incorrectly');
    check((await pool.query('SELECT id FROM otp_codes WHERE user_id=$1', [user.id])).rowCount === 1, 'Rejected password consumed OTP');
    check((await state(pool, user)).session_version === 0, 'Rejected reset changed version');
  }
  const newPassword = boundaries[4][1];
  check((await call(c, '/api/auth/reset-password', { email: user.email, otpCode, newPassword })).status === 200, 'Unicode72 reset failed');
  check(await verifyPassword(newPassword, (await state(pool, user)).password), 'Unicode recovery reader failed');
});

for (const role of ['student', 'teacher']) {
  test(`AUTH27 ${role} legacy-portal Google OTP uses actual stored role and login-purpose OTP`, async ({ browser }) => {
    const user = await account(pool, { role }); const c = await browserContext(browser);
    const token = await control('google-token', { email: user.email, nonce: crypto.randomUUID() });
    const result = await bootstrapCall(c, '/api/auth/google', { credential: token.credential, role });
    check(result.status === 200 && result.body.role === role && !result.body.challenge, 'Legacy-portal Google challenge contract failed');
    const mail = await control('mail', { email: user.email });
    check((await call(c, '/api/auth/verify-otp', { userId: user.id, otpCode: mail.otp })).status === 200, 'Legacy-portal OTP failed');
    check((await call(c, sessionPath(user), undefined, 'GET')).status === 200, 'Legacy-portal actual session rejected');
  });
}

test('AUTH28 password replacement racing login never accepts old credentials at the new version', async ({ browser }) => {
  const user = await account(pool); const owner = await browserContext(browser); const racing = await browserContext(browser); await login(owner, user);
  // Bootstrap the real new browser before the race without issuing a session.
  const begin = await call(racing, '/api/auth/google', { mode: 'begin' }); check(begin.status === 409 && begin.body.code === 'BROWSER_AUTH_INITIALIZED', 'New browser did not require real initialization');
  const results = await Promise.all([
    call(owner, profilePath(user), { currentPassword: user.password, newPassword: 'RaceReplacementSynthetic12!' }, 'PUT'),
    call(racing, '/api/auth/login', { email: user.email, password: user.password }),
  ]);
  check(results[0].status === 200 && [200, 401].includes(results[1].status), 'Unexpected password/login race contract');
  check((await state(pool, user)).session_version === 1, 'Race did not commit one replacement');
  check((await call(racing, sessionPath(user), undefined, 'GET')).status === 401, 'Old credentials authorized new stored version');
});

test('AUTH29 actual Origin-protected handlers reject missing or cross-site headers before auth mutation', async ({ browser }) => {
  const missing = await browserContext(browser, { extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.250' } });
  const foreign = await browserContext(browser, { extraHTTPHeaders: { Origin: 'https://untrusted.example', 'x-forwarded-for': '192.0.2.251' } });
  for (const c of [missing, foreign]) for (const [route, method] of [['/api/auth/login', 'POST'], ['/api/auth/register', 'POST'], ['/api/auth/profile', 'PUT'], ['/api/quizzes/1/start', 'POST']]) {
    check((await call(c, route, { email: 'synthetic-origin@example.invalid', password: 'SyntheticOrigin12!' }, method)).status === 403, 'Actual Origin guard accepted untrusted mutation');
  }
});
