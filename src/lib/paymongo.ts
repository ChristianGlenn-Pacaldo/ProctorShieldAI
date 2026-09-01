import crypto from "crypto";

export function verifyPayMongoSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  nowMs = Date.now()
): "te" | "li" | null {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, ...value] = part.trim().split("=");
      return [key, value.join("=")];
    })
  );
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(nowMs / 1000 - timestamp) > 5 * 60) {
    return null;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");

  for (const mode of ["te", "li"] as const) {
    const provided = parts[mode];
    if (!provided || provided.length !== expected.length) continue;
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) return mode;
  }
  return null;
}
