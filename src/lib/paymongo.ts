import crypto from "crypto";

export type PayMongoMode = "test" | "live";
type PayMongoEnvironment = Readonly<Record<string, string | undefined>>;

export function getPayMongoMode(env: PayMongoEnvironment = process.env): PayMongoMode {
  const configuredMode = env.PAYMONGO_MODE?.trim().toLowerCase() || "test";
  if (configuredMode !== "test" && configuredMode !== "live") {
    throw new Error("PAYMONGO_MODE must be either test or live");
  }
  return configuredMode;
}

export function getPayMongoSecretKey(env: PayMongoEnvironment = process.env): string {
  const key = env.PAYMONGO_SECRET_KEY?.trim();
  if (!key) throw new Error("PAYMONGO_SECRET_KEY is not configured");

  const mode = getPayMongoMode(env);
  const expectedPrefix = mode === "test" ? "sk_test_" : "sk_live_";
  if (!key.startsWith(expectedPrefix)) {
    throw new Error(`PAYMONGO_SECRET_KEY does not match PAYMONGO_MODE=${mode}`);
  }
  return key;
}

export function isPayMongoEventModeAllowed(
  eventIsLive: boolean,
  env: PayMongoEnvironment = process.env,
): boolean {
  return eventIsLive === (getPayMongoMode(env) === "live");
}

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
