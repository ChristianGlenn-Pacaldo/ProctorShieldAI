import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { decryptFileToPath } from "./backup-crypto.mjs";

const mode = process.argv[2];
const setId = process.argv[3];
if (!["--verify-only", "--download"].includes(mode) || !/^[0-9TZ-]{20,32}-[0-9a-f-]{36}$/.test(setId || "")) {
  console.error("Specify --verify-only or --download followed by an exact recovery set ID");
  process.exit(2);
}

let step = "configuration";
let client;
let outputDirectory;
let outputCreated = false;
let completed = false;
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

function config() {
  if (required("RESTORE_TARGET_ENV") !== "isolated") throw new Error("Restore helper is limited to an isolated recovery runner");
  if (process.env.RAILWAY_ENVIRONMENT_ID && process.env.RAILWAY_ENVIRONMENT_NAME !== "recovery") {
    throw new Error("Restore helper refuses a live Railway environment");
  }
  const endpoint = new URL(required("BACKUP_DESTINATION_ENDPOINT"));
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
    throw new Error("Backup destination must be an HTTPS origin");
  }
  const prefix = required("BACKUP_DESTINATION_PREFIX");
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]{0,100}$/.test(prefix) || prefix.includes("..") || prefix.endsWith("/")) throw new Error("Invalid backup prefix");
  const encodedKey = required("BACKUP_ENCRYPTION_KEY");
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey) || Buffer.from(encodedKey, "base64").length !== 32) throw new Error("Invalid backup encryption key");
  const root = path.resolve(".data", "ops-restore");
  return {
    endpoint: endpoint.origin, prefix, root, key: Buffer.from(encodedKey, "base64"),
    bucket: required("BACKUP_DESTINATION_BUCKET"), region: process.env.BACKUP_DESTINATION_REGION || "us-east-1",
    accessKey: required("BACKUP_DESTINATION_ACCESS_KEY"), secretKey: required("BACKUP_DESTINATION_SECRET_KEY"),
    manifestHash: required("RESTORE_MANIFEST_SHA256"),
  };
}

async function download(config, key, filename, expectedHash) {
  const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: `${config.prefix}/${key}` }));
  if (!response.Body) throw new Error("Backup object is missing");
  await pipeline(response.Body, createWriteStream(filename, { flags: "wx", mode: 0o600 }));
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  if (hash.digest("hex") !== expectedHash) throw new Error("Encrypted backup hash mismatch");
}

async function verifyDump(filename) {
  const child = spawn("pg_restore", ["--list", filename], { stdio: "ignore" });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error("PostgreSQL archive verification failed")));
  });
}

try {
  const settings = config();
  outputDirectory = path.join(settings.root, setId);
  await fs.mkdir(settings.root, { recursive: true, mode: 0o700 });
  await fs.mkdir(outputDirectory, { mode: 0o700 });
  outputCreated = true;
  client = new S3Client({ endpoint: settings.endpoint, region: settings.region,
    forcePathStyle: process.env.BACKUP_DESTINATION_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: settings.accessKey, secretAccessKey: settings.secretKey } });
  step = "manifest download and decryption";
  const encryptedManifest = path.join(outputDirectory, "manifest.bin");
  await download(settings, `sets/${setId}/manifest.bin`, encryptedManifest, settings.manifestHash);
  const manifestFile = path.join(outputDirectory, "manifest.json");
  await decryptFileToPath(encryptedManifest, manifestFile, settings.key);
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  if (manifest.format !== 1 || manifest.setId !== setId || !Array.isArray(manifest.evidence)) throw new Error("Recovery manifest is invalid");
  step = "database download and archive verification";
  const encryptedDatabase = path.join(outputDirectory, "database.bin");
  const databaseFile = path.join(outputDirectory, "database.dump");
  await download(settings, manifest.database.objectKey, encryptedDatabase, manifest.database.cipherSha256);
  await decryptFileToPath(encryptedDatabase, databaseFile, settings.key, manifest.database.plainSha256, manifest.database.plainBytes);
  await verifyDump(databaseFile);
  step = "evidence download and integrity verification";
  await fs.mkdir(path.join(outputDirectory, "evidence"), { mode: 0o700 });
  for (let index = 0; index < manifest.evidence.length; index++) {
    const item = manifest.evidence[index];
    if (item.objectKey !== `sets/${setId}/evidence/${index}.bin` || typeof item.key !== "string" || !item.key.startsWith("evidence/")) {
      throw new Error("Recovery manifest evidence mapping is invalid");
    }
    const encrypted = path.join(outputDirectory, "evidence", `${index}.bin`);
    const plaintext = path.join(outputDirectory, "evidence", `${index}.media`);
    await download(settings, item.objectKey, encrypted, item.cipherSha256);
    await decryptFileToPath(encrypted, plaintext, settings.key, item.plainSha256, item.plainBytes);
    await fs.rm(encrypted);
  }
  await fs.rm(encryptedManifest);
  await fs.rm(encryptedDatabase);
  completed = true;
  console.log(JSON.stringify({ event: "recovery_set_verified", setId, evidenceCount: manifest.evidence.length,
    outputRetained: mode === "--download" }));
} catch {
  console.error(`Recovery verification failed at ${step}`);
  process.exitCode = 1;
} finally {
  client?.destroy();
  if (outputCreated && outputDirectory && (!completed || mode === "--verify-only")) {
    const root = path.resolve(".data", "ops-restore") + path.sep;
    if (path.resolve(outputDirectory).startsWith(root)) await fs.rm(outputDirectory, { recursive: true, force: true });
  }
}
