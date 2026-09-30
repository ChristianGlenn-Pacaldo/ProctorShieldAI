import path from "node:path";

const STAGING_PROJECT_ID = "8007b266-c02c-4c99-ba85-a210b7b3f777";
const STAGING_ENVIRONMENT_ID = "0a5835a6-ea32-44f5-848f-63e4536da240";
const STAGING_OPS_SERVICE_ID = "778c1833-6993-4049-ac1d-48c2e0a31495";
const STAGING_DATABASE_HOST = "postgres.railway.internal";
const STAGING_DATABASE_NAME = "railway";
const STAGING_SOURCE_ENDPOINT_HOST = "t3.storageapi.dev";
const STAGING_SOURCE_BUCKET = "buffered-pocket-cwqdifswp";

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function httpsOrigin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an HTTPS origin`); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS origin without credentials, path, query, or fragment`);
  }
  return url.origin;
}

export function backupFreshness(latest, restore, now = new Date()) {
  const age = (value) => value && Number.isFinite(Date.parse(value)) ? now.getTime() - Date.parse(value) : Infinity;
  const backupAgeMs = age(latest?.completedAt);
  const restoreAgeMs = age(restore?.verifiedAt);
  return {
    backupFresh: backupAgeMs >= 0 && backupAgeMs <= 36 * 60 * 60_000,
    restoreCurrent: restoreAgeMs >= 0 && restoreAgeMs <= 30 * 86_400_000,
  };
}

function backupIdentity(env) {
  const target = required(env, "BACKUP_TARGET_ENV");
  if (target === "staging-test") {
    if (env.BACKUP_STAGING_TEST !== "true"
      || required(env, "RAILWAY_ENVIRONMENT_NAME") !== "staging"
      || required(env, "RAILWAY_PROJECT_ID") !== STAGING_PROJECT_ID
      || required(env, "RAILWAY_ENVIRONMENT_ID") !== STAGING_ENVIRONMENT_ID
      || required(env, "RAILWAY_SERVICE_ID") !== STAGING_OPS_SERVICE_ID) {
      throw new Error("Staging backup test requires the approved Railway staging Ops identity");
    }
  } else if (target === "production") {
    if (required(env, "RAILWAY_ENVIRONMENT_NAME") !== "production") throw new Error("Railway environment is not production");
  } else {
    throw new Error("Only an explicitly approved production or staging-test backup target is supported");
  }
  const environmentId = required(env, "RAILWAY_ENVIRONMENT_ID");
  if (environmentId !== required(env, "BACKUP_APPROVED_ENVIRONMENT_ID") || !/^[0-9a-f-]{36}$/.test(environmentId)) {
    throw new Error("Railway environment does not match the approved backup target");
  }
  if (required(env, "RAILWAY_PROJECT_ID") !== required(env, "BACKUP_APPROVED_PROJECT_ID")) {
    throw new Error("Railway project does not match the approved backup target");
  }
  return environmentId;
}

function destinationConfig(env) {
  const endpoint = httpsOrigin(required(env, "BACKUP_DESTINATION_ENDPOINT"), "BACKUP_DESTINATION_ENDPOINT");
  const bucket = required(env, "BACKUP_DESTINATION_BUCKET");
  if (env.BACKUP_TARGET_ENV === "staging-test"
    && (bucket !== "proctorshield-backups"
      || !new URL(endpoint).hostname.endsWith(".r2.cloudflarestorage.com"))) {
    throw new Error("Staging backup test requires the approved private R2 destination");
  }
  const prefix = env.BACKUP_DESTINATION_PREFIX?.trim() || "proctorshieldai";
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]{0,100}$/.test(prefix) || prefix.includes("..") || prefix.endsWith("/")) {
    throw new Error("BACKUP_DESTINATION_PREFIX is invalid");
  }
  return {
    endpoint, bucket,
    region: env.BACKUP_DESTINATION_REGION || "us-east-1",
    forcePathStyle: env.BACKUP_DESTINATION_FORCE_PATH_STYLE === "true",
    accessKey: required(env, "BACKUP_DESTINATION_ACCESS_KEY"),
    secretKey: required(env, "BACKUP_DESTINATION_SECRET_KEY"), prefix,
  };
}

export function validateBackupStatusConfig(env) {
  return { environmentId: backupIdentity(env), destination: destinationConfig(env) };
}

export function validateBackupConfig(env, { requirePause = true } = {}) {
  const environmentId = backupIdentity(env);
  if (requirePause && (env.BACKUP_WRITES_PAUSED !== "true" || env.BACKUP_MAINTENANCE_PAUSED !== "true")) {
    throw new Error("A coordinated write and retention-maintenance pause is required for this recovery set");
  }
  const appCommit = required(env, "BACKUP_APP_COMMIT");
  if (!/^[0-9a-f]{40}$/.test(appCommit)) throw new Error("BACKUP_APP_COMMIT must be the exact deployed web SHA");
  let database;
  try { database = new URL(required(env, "DATABASE_URL")); } catch { throw new Error("DATABASE_URL is invalid"); }
  if (!(["postgres:", "postgresql:"].includes(database.protocol))
    || database.hostname !== required(env, "BACKUP_APPROVED_DATABASE_HOST")
    || decodeURIComponent(database.pathname.slice(1)) !== required(env, "BACKUP_APPROVED_DATABASE_NAME")
    || !database.username || !database.password || database.hash) {
    throw new Error("DATABASE_URL does not match the approved PostgreSQL target");
  }
  if (env.BACKUP_TARGET_ENV === "staging-test"
    && (database.hostname !== STAGING_DATABASE_HOST
      || decodeURIComponent(database.pathname.slice(1)) !== STAGING_DATABASE_NAME)) {
    throw new Error("Staging backup test refuses a non-staging PostgreSQL target");
  }
  const sourceEndpoint = httpsOrigin(required(env, "S3_ENDPOINT"), "S3_ENDPOINT");
  const destination = destinationConfig(env);
  if (new URL(sourceEndpoint).hostname === new URL(destination.endpoint).hostname) {
    throw new Error("Backup destination must use a different endpoint host");
  }
  const sourceBucket = required(env, "S3_BUCKET");
  if (env.BACKUP_TARGET_ENV === "staging-test"
    && (new URL(sourceEndpoint).hostname !== STAGING_SOURCE_ENDPOINT_HOST
      || sourceBucket !== STAGING_SOURCE_BUCKET)) {
    throw new Error("Staging backup test refuses a non-staging evidence source");
  }
  const sourceAccessKey = required(env, "S3_ACCESS_KEY");
  if (sourceBucket === destination.bucket || sourceAccessKey === destination.accessKey) {
    throw new Error("Backup destination must use a separate bucket and credentials");
  }
  const encodedKey = required(env, "BACKUP_ENCRYPTION_KEY");
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey) || Buffer.from(encodedKey, "base64").length !== 32) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return {
    environmentId,
    appCommit,
    database,
    source: { endpoint: sourceEndpoint, bucket: sourceBucket, region: env.S3_REGION || "us-east-1", forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false", accessKey: sourceAccessKey, secretKey: required(env, "S3_SECRET_KEY") },
    destination,
    encryptionKey: Buffer.from(encodedKey, "base64"),
    tempRoot: path.resolve(".data", "ops-backups"),
  };
}
