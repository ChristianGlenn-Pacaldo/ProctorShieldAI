import crypto from "node:crypto";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

type StorageConfig = {
  bucket: string;
  client: S3Client;
};

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
  cachedConfig = {
    bucket,
    client: new S3Client({
      endpoint,
      region: process.env.S3_REGION?.trim() || "us-east-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
  return cachedConfig;
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
  await config.client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: bytes,
    ContentType: normalizedContentType,
    ServerSideEncryption: "AES256",
  }));
  return { key, contentType: normalizedContentType };
}

export async function readEvidence(key: string) {
  const config = getStorageConfig();
  if (!config) return null;
  const result = await config.client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
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
    await config.client.send(new DeleteObjectsCommand({
      Bucket: config.bucket,
      Delete: { Objects: keys.slice(index, index + 1_000).map((Key) => ({ Key })), Quiet: true },
    }));
  }
}

export async function checkEvidenceStorage() {
  const config = getStorageConfig();
  if (!config) return false;
  await config.client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  return true;
}
