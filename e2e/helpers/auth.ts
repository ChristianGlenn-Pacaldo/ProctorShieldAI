import crypto from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { hashPassword } from "../../src/lib/password-hash.ts";
import { assertIsolatedNetwork, assertNoTestEnvFiles, authenticatedTestEnvironment, verifyIsolatedDatabaseIdentity } from "../../tests/helpers/isolated-test-environment.ts";
import { loginSyntheticAccount, type SyntheticAccount, type TestRole } from "./login.ts";

export async function createAuthenticatedTestPool() {
  assertNoTestEnvFiles();
  const { database } = authenticatedTestEnvironment();
  assertIsolatedNetwork();
  const pool = new Pool({ ...database.connection, max: 2 });
  try { await verifyIsolatedDatabaseIdentity(pool, database); return pool; }
  catch { await pool.end(); throw new Error("Isolated authenticated database identity verification failed"); }
}

export async function createSyntheticAccount(pool: Pool, role: TestRole): Promise<SyntheticAccount> {
  if (!["student", "teacher", "admin"].includes(role)) throw new Error("Unsupported synthetic role");
  // Verify again before the first write; never select or replace a prior account.
  await verifyIsolatedDatabaseIdentity(pool, authenticatedTestEnvironment().database);
  const id = crypto.randomUUID(), password = crypto.randomBytes(24).toString("base64url") + "A1";
  const email = `psai-e2e-${id}@example.invalid`;
  const result = await pool.query<Omit<SyntheticAccount, "password">>(
    `INSERT INTO users (id, full_name, email, password, role_id, status, session_version)
     SELECT $1, $2, $3, $4, r.id, 'active', 0 FROM roles r WHERE r.role_name = $5
     RETURNING id, email, full_name AS "fullName", session_version AS "sessionVersion"`,
    [id, `Synthetic ${role} ${id.slice(0,8)}`, email, await hashPassword(password), role],
  );
  if (result.rowCount !== 1) throw new Error("The isolated database lacks a required test role");
  return { ...result.rows[0], password };
}

export async function authenticateAsSyntheticRole(context: BrowserContext, role: TestRole) {
  const pool = await createAuthenticatedTestPool();
  try {
    const account = await createSyntheticAccount(pool, role);
    return await loginSyntheticAccount(context, account, role, authenticatedTestEnvironment().origin);
  } finally {
    await pool.end();
    // Owned synthetic rows are retained until separately approved disposable
    // database disposal. Never delete historical dummy accounts or quizzes.
  }
}
