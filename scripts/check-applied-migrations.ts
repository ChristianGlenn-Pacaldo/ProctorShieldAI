import "dotenv/config";
import { readdir } from "node:fs/promises";
import prisma from "../src/lib/prisma.ts";

class MigrationReadinessError extends Error {}

// Read-only gate: a reachable database can still be incompatible with this app.
async function main() {
  if (!process.env.DATABASE_URL) throw new MigrationReadinessError("DATABASE_URL is required");
  const entries = await readdir(new URL("../prisma/migrations/", import.meta.url), { withFileTypes: true });
  const expected = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const records = await prisma.$queryRaw<Array<{
    migration_name: string;
    finished_at: Date | null;
    rolled_back_at: Date | null;
  }>>`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
  const unfinished = records.filter((record) => !record.finished_at && !record.rolled_back_at);
  if (unfinished.length) {
    throw new MigrationReadinessError(`Unfinished database migrations: ${unfinished.map((record) => record.migration_name).join(", ")}`);
  }
  const applied = new Set(records.filter((record) => record.finished_at && !record.rolled_back_at).map((record) => record.migration_name));
  const pending = expected.filter((name) => !applied.has(name));
  if (pending.length) {
    throw new MigrationReadinessError(`Database is behind this checkout. Pending migrations: ${pending.join(", ")}. Review a backup and migration plan before deployment.`);
  }
  console.log(`Applied-migration check passed: ${expected.length} migrations.`);
}

main().catch((error: unknown) => {
  console.error("Applied-migration check failed:", error instanceof MigrationReadinessError
    ? error.message : "Cannot read migration history. Check database connectivity and the _prisma_migrations table.");
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
