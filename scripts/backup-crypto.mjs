import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function encryptToFile(readable, filename, key) {
  const iv = crypto.randomBytes(12);
  const plaintextHash = crypto.createHash("sha256");
  let plainBytes = 0;
  await fs.writeFile(filename, iv, { flag: "wx", mode: 0o600 });
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    plaintextHash.update(chunk);
    plainBytes += chunk.length;
    callback(null, chunk);
  } });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  await pipeline(readable, meter, cipher, createWriteStream(filename, { flags: "a", mode: 0o600 }));
  await fs.appendFile(filename, cipher.getAuthTag());
  const stat = await fs.stat(filename);
  const cipherHash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filename)) cipherHash.update(chunk);
  return { plainSha256: plaintextHash.digest("hex"), plainBytes, cipherSha256: cipherHash.digest("hex"), cipherBytes: stat.size };
}

export async function decryptFileTo(filename, key, writable) {
  const stat = await fs.stat(filename);
  if (stat.size < 28) throw new Error("Encrypted backup is truncated");
  const handle = await fs.open(filename, "r");
  const iv = Buffer.alloc(12);
  const tag = Buffer.alloc(16);
  try {
    await handle.read(iv, 0, 12, 0);
    await handle.read(tag, 0, 16, stat.size - 16);
  } finally { await handle.close(); }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const ciphertext = stat.size === 28
    ? Readable.from([])
    : createReadStream(filename, { start: 12, end: stat.size - 17 });
  await pipeline(ciphertext, decipher, writable);
}

export async function decryptFileToPath(filename, output, key, expectedHash, expectedBytes) {
  await decryptFileTo(filename, key, createWriteStream(output, { flags: "wx", mode: 0o600 }));
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(output)) { hash.update(chunk); bytes += chunk.length; }
  const actualHash = hash.digest("hex");
  if ((expectedHash && actualHash !== expectedHash) || (expectedBytes !== undefined && bytes !== expectedBytes)) {
    throw new Error("Decrypted backup integrity mismatch");
  }
}
