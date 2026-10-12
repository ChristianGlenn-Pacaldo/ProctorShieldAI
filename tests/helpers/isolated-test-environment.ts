import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientConfig } from "pg";

export type TestDatabaseKind = "arena" | "paymongo" | "auth";
type Environment = Record<string, string | undefined>;
const policies = {
  arena: { variable: "ARENA_CONCURRENCY_TEST_DATABASE_URL", approval: "ARENA_CONCURRENCY_TEST_DATABASE_APPROVED", database: "proctorshield_arena_atomic_test", user: "psai_arena_test" },
  paymongo: { variable: "PAYMONGO_CONCURRENCY_TEST_DATABASE_URL", approval: "PAYMONGO_CONCURRENCY_TEST_DATABASE_APPROVED", database: "proctorshield_paymongo_atomic_test", user: "psai_paymongo_test" },
  auth: { variable: "E2E_DATABASE_URL", approval: "RUN_AUTHENTICATED_E2E", database: "proctorshield_auth_v1_test", user: "psai_auth_test" },
} as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const loopback = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function isolatedPostgresConfig(kind: TestDatabaseKind, env: Environment = process.env) {
  const policy = policies[kind];
  if (env[policy.approval] !== "true" || env.PSAI_ISOLATED_TESTS_APPROVED !== "true") throw new Error("Explicit isolated test approval is required");
  if (!uuid.test(env.PSAI_TEST_INSTANCE_ID ?? "")) throw new Error("A disposable instance UUID is required");
  if (Object.entries(env).some(([name, value]) => value && (/^PG/i.test(name) || ["DATABASE_URL", "DIRECT_URL"].includes(name)))) {
    throw new Error("Inherited PostgreSQL settings and application database URLs are forbidden");
  }
  let url: URL;
  try { url = new URL(env[policy.variable] ?? ""); } catch { throw new Error("Explicit disposable database URL is required"); }
  if (url.protocol !== "postgresql:" || !loopback(url.hostname) || url.port !== "55432"
    || url.pathname !== "/" + policy.database || url.search || url.hash) throw new Error("Unsafe disposable database target or URL override");
  let user: string, password: string;
  try { user = decodeURIComponent(url.username); password = decodeURIComponent(url.password); }
  catch { throw new Error("Invalid disposable database credentials"); }
  if (user !== policy.user || password.length < 16 || password.includes("\0")) throw new Error("Dedicated least-privilege test credentials are required");
  // No connectionString is passed to pg/Prisma: URL query fields cannot override
  // these explicit settings. localhost is pinned to an IP, without DNS lookup.
  const connection: ClientConfig = { host: url.hostname === "[::1]" ? "::1" : "127.0.0.1", port: 55432,
    database: policy.database, user, password, ssl: false, connectionTimeoutMillis: 5_000 };
  url.hostname = connection.host === "::1" ? "[::1]" : "127.0.0.1";
  return { connection, connectionString: url.toString(), database: policy.database, user, instanceId: env.PSAI_TEST_INSTANCE_ID! };
}

export function assertIsolatedNetwork(runtime = {
  platform: process.platform as string, interfaces: os.networkInterfaces(),
  ipv4Routes: () => fs.readFileSync("/proc/self/net/route", "utf8"),
  ipv6Routes: () => fs.readFileSync("/proc/self/net/ipv6_route", "utf8"),
}) {
  // The future worker and PostgreSQL must share a Linux network namespace with
  // ONLY loopback (for example --network=none plus --network=container:<pg>).
  // A boolean environment claim alone is not accepted as network isolation.
  if (runtime.platform !== "linux") throw new Error("An isolated Linux loopback-only test worker is required");
  const addresses = Object.values(runtime.interfaces).flatMap(value => value ?? []);
  if (!addresses.length || addresses.some(value => !value.internal || !["127.0.0.1", "::1"].includes(value.address))) {
    throw new Error("Non-loopback network interfaces are forbidden for isolated tests");
  }
  try {
    const ipv4 = runtime.ipv4Routes().trim().split(/\r?\n/).slice(1);
    const ipv6 = runtime.ipv6Routes().trim().split(/\r?\n/);
    if (ipv4.some(line => line.trim() && line.trim().split(/\s+/)[0] !== "lo")
      || ipv6.some(line => line.trim() && line.trim().split(/\s+/).at(-1) !== "lo")) throw new Error();
  } catch { throw new Error("Loopback-only routing could not be verified"); }
}

export function assertNoTestEnvFiles(directory = projectRoot) {
  if (fs.readdirSync(directory).some(name => /^\.env(?:\.|$)/.test(name) && name !== ".env.example")) {
    throw new Error("Isolated tests must not load project environment files");
  }
}

type IdentityClient = { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> };
export async function verifyIsolatedDatabaseIdentity(client: IdentityClient, config: ReturnType<typeof isolatedPostgresConfig>) {
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await client.query(`SELECT current_database() AS "databaseName", current_user AS "userName",
      d.datistemplate AS "isTemplate", r.rolsuper AS "isSuperuser", r.rolcreatedb AS "canCreateDatabase",
      r.rolcreaterole AS "canCreateRole", r.rolbypassrls AS "bypassRls", r.rolreplication AS "canReplicate",
      host(inet_server_addr()) AS "serverAddress", inet_server_port() AS "serverPort",
      shobj_description(d.oid, 'pg_database') AS marker
      FROM pg_database d JOIN pg_roles r ON r.rolname = current_user WHERE d.datname = current_database()`));
  } catch { throw new Error("Disposable database identity could not be verified"); }
  const row = rows.length === 1 ? rows[0] : null;
  if (!row || row.databaseName !== config.database || row.userName !== config.user
    || row.serverAddress !== config.connection.host || row.serverPort !== config.connection.port
    || row.marker !== `proctorshield:disposable:${config.instanceId}`
    || ["isTemplate", "isSuperuser", "canCreateDatabase", "canCreateRole", "bypassRls", "canReplicate"].some(name => row[name] !== false)) {
    throw new Error("Disposable database identity or role privileges do not match");
  }
}

export function isolatedBrowserOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Isolated browser origin is required"); }
  if (url.protocol !== "https:" || !loopback(url.hostname) || url.port !== "3443" || url.pathname !== "/"
    || url.username || url.password || url.search || url.hash) throw new Error("Authenticated tests require the isolated HTTPS loopback origin on port 3443");
  return url.origin;
}

export function authenticatedTestEnvironment(env: Environment = process.env) {
  const database = isolatedPostgresConfig("auth", env);
  const origin = isolatedBrowserOrigin(env.E2E_BASE_URL ?? "https://localhost:3443");
  if (env.E2E_REUSE_SERVER === "true") throw new Error("Authenticated tests cannot reuse an unidentified server");
  if (!env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET.length < 32) throw new Error("An isolated synthetic signing secret is required");
  let redis: URL;
  try { redis = new URL(env.E2E_REDIS_URL ?? ""); } catch { throw new Error("Dedicated isolated Redis is required"); }
  if (redis.protocol !== "redis:" || !loopback(redis.hostname) || redis.port !== "56379" || redis.pathname !== "/0"
    || redis.search || redis.hash || !redis.password || decodeURIComponent(redis.password).length < 16) throw new Error("Unsafe isolated Redis target");
  if (Object.entries(env).some(([name,value]) => value && (/^(?:REDIS_URL|PUSHER_|SMTP_|GMAIL_|RESEND_|PAYMONGO_|AWS_|S3_|GEMINI_API_KEY|GOOGLE_CLIENT_SECRET)/.test(name)))) {
    throw new Error("Inherited provider credentials are forbidden in isolated authenticated tests");
  }
  redis.hostname = redis.hostname === "[::1]" ? "[::1]" : "127.0.0.1";
  return { database, origin, redisUrl: redis.toString() };
}
