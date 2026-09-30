import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { backupFreshness, validateBackupConfig, validateBackupStatusConfig } from "./backup-config.mjs";
import { decryptFileTo, encryptToFile } from "./backup-crypto.mjs";

const mode = process.argv[2];
if (!["--backup", "--status", "--check-config"].includes(mode)) {
  console.error("Specify --backup, --status, or --check-config");
  process.exit(2);
}

let step = "configuration";
let source;
let destination;
let tempDir;
let tempCreated = false;

const remoteKey = (config, suffix) => `${config.destination.prefix}/${suffix}`;

function client(config) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
  });
}

function databaseEnvironment(config) {
  const url = config.database;
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: url.searchParams.get("sslmode") || "require",
  };
}

async function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Backup subprocess exited ${code}`)));
  });
}

async function queryRows(config, sql) {
  const child = spawn("psql", ["-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
  { env: databaseEnvironment(config), stdio: ["ignore", "pipe", "ignore"] });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  await childExit(child);
  return Buffer.concat(chunks).toString("utf8").trim().split("\n").filter(Boolean);
}

async function activeEvidenceKeys(config) {
  return queryRows(config, "SELECT file_path FROM evidence_files WHERE deletion_requested_at IS NULL AND deleted_at IS NULL ORDER BY file_path");
}

async function dumpDatabase(config, filename) {
  const child = spawn("pg_dump", ["-Fc", "--no-owner", "--no-acl"],
    { env: databaseEnvironment(config), stdio: ["ignore", "pipe", "ignore"] });
  const [metadata] = await Promise.all([encryptToFile(child.stdout, filename, config.encryptionKey), childExit(child)]);
  const verify = spawn("pg_restore", ["--list"], { stdio: ["pipe", "ignore", "ignore"] });
  await Promise.all([decryptFileTo(filename, config.encryptionKey, verify.stdin), childExit(verify)]);
  return metadata;
}

async function listSourceKeys(config) {
  const keys = [];
  let token;
  do {
    const result = await source.send(new ListObjectsV2Command({ Bucket: config.source.bucket, Prefix: "evidence/", ContinuationToken: token }));
    for (const object of result.Contents || []) if (object.Key) keys.push(object.Key);
    token = result.IsTruncated ? result.NextContinuationToken : undefined;
    if (result.IsTruncated && !token) throw new Error("Incomplete evidence listing");
  } while (token);
  return keys;
}

async function uploadVerified(config, key, filename, metadata) {
  await destination.send(new PutObjectCommand({
    Bucket: config.destination.bucket, Key: key, Body: createReadStream(filename),
    ContentLength: metadata.cipherBytes, ContentType: "application/octet-stream",
  }));
  const response = await destination.send(new GetObjectCommand({ Bucket: config.destination.bucket, Key: key }));
  if (!response.Body) throw new Error("Uploaded backup object is unreadable");
  const hash = crypto.createHash("sha256");
  let size = 0;
  for await (const chunk of response.Body) { hash.update(chunk); size += chunk.length; }
  if (size !== metadata.cipherBytes || hash.digest("hex") !== metadata.cipherSha256) {
    throw new Error("Offsite backup verification failed");
  }
}

async function readJson(config, suffix) {
  try {
    const response = await destination.send(new GetObjectCommand({ Bucket: config.destination.bucket, Key: remoteKey(config, suffix) }));
    if (!response.Body) return null;
    return JSON.parse(Buffer.from(await response.Body.transformToByteArray()).toString("utf8"));
  } catch (error) {
    if (["NoSuchKey", "NotFound"].includes(error?.name)) return null;
    throw error;
  }
}

async function backup(config) {
  const setId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}`;
  tempDir = path.join(config.tempRoot, setId);
  await fs.mkdir(config.tempRoot, { recursive: true, mode: 0o700 });
  await fs.mkdir(tempDir, { recursive: false, mode: 0o700 });
  tempCreated = true;
  step = "database dump and archive verification";
  const dumpFile = path.join(tempDir, "database.bin");
  const database = await dumpDatabase(config, dumpFile);
  step = "source evidence inventory";
  const sourceKeys = await listSourceKeys(config);
  const exported = new Set(sourceKeys);
  const activeKeys = await activeEvidenceKeys(config);
  if (activeKeys.some((key) => !exported.has(key))) throw new Error("Active database evidence is absent from source storage inventory");
  const migrations = await queryRows(config,
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY started_at");
  const setPrefix = `sets/${setId}`;
  step = "offsite database verification";
  await uploadVerified(config, remoteKey(config, `${setPrefix}/database.bin`), dumpFile, database);
  const evidence = [];
  for (let index = 0; index < sourceKeys.length; index++) {
    step = "evidence export and offsite verification";
    const key = sourceKeys[index];
    const response = await source.send(new GetObjectCommand({ Bucket: config.source.bucket, Key: key }));
    if (!response.Body) throw new Error("Source evidence is unreadable");
    const filename = path.join(tempDir, `evidence-${index}.bin`);
    const metadata = await encryptToFile(response.Body, filename, config.encryptionKey);
    const objectKey = `${setPrefix}/evidence/${index}.bin`;
    await uploadVerified(config, remoteKey(config, objectKey), filename, metadata);
    evidence.push({ key, contentType: response.ContentType || "application/octet-stream", objectKey, ...metadata });
    await fs.rm(filename);
  }
  step = "encrypted manifest and completion marker";
  const manifest = {
    format: 1, setId, environmentId: config.environmentId, appCommit: config.appCommit,
    migrations, completedAt: new Date().toISOString(),
    database: { objectKey: `${setPrefix}/database.bin`, ...database },
    evidence,
  };
  const manifestFile = path.join(tempDir, "manifest.bin");
  const manifestMetadata = await encryptToFile(Readable.from([Buffer.from(JSON.stringify(manifest))]), manifestFile, config.encryptionKey);
  await uploadVerified(config, remoteKey(config, `${setPrefix}/manifest.bin`), manifestFile, manifestMetadata);
  const completion = { format: 1, setId, completedAt: manifest.completedAt, evidenceCount: evidence.length,
    manifestCipherSha256: manifestMetadata.cipherSha256 };
  await destination.send(new PutObjectCommand({ Bucket: config.destination.bucket,
    Key: remoteKey(config, `${setPrefix}/completion.json`), Body: JSON.stringify(completion), ContentType: "application/json" }));
  const completionReadback = await readJson(config, `${setPrefix}/completion.json`);
  if (completionReadback?.manifestCipherSha256 !== completion.manifestCipherSha256) {
    throw new Error("Per-set completion record could not be verified");
  }
  await destination.send(new PutObjectCommand({ Bucket: config.destination.bucket,
    Key: remoteKey(config, "latest.json"), Body: JSON.stringify(completion), ContentType: "application/json" }));
  const confirmed = await readJson(config, "latest.json");
  if (confirmed?.setId !== setId) throw new Error("Backup completion marker could not be verified");
  console.log(JSON.stringify({ event: "offsite_backup_complete", setId, evidenceCount: evidence.length }));
}

async function status(config) {
  step = "offsite backup freshness";
  const latest = await readJson(config, "latest.json");
  const restore = await readJson(config, "restore-status.json");
  const freshness = backupFreshness(latest, restore);
  console.log(JSON.stringify({ event: "offsite_backup_status", setId: latest?.setId || null,
    lastBackupAt: latest?.completedAt || null, lastRestoreVerifiedAt: restore?.verifiedAt || null, ...freshness }));
  if (!freshness.backupFresh || !freshness.restoreCurrent) process.exitCode = 1;
}

try {
  const config = mode === "--status"
    ? validateBackupStatusConfig(process.env)
    : validateBackupConfig(process.env, { requirePause: mode === "--backup" });
  if (mode === "--check-config") {
    console.log(JSON.stringify({ event: "backup_configuration_valid", environmentId: config.environmentId }));
  } else {
    if (mode === "--backup") source = client(config.source);
    destination = client(config.destination);
    if (mode === "--backup") await backup(config);
    else await status(config);
  }
} catch {
  console.error(`Backup operation failed at ${step}; no successful-backup marker was published for this run`);
  process.exitCode = 1;
} finally {
  source?.destroy();
  destination?.destroy();
  if (tempCreated && tempDir) {
    const expectedRoot = path.resolve(".data", "ops-backups") + path.sep;
    if (path.resolve(tempDir).startsWith(expectedRoot)) await fs.rm(tempDir, { recursive: true, force: true });
  }
}
