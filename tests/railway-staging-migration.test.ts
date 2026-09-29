import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = "scripts/railway-staging-migrate.mjs";
const target = {
  RAILWAY_ENVIRONMENT_ID: "staging-environment-test",
  STAGING_RAILWAY_ENVIRONMENT_ID: "staging-environment-test",
  DATABASE_URL: "postgresql://dummy:dummy@staging-db.invalid/staging",
  STAGING_DATABASE_HOST: "staging-db.invalid",
  STAGING_DATABASE_NAME: "staging",
};

function run(mode: string | undefined, overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script, ...(mode ? [mode] : [])], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...target, ...overrides },
  });
}

test("read-only target check accepts the exact staging environment and database", () => {
  const result = run("--check-target");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Verified staging target: staging-db\.invalid\/staging/);
});

test("migration apply fails before Prisma when the Railway environment differs", () => {
  const result = run("--apply", { RAILWAY_ENVIRONMENT_ID: "wrong-environment" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Railway environment does not match/);
});

test("migration apply fails before Prisma when the database differs", () => {
  const result = run("--apply", { STAGING_DATABASE_HOST: "another-db.invalid" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Database host or name does not match/);
});

test("migration helper requires an explicit mode", () => {
  const result = run(undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Use --check-target, --apply, or --bootstrap-empty/);
});

test("empty-database bootstrap requires explicit Admin credentials before connecting", () => {
  const result = run("--bootstrap-empty", { ADMIN_EMAIL: "", ADMIN_PASSWORD: "" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ADMIN_EMAIL is required/);
});
