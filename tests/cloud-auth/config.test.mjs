import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConfig, loadConfig, assertRuntimeEnvironment } from './runtime.mjs';
import { assertIsolatedNetwork } from '../helpers/isolated-test-environment.ts';

function fixture() {
  return { PSAI_ISOLATED_TESTS_APPROVED: 'true', PSAI_TEST_INSTANCE_ID: '2ac08227-4677-4bdb-b1a0-cb916e0345ef', RUN_AUTHENTICATED_E2E: 'true',
    E2E_BASE_URL: 'https://127.0.0.1:3443', E2E_DATABASE_URL: 'postgresql://psai_auth_test:SyntheticPassword123456@127.0.0.1:55432/proctorshield_auth_v1_test',
    E2E_REDIS_URL: 'redis://:SyntheticRedisPassword123456@127.0.0.1:56379/0', NEXTAUTH_SECRET: 'SyntheticSigningSecret12345678901234567890',
    controlToken: 'SyntheticController12345678901234567890', mailApiKey: 're_SyntheticMailOnly12345678901234567890', pusherSecret: 'SyntheticPusherOnly12345678901234567890' };
}

test('cloud auth private config proves explicit local database/cache/origin without connecting', () => {
  const result = validateConfig(fixture());
  assert.equal(result.isolated.database.database, 'proctorshield_auth_v1_test');
  assert.equal(result.isolated.database.connection.host, '127.0.0.1');
  assert.equal(result.isolated.origin, 'https://127.0.0.1:3443');
  assert.equal('DATABASE_URL' in result.env, false);
  assert.equal('REDIS_URL' in result.env, false);
});
for (const change of ['foreign-db', 'wrong-db', 'query-override', 'foreign-redis', 'wrong-origin', 'no-approval', 'unknown-key', 'provider-inheritance', 'short-transport-secret']) {
  test('cloud authentication configuration rejects ' + change + ' before any connection', () => {
    const config = fixture();
    if (change === 'foreign-db') config.E2E_DATABASE_URL = config.E2E_DATABASE_URL.replace('127.0.0.1', 'production.example');
    if (change === 'wrong-db') config.E2E_DATABASE_URL = config.E2E_DATABASE_URL.replace('proctorshield_auth_v1_test', 'proctorshield');
    if (change === 'query-override') config.E2E_DATABASE_URL += '?host=external.example';
    if (change === 'foreign-redis') config.E2E_REDIS_URL = config.E2E_REDIS_URL.replace('127.0.0.1', 'staging.example');
    if (change === 'wrong-origin') config.E2E_BASE_URL = 'https://staging.example';
    if (change === 'no-approval') config.RUN_AUTHENTICATED_E2E = 'false';
    if (change === 'unknown-key') config.NODE_OPTIONS = '--import=unsafe';
    if (change === 'provider-inheritance') config.SMTP_PASSWORD = 'SyntheticForbiddenOverride';
    if (change === 'short-transport-secret') config.controlToken = 'short';
    assert.throws(() => validateConfig(config));
  });
}
test('Windows is blocked before private config reads regardless of approval claims', () => {
  if (process.platform === 'win32') assert.throws(() => loadConfig(), /isolated Linux/);
  else assert.throws(() => assertIsolatedNetwork({ platform: 'win32', interfaces: {}, ipv4Routes: () => '', ipv6Routes: () => '' }), /isolated Linux/);
});
for (const name of ['PGHOST', 'PGOPTIONS', 'DATABASE_URL', 'DIRECT_URL', 'REDIS_URL', 'RESEND_API_KEY', 'PUSHER_SECRET', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS']) {
  test('raw authentication worker rejects inherited ' + name + ' independently of private config', () => assert.throws(() => assertRuntimeEnvironment({ [name]: 'SyntheticForbiddenOverride' })));
}
