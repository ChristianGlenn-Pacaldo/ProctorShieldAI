import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { getRedis, isRedisReady } from "./redis.ts";
import { consumeRateLimitGroup } from "./security";

export const BROWSER_AUTH_COOKIE = "ps_browser_auth";
export const BROWSER_AUTH_LIFETIME = 30 * 24 * 60 * 60;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type BrowserAuthentication = { browserId: string; authGeneration: string };
export type BrowserAuthenticationState = BrowserAuthentication & { expiresAt: number };

export class BrowserAuthenticationInitializationError extends Error {}
class BrowserAuthenticationInitializationLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) { super("Browser initialization rate limited"); }
}
export function browserInitializationResponse(error: unknown) {
  if (error instanceof BrowserAuthenticationInitializationLimitedError) {
    return Response.json({ success: false, error: "Too many browser initialization requests" }, {
      status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) },
    });
  }
  return error instanceof BrowserAuthenticationInitializationError
    ? Response.json({ success: false, code: "BROWSER_AUTH_INITIALIZED" }, { status: 409, headers: { "Cache-Control": "no-store" } }) : null;
}

export class AuthenticationChangedError extends Error {
  constructor() { super("Authentication changed; sign in again"); }
}
export class BrowserAuthenticationUnavailableError extends Error {
  constructor() { super("Browser authentication state unavailable"); }
}

function redis() {
  const client = getRedis();
  // Authentication state must never fall back to process-local memory.
  if (!isRedisReady(client)) throw new BrowserAuthenticationUnavailableError();
  return client;
}
function key(browserId: string) { return `proctorshield:browser-auth:${browserId}`; }
export function isBrowserAuthentication<T>(value: T): value is T & BrowserAuthentication {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BrowserAuthentication>;
  return typeof candidate.browserId === "string" && ID.test(candidate.browserId)
    && typeof candidate.authGeneration === "string" && ID.test(candidate.authGeneration);
}
async function evaluate(script: string, browserId: string, ...args: string[]) {
  try { return await redis().eval(script, 1, key(browserId), ...args); }
  catch { throw new BrowserAuthenticationUnavailableError(); }
}
function state(browserId: string, value: unknown): BrowserAuthenticationState | null {
  if (typeof value !== "string") return null;
  const [authGeneration, expiry] = value.split("|");
  const expiresAt = Number(expiry);
  return ID.test(authGeneration) && Number.isSafeInteger(expiresAt) && expiresAt > Math.floor(Date.now() / 1000)
    ? { browserId, authGeneration, expiresAt } : null;
}
export async function readBrowserAuthentication(): Promise<BrowserAuthenticationState | null> {
  const browserId = (await cookies()).get(BROWSER_AUTH_COOKIE)?.value;
  if (!browserId || !ID.test(browserId)) return null;
  return state(browserId, await evaluate("-- browser-auth:read\nreturn redis.call('GET', KEYS[1])", browserId));
}
export async function ensureBrowserAuthentication(): Promise<BrowserAuthenticationState> {
  const current = await readBrowserAuthentication();
  if (current) return current;
  const store = await cookies();
  // Missing/expired state starts a new identity, never a token-supplied generation.
  const browserId = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + BROWSER_AUTH_LIFETIME;
  const generation = await evaluate(`-- browser-auth:ensure
    local current = redis.call('GET', KEYS[1])
    if not current then
      current = ARGV[1]
      redis.call('SET', KEYS[1], current)
      redis.call('PEXPIREAT', KEYS[1], ARGV[2])
    end
    return current`, browserId, `${randomUUID()}|${expiresAt}`, String(expiresAt * 1000));
  const initialized = state(browserId, generation);
  if (!initialized) throw new BrowserAuthenticationUnavailableError();
  store.set(BROWSER_AUTH_COOKIE, browserId, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/",
    expires: new Date(expiresAt * 1000),
  });
  return initialized;
}
export async function requireBrowserAuthentication(bootstrapIp: string): Promise<BrowserAuthenticationState> {
  const current = await readBrowserAuthentication();
  if (current) return current;
  // Initialization has its own IP budget; the credential/OTP attempt is charged
  // only after the browser echoes its identity on the subsequent request.
  const limit = await consumeRateLimitGroup([`browser-auth-init:ip:${bootstrapIp}`], 30, 15 * 60 * 1000);
  if (!limit.allowed) throw new BrowserAuthenticationInitializationLimitedError(limit.retryAfterSeconds);
  await ensureBrowserAuthentication();
  // The browser must echo the identity on a later request before any auth work.
  throw new BrowserAuthenticationInitializationError();
}
export async function isCurrentBrowserAuthentication(expected: BrowserAuthentication) {
  if (!isBrowserAuthentication(expected)) return false;
  const current = await readBrowserAuthentication();
  return current?.browserId === expected.browserId && current.authGeneration === expected.authGeneration;
}
export async function advanceBrowserAuthentication(expected: BrowserAuthenticationState, next = randomUUID()): Promise<BrowserAuthenticationState> {
  if (!isBrowserAuthentication(expected)
    || (await cookies()).get(BROWSER_AUTH_COOKIE)?.value !== expected.browserId) throw new AuthenticationChangedError();
  // Random generations avoid ABA if Redis expires/evicts a key and it is recreated.
  if (!ID.test(next) || !Number.isSafeInteger(expected.expiresAt)) throw new AuthenticationChangedError();
  const advanced = await evaluate(`-- browser-auth:advance
    if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
    local remaining = redis.call('PTTL', KEYS[1])
    if remaining <= 0 then return 0 end
    redis.call('SET', KEYS[1], ARGV[2], 'PX', remaining)
    return 1`, expected.browserId, `${expected.authGeneration}|${expected.expiresAt}`, `${next}|${expected.expiresAt}`);
  if (advanced !== 1) throw new AuthenticationChangedError();
  return { ...expected, authGeneration: next };
}
export async function invalidateBrowserAuthentication(expected: BrowserAuthentication | null) {
  if (!expected) return false;
  // The signed request token supplies the expectation, never the latest read.
  const current = await readBrowserAuthentication();
  if (!current || current.browserId !== expected.browserId || current.authGeneration !== expected.authGeneration) return false;
  try { await advanceBrowserAuthentication(current); return true; }
  catch (error) { if (!(error instanceof AuthenticationChangedError)) throw error; return false; }
}
