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
  const config = getStorageConfig();
  if (!config) return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid evidence data URL");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 2_000_000) throw new Error("Evidence exceeds 2 MB");
  const extension = match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg";
  const key = `evidence/${studentQuizId}/${crypto.randomUUID()}.${extension}`;
  await config.client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: bytes,
    ContentType: match[1],
    ServerSideEncryption: "AES256",
  }));
  return { key, contentType: match[1] };
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
