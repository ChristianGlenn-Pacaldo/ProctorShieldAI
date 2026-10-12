import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertIsolatedNetwork, assertNoTestEnvFiles, isolatedPostgresConfig } from "../tests/helpers/isolated-test-environment.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suites = ["arena-postgres-concurrency.test.ts", "arena-expiry-postgres.test.ts", "arena-realtime-postgres.test.ts", "paymongo-postgres-concurrency.test.ts"];
try {
  assertNoTestEnvFiles(root);
  isolatedPostgresConfig("arena"); isolatedPostgresConfig("paymongo");
  assertIsolatedNetwork();
  // A minimal child environment cannot inherit a normal database/provider URL,
  // libpq overrides, NODE_OPTIONS preload or dotenv injection.
  const names = ["PATH", "LANG", "TMPDIR", "TEMP", "TMP", "SystemRoot", "PSAI_ISOLATED_TESTS_APPROVED", "PSAI_TEST_INSTANCE_ID",
    "ARENA_CONCURRENCY_TEST_DATABASE_URL", "ARENA_CONCURRENCY_TEST_DATABASE_APPROVED", "PAYMONGO_CONCURRENCY_TEST_DATABASE_URL", "PAYMONGO_CONCURRENCY_TEST_DATABASE_APPROVED"];
  const env = Object.fromEntries(names.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...suites.map(name => `tests/${name}`)], { cwd: root, env, stdio: "inherit" });
  if (result.error) throw new Error("Isolated test worker could not start");
  process.exitCode = result.status ?? 1;
} catch {
  process.stderr.write("Isolated PostgreSQL tests blocked: approvals, explicit local targets and a verified loopback-only Linux worker are required.\n");
  process.exitCode = 1;
}
