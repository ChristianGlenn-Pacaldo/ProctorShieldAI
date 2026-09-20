import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";

type StorageConfig = {
  bucket: string;
  client: S3Client;
  serverSideEncryption?: "AES256" | "aws:kms";
};

const storageRequestTimeoutMs = 8_000;
const localEvidenceRoot = path.resolve(process.cwd(), ".data", "evidence");
const localEvidenceKeyPattern = /^local\/evidence\/([A-Za-z0-9_-]{1,128})\/([0-9a-f-]{36})\.(jpg|png|webp|webm|mp4)$/;

let cachedConfig: StorageConfig | null | undefined;
let loggedLocalFallback = false;

const evidenceExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/webm": "webm",
  "video/mp4": "mp4",
};

const evidenceContentTypes: Record<string, string> = Object.fromEntries(
  Object.entries(evidenceExtensions).map(([contentType, extension]) => [extension, contentType]),
);

function localFallbackAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.EVIDENCE_LOCAL_FALLBACK === "true";
}

function validateStudentQuizId(studentQuizId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(studentQuizId)) {
    throw new Error("Invalid student quiz identifier");
  }
}

function parseLocalEvidenceKey(key: string) {
  const match = localEvidenceKeyPattern.exec(key);
  if (!match) return null;
  return {
    contentType: evidenceContentTypes[match[3]] || "application/octet-stream",
    studentQuizId: match[1],
    fileName: `${match[2]}.${match[3]}`,
  };
}

function logLocalFallback(error?: unknown) {
  if (loggedLocalFallback) return;
  loggedLocalFallback = true;
  console.warn(
    error
      ? "S3 evidence storage is unavailable; using private local evidence storage."
      : "S3 evidence storage is not configured; using private local evidence storage.",
  );
}

function isMissingFile(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function writeLocalEvidence(
  bytes: Uint8Array,
  contentType: string,
  studentQuizId: string,
  extension: string,
) {
  validateStudentQuizId(studentQuizId);
  const id = crypto.randomUUID();
  const directory = path.join(localEvidenceRoot, studentQuizId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${id}.${extension}`), bytes, { flag: "wx", mode: 0o600 });
  return {
    key: `local/evidence/${studentQuizId}/${id}.${extension}`,
    contentType,
  };
}

async function checkLocalEvidenceStorage() {
  const directory = path.join(localEvidenceRoot, "healthchecks");
  const filePath = path.join(directory, `${crypto.randomUUID()}.txt`);
  const expected = Buffer.from("proctorshield-evidence-healthcheck", "utf8");
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(filePath, expected, { flag: "wx", mode: 0o600 });
    return Buffer.from(await fs.readFile(filePath)).equals(expected);
  } finally {
    await fs.rm(filePath, { force: true });
  }
}

function getStorageConfig(): StorageConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY?.trim();
  const secretAccessKey = process.env.S3_SECRET_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    cachedConfig = null;
    return null;
  }
  const requestedEncryption = process.env.S3_SERVER_SIDE_ENCRYPTION?.trim();
  let serverSideEncryption: StorageConfig["serverSideEncryption"];
  if (requestedEncryption === "AES256" || requestedEncryption === "aws:kms") {
    serverSideEncryption = requestedEncryption;
  } else if (requestedEncryption) {
    throw new Error("S3_SERVER_SIDE_ENCRYPTION must be AES256, aws:kms, or empty");
  }
  const config: StorageConfig = {
    bucket,
    serverSideEncryption,
    client: new S3Client({
      endpoint,
      region: process.env.S3_REGION?.trim() || "us-east-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      maxAttempts: 1,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
  cachedConfig = config;
  return config;
}

async function sendStorageCommand<T>(send: (abortSignal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), storageRequestTimeoutMs);
  try {
    return await send(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadEvidence(dataUrl: string, studentQuizId: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid evidence data URL");
  const bytes = Buffer.from(match[2], "base64");
  return uploadEvidenceBytes(bytes, match[1], studentQuizId);
}

export async function uploadEvidenceBytes(
  bytes: Uint8Array,
  contentType: string,
  studentQuizId: string,
) {
  const normalizedContentType = contentType.split(";", 1)[0].trim().toLowerCase();
  const extension = evidenceExtensions[normalizedContentType];
  if (!extension) throw new Error("Unsupported evidence type");
  const maxBytes = normalizedContentType.startsWith("video/") ? 6_000_000 : 2_000_000;
  if (bytes.byteLength > maxBytes) throw new Error(`Evidence exceeds ${maxBytes / 1_000_000} MB`);
  validateStudentQuizId(studentQuizId);
  const config = getStorageConfig();
  if (!config) {
    if (!localFallbackAllowed()) return null;
    logLocalFallback();
    return writeLocalEvidence(bytes, normalizedContentType, studentQuizId, extension);
  }
  const key = `evidence/${studentQuizId}/${crypto.randomUUID()}.${extension}`;
  try {
    await sendStorageCommand((abortSignal) => config.client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: bytes,
      ContentType: normalizedContentType,
      ...(config.serverSideEncryption
        ? { ServerSideEncryption: config.serverSideEncryption }
        : {}),
    }), { abortSignal }));
    return { key, contentType: normalizedContentType };
  } catch (error) {
    if (!localFallbackAllowed()) throw error;
    logLocalFallback(error);
    return writeLocalEvidence(bytes, normalizedContentType, studentQuizId, extension);
  }
}

export async function readEvidence(key: string) {
  const localEvidence = parseLocalEvidenceKey(key);
  if (localEvidence) {
    try {
      return {
        bytes: await fs.readFile(path.join(
          process.cwd(),
          ".data",
          "evidence",
          localEvidence.studentQuizId,
          localEvidence.fileName,
        )),
        contentType: localEvidence.contentType,
      };
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }
  const config = getStorageConfig();
  if (!config) return null;
  const result = await sendStorageCommand((abortSignal) => config.client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { abortSignal },
  )) as GetObjectCommandOutput;
  if (!result.Body) return null;
  return {
    bytes: await result.Body.transformToByteArray(),
    contentType: result.ContentType || "application/octet-stream",
  };
}

export async function deleteEvidence(keys: string[]) {
  if (keys.length === 0) return;
  const remoteKeys: string[] = [];
  for (const key of keys) {
    const localEvidence = parseLocalEvidenceKey(key);
    if (!localEvidence) {
      remoteKeys.push(key);
      continue;
    }
    await fs.rm(path.join(
      process.cwd(),
      ".data",
      "evidence",
      localEvidence.studentQuizId,
      localEvidence.fileName,
    ), { force: true });
  }
  const config = getStorageConfig();
  if (!config) return;
  for (let index = 0; index < remoteKeys.length; index += 1_000) {
    await sendStorageCommand((abortSignal) => config.client.send(new DeleteObjectsCommand({
      Bucket: config.bucket,
      Delete: { Objects: remoteKeys.slice(index, index + 1_000).map((Key) => ({ Key })), Quiet: true },
    }), { abortSignal }));
  }
}

export async function checkEvidenceStorage() {
  const config = getStorageConfig();
  if (!config) {
    if (!localFallbackAllowed()) return false;
    logLocalFallback();
    return checkLocalEvidenceStorage();
  }
  const key = `healthchecks/${crypto.randomUUID()}.txt`;
  const expected = Buffer.from("proctorshield-evidence-healthcheck", "utf8");
  let objectCreated = false;
  try {
    await sendStorageCommand((abortSignal) => config.client.send(
      new HeadBucketCommand({ Bucket: config.bucket }),
      { abortSignal },
    ));
    await sendStorageCommand((abortSignal) => config.client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: expected,
      ContentType: "text/plain",
      ...(config.serverSideEncryption
        ? { ServerSideEncryption: config.serverSideEncryption }
        : {}),
    }), { abortSignal }));
    objectCreated = true;
    const stored = await sendStorageCommand((abortSignal) => config.client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }), { abortSignal })) as GetObjectCommandOutput;
    if (!stored.Body) return false;
    const bytes = await stored.Body.transformToByteArray();
    return Buffer.from(bytes).equals(expected);
  } catch (error) {
    if (!localFallbackAllowed()) throw error;
    logLocalFallback(error);
    return checkLocalEvidenceStorage();
  } finally {
    if (objectCreated) {
      await sendStorageCommand((abortSignal) => config.client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal },
      ));
    }
  }
}
