import crypto from "node:crypto";
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

let cachedConfig: StorageConfig | null | undefined;

const evidenceExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/webm": "webm",
  "video/mp4": "mp4",
};

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
  const config = getStorageConfig();
  if (!config) return null;
  const normalizedContentType = contentType.split(";", 1)[0].trim().toLowerCase();
  const extension = evidenceExtensions[normalizedContentType];
  if (!extension) throw new Error("Unsupported evidence type");
  const maxBytes = normalizedContentType.startsWith("video/") ? 6_000_000 : 2_000_000;
  if (bytes.byteLength > maxBytes) throw new Error(`Evidence exceeds ${maxBytes / 1_000_000} MB`);
  const key = `evidence/${studentQuizId}/${crypto.randomUUID()}.${extension}`;
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
}

export async function readEvidence(key: string) {
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
  const config = getStorageConfig();
  if (!config || keys.length === 0) return;
  for (let index = 0; index < keys.length; index += 1_000) {
    await sendStorageCommand((abortSignal) => config.client.send(new DeleteObjectsCommand({
      Bucket: config.bucket,
      Delete: { Objects: keys.slice(index, index + 1_000).map((Key) => ({ Key })), Quiet: true },
    }), { abortSignal }));
  }
}

export async function checkEvidenceStorage() {
  const config = getStorageConfig();
  if (!config) return false;
  await sendStorageCommand((abortSignal) => config.client.send(
    new HeadBucketCommand({ Bucket: config.bucket }),
    { abortSignal },
  ));
  const key = `healthchecks/${crypto.randomUUID()}.txt`;
  const expected = Buffer.from("proctorshield-evidence-healthcheck", "utf8");
  try {
    await sendStorageCommand((abortSignal) => config.client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: expected,
      ContentType: "text/plain",
      ...(config.serverSideEncryption
        ? { ServerSideEncryption: config.serverSideEncryption }
        : {}),
    }), { abortSignal }));
    const stored = await sendStorageCommand((abortSignal) => config.client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }), { abortSignal })) as GetObjectCommandOutput;
    if (!stored.Body) return false;
    const bytes = await stored.Body.transformToByteArray();
    return Buffer.from(bytes).equals(expected);
  } finally {
    await sendStorageCommand((abortSignal) => config.client.send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      { abortSignal },
    ));
  }
}
