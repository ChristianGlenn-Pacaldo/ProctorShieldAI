import crypto from "crypto";
import type { NextRequest } from "next/server";
import { getRedis } from "./redis.ts";

type Bucket = { count: number; resetAt: number };
const globalRateLimits = globalThis as typeof globalThis & {
  __proctorShieldRateLimits?: Map<string, Bucket>;
};
const buckets = globalRateLimits.__proctorShieldRateLimits ?? new Map<string, Bucket>();
globalRateLimits.__proctorShieldRateLimits = buckets;

export function getClientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";
}

export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const redis = getRedis();
  if (redis) {
    try {
      const safeKey = crypto.createHash("sha256").update(key).digest("hex");
      const result = await redis.eval(
        `local count = redis.call('INCR', KEYS[1])
         if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
         local ttl = redis.call('PTTL', KEYS[1])
         return {count, ttl}`,
        1,
        `proctorshield:rate-limit:${safeKey}`,
        windowMs,
      ) as [number, number];
      return {
        allowed: result[0] <= limit,
        retryAfterSeconds: Math.max(1, Math.ceil(result[1] / 1000)),
      };
    } catch (error) {
      console.error("Redis rate limiter unavailable; using local limiter:", error);
    }
  }

  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }
  current.count += 1;
  return {
    allowed: current.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export async function consumeRateLimitGroup(keys: string[], limit: number, windowMs: number) {
  const results = await Promise.all(keys.map((key) => consumeRateLimit(key, limit, windowMs)));
  const denied = results.filter((result) => !result.allowed);
  return denied.length === 0
    ? { allowed: true, retryAfterSeconds: Math.max(...results.map((result) => result.retryAfterSeconds)) }
    : { allowed: false, retryAfterSeconds: Math.max(...denied.map((result) => result.retryAfterSeconds)) };
}

export function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export function hashOtp(userId: string, code: string, purpose: "login" | "password-reset"): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required");
  return crypto.createHmac("sha256", secret)
    .update(`${purpose}:${userId}:${code}`)
    .digest("hex");
}

export function isStrongPassword(password: unknown): password is string {
  return typeof password === "string"
    && password.length >= 10
    && password.length <= 128
    && /[A-Za-z]/.test(password)
    && /\d/.test(password);
}
