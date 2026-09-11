import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

function requiredDatabaseUrl() {
  const value = process.env.E2E_DATABASE_URL?.trim();
  if (!value) {
    throw new Error("E2E_DATABASE_URL is missing. Create a disposable Neon branch and save its connection string in .env first.");
  }
  return new URL(value);
}

function normalizedEndpoint(hostname) {
  return hostname.toLowerCase().replace("-pooler.", ".");
}

async function main() {
  const testUrl = requiredDatabaseUrl();
  const productionUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;

  if (productionUrl && normalizedEndpoint(testUrl.hostname) === normalizedEndpoint(productionUrl.hostname)) {
    throw new Error("Refusing to continue: E2E_DATABASE_URL resolves to the production database endpoint.");
  }
  if (!/\.neon\.tech$/i.test(testUrl.hostname)) {
    console.warn("Warning: E2E_DATABASE_URL is not a Neon hostname. Confirm manually that it is disposable.");
  }
  if (testUrl.searchParams.get("sslmode") === "require") {
    testUrl.searchParams.set("sslmode", "verify-full");
  }

  const pool = new Pool({ connectionString: testUrl.toString(), max: 1 });
  try {
    const identity = await pool.query(
      `SELECT current_database() AS "databaseName", current_user AS "userName"`,
    );
    const tables = await pool.query(
      `SELECT to_regclass('public.users')::text AS "usersTable",
              to_regclass('public.roles')::text AS "rolesTable"`,
    );
    if (!tables.rows[0]?.usersTable || !tables.rows[0]?.rolesTable) {
      throw new Error("The disposable database is reachable but the ProctorShield schema has not been restored or migrated.");
    }

    const accounts = await pool.query(
      `SELECT r.role_name AS "roleName", COUNT(*)::text AS "activeUsers"
       FROM users u
       INNER JOIN roles r ON r.id = u.role_id
       WHERE u.status = 'active' AND r.role_name IN ('teacher', 'student')
       GROUP BY r.role_name
       ORDER BY r.role_name`,
    );
    const counts = new Map(accounts.rows.map((row) => [row.roleName, Number(row.activeUsers)]));

    console.log("Disposable authenticated E2E database check passed.");
    console.log(`Host: ${testUrl.hostname}`);
    console.log(`Database: ${identity.rows[0]?.databaseName ?? testUrl.pathname.slice(1)}`);
    console.log(`Active teachers: ${counts.get("teacher") ?? 0}`);
    console.log(`Active students: ${counts.get("student") ?? 0}`);

    if (!(counts.get("teacher") ?? 0) || !(counts.get("student") ?? 0)) {
      throw new Error("The disposable database needs at least one active teacher and one active student before authenticated E2E can run.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  const details = error && typeof error === "object"
    ? [error.name, error.code, error.message]
        .filter((value) => typeof value === "string" && value.trim())
        .join(": ")
    : String(error);
  const nested = error instanceof AggregateError
    ? error.errors
        .map((item) => item && typeof item === "object" ? `${item.code ?? "error"}: ${item.message ?? "connection failed"}` : String(item))
        .join("; ")
    : "";
  process.stderr.write(`${details || "Database connection failed"}${nested ? ` (${nested})` : ""}\n`);
  process.exit(1);
});
