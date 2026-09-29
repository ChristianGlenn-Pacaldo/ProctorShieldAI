import { spawnSync } from "node:child_process";
import pg from "pg";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function verifyTarget() {
  const environmentId = required("RAILWAY_ENVIRONMENT_ID");
  if (environmentId !== required("STAGING_RAILWAY_ENVIRONMENT_ID")) {
    throw new Error("Railway environment does not match the approved staging environment");
  }

  const url = new URL(required("DATABASE_URL"));
  const database = decodeURIComponent(url.pathname.slice(1));
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use PostgreSQL");
  }
  if (url.hostname !== required("STAGING_DATABASE_HOST")
    || database !== required("STAGING_DATABASE_NAME")) {
    throw new Error("Database host or name does not match the approved staging target");
  }
  console.log(`Verified staging target: ${url.hostname}/${database}`);
}

async function assertEmptyBootstrapTarget() {
  required("ADMIN_EMAIL");
  required("ADMIN_PASSWORD");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const { rows } = await client.query(`
      SELECT tablename FROM pg_catalog.pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `);
    if (rows.length === 0) throw new Error("Run migrations before bootstrap");
    for (const { tablename } of rows) {
      const identifier = tablename.replaceAll('"', '""');
      const result = await client.query(`SELECT COUNT(*)::integer AS count FROM public."${identifier}"`);
      if (result.rows[0]?.count !== 0) {
        throw new Error(`Bootstrap requires an empty staging database; ${tablename} has rows`);
      }
    }
  } finally {
    await client.end();
  }
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

async function main() {
  const mode = process.argv[2];
  if (!["--check-target", "--apply", "--bootstrap-empty"].includes(mode)) {
    throw new Error("Use --check-target, --apply, or --bootstrap-empty");
  }
  verifyTarget();
  if (mode === "--apply") {
    runCommand("./node_modules/.bin/prisma", ["migrate", "deploy"]);
  } else if (mode === "--bootstrap-empty") {
    await assertEmptyBootstrapTarget();
    runCommand("./node_modules/.bin/tsx", ["scripts/bootstrap.ts"]);
  }
}

main().catch((error) => {
  console.error("Staging migration stopped:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
