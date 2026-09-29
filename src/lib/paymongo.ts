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

const PENDING_CHECKOUT_TTL_SECONDS = 60 * 60;

export type PendingPayMongoCheckout = {
  checkoutSessionId: string;
  userId: string;
  planId: number;
  expiresAt: number;
};

function getPendingCheckoutSecret(env: PayMongoEnvironment) {
  const secret = env.NEXTAUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("NEXTAUTH_SECRET must be configured with at least 32 characters");
  }
  return secret;
}

function signPendingCheckoutPayload(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createPendingPayMongoCheckoutToken(
  checkout: Omit<PendingPayMongoCheckout, "expiresAt">,
  env: PayMongoEnvironment = process.env,
  nowMs = Date.now(),
) {
  const payload = Buffer.from(JSON.stringify({
    ...checkout,
    expiresAt: Math.floor(nowMs / 1000) + PENDING_CHECKOUT_TTL_SECONDS,
  })).toString("base64url");
  const signature = signPendingCheckoutPayload(payload, getPendingCheckoutSecret(env));
  return `${payload}.${signature}`;
}

export function verifyPendingPayMongoCheckoutToken(
  token: string | undefined,
  env: PayMongoEnvironment = process.env,
  nowMs = Date.now(),
): PendingPayMongoCheckout | null {
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;

  const expected = signPendingCheckoutPayload(payload, getPendingCheckoutSecret(env));
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<PendingPayMongoCheckout>;
    if (
      typeof parsed.checkoutSessionId !== "string"
      || !parsed.checkoutSessionId.startsWith("cs_")
      || typeof parsed.userId !== "string"
      || !Number.isInteger(parsed.planId)
      || typeof parsed.expiresAt !== "number"
      || parsed.expiresAt < Math.floor(nowMs / 1000)
    ) return null;

    return parsed as PendingPayMongoCheckout;
  } catch {
    return null;
  }
}

export function resolvePayMongoReturnOrigin(env: PayMongoEnvironment = process.env): string {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured || !/^https?:\/\/[^/?#\\]+\/?$/i.test(configured) || /[\u0000-\u001f\u007f]/.test(configured)) {
    throw new Error("NEXT_PUBLIC_APP_URL must be a valid application origin");
  }

  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    throw new Error("NEXT_PUBLIC_APP_URL must be a valid application origin");
  }
  if (
    !origin.hostname
    || origin.username
    || origin.password
    || origin.pathname !== "/"
    || configured.includes("?")
    || configured.includes("#")
  ) {
    throw new Error("NEXT_PUBLIC_APP_URL must contain only an application origin");
  }

  const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !(env.NODE_ENV !== "production" && isLocalhost)) {
    throw new Error("Payment return URLs require a secure HTTPS origin");
  }

  return origin.origin;
}

export function createPayMongoReturnUrls(env: PayMongoEnvironment = process.env) {
  const origin = resolvePayMongoReturnOrigin(env);
  return {
    successUrl: new URL("/dashboard/teacher/billing?payment=success", origin).toString(),
    cancelUrl: new URL("/dashboard/teacher/billing?payment=cancelled", origin).toString(),
  };
}
