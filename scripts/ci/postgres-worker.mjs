import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { assertIsolatedNetwork, assertNoTestEnvFiles, isolatedPostgresConfig, verifyIsolatedDatabaseIdentity } from '../../tests/helpers/isolated-test-environment.ts';

let stage = 'read-private-config';
try {
  const settings = JSON.parse(fs.readFileSync('/run/psai/test-config.json', 'utf8'));
  const allowed = ['PSAI_ISOLATED_TESTS_APPROVED', 'PSAI_TEST_INSTANCE_ID', 'ARENA_CONCURRENCY_TEST_DATABASE_APPROVED',
    'ARENA_CONCURRENCY_TEST_DATABASE_URL', 'PAYMONGO_CONCURRENCY_TEST_DATABASE_APPROVED', 'PAYMONGO_CONCURRENCY_TEST_DATABASE_URL'];
  if (Object.keys(settings).some(name => !allowed.includes(name)) || allowed.some(name => typeof settings[name] !== 'string')) throw new Error();
  for (const name of Object.keys(process.env)) {
    if (!['PATH', 'LANG', 'HOME'].includes(name)) delete process.env[name];
  }
  Object.assign(process.env, settings);
  stage = 'verify-network';
  assertIsolatedNetwork();
  stage = 'verify-no-env-files';
  assertNoTestEnvFiles();
  for (const kind of ['arena', 'paymongo']) {
    stage = `${kind}-parse-config`;
    const config = isolatedPostgresConfig(kind);
    const client = new Client(config.connection);
    stage = `${kind}-connect`;
    await client.connect();
    try {
      stage = `${kind}-verify-identity`;
      await verifyIsolatedDatabaseIdentity(client, config);
      stage = `${kind}-verify-owner-version-membership`;
      const { rows } = await client.query(`SELECT current_setting('server_version_num')::int AS version,
        current_setting('listen_addresses') AS address,
        pg_get_userbyid(d.datdba) AS owner,
        (SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=current_user) AS memberships,
        (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS public_tables
        FROM pg_database d WHERE d.datname=current_database()`);
      if (rows.length !== 1 || rows[0].version < 180000 || rows[0].version >= 190000
        || rows[0].address !== '127.0.0.1' || rows[0].owner !== config.user || rows[0].memberships !== 0 || rows[0].public_tables !== 0) throw new Error();
      stage = `${kind}-verify-cross-database-denial`;
      const other = kind === 'arena' ? 'proctorshield_paymongo_atomic_test' : 'proctorshield_arena_atomic_test';
      const denied = await client.query(`SELECT has_database_privilege(current_user, $1, 'CONNECT') AS allowed`, [other]);
      if (denied.rows[0]?.allowed !== false) throw new Error();
    } finally { await client.end(); }
    console.log(`Verified ${kind} identity, marker, least privilege, empty database, version and loopback-only network.`);
  }
  stage = 'run-unchanged-postgresql-suites';
  const result = spawnSync(process.execPath, ['scripts/run-isolated-postgres-tests.mjs'], { env: process.env, stdio: 'inherit', timeout: 600_000 });
  if (result.error) throw new Error();
  process.exitCode = result.status ?? 1;
} catch (error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'NONE';
  console.error(`Isolated PostgreSQL verification blocked or failed at ${stage}; error code ${code}; credential details suppressed.`);
  process.exitCode = 1;
}
