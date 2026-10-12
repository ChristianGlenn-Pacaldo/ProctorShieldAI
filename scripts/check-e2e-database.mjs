import { Pool } from "pg";
import { assertIsolatedNetwork, assertNoTestEnvFiles, authenticatedTestEnvironment, verifyIsolatedDatabaseIdentity } from "../tests/helpers/isolated-test-environment.ts";

async function main() {
  assertNoTestEnvFiles();
  const { database } = authenticatedTestEnvironment();
  assertIsolatedNetwork();
  const pool = new Pool({ ...database.connection, max: 1 });
  try {
    await verifyIsolatedDatabaseIdentity(pool, database);
    const { rows } = await pool.query(`SELECT to_regclass('public.users')::text AS users, to_regclass('public.roles')::text AS roles`);
    if (!rows[0]?.users || !rows[0]?.roles) throw new Error();
    const roles = await pool.query(`SELECT role_name FROM roles WHERE role_name IN ('student','teacher','admin')`);
    if (new Set(roles.rows.map(row => row.role_name)).size !== 3) throw new Error();
    console.log("Isolated E2E database identity, least-privilege role and required schema verified. Existing accounts are not selected or modified.");
  } finally { await pool.end(); }
}
main().catch(() => {
  process.stderr.write("Isolated E2E database check blocked or failed. Verify explicit approvals, local PostgreSQL/Redis, instance marker, schema and network isolation.\n");
  process.exitCode = 1;
});
