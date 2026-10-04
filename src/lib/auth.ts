import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { runIncidentalBackupWrite } from "./backup-write-gate";
import type { Prisma } from "@prisma/client";
import { AuthenticationChangedError, advanceBrowserAuthentication,
  isBrowserAuthentication, isCurrentBrowserAuthentication, readBrowserAuthentication,
  type BrowserAuthenticationState } from "./browser-auth";
export { AuthenticationChangedError } from "./browser-auth";

// ── SECURITY: Fail loudly if JWT secret is not configured ────────
function getJwtSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("NEXTAUTH_SECRET must be configured with at least 32 characters");
  }
  return secret;
}
const VALID_ROLES = ["student", "teacher", "admin"] as const;
export type SessionClass = "admin" | "user";
const SESSION_COOKIES = { admin: "ps_session_admin", user: "ps_session_user" } as const;
const ALL_SESSION_COOKIES = [...Object.values(SESSION_COOKIES), "ps_session_teacher", "ps_session_student"];

// ── PASSWORD HASHING ────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hashed: string
): Promise<boolean> {
  return bcrypt.compare(password, hashed);
}

// ── JWT TOKEN ───────────────────────────────────────────

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  fullName: string;
  sessionVersion: number;
  sessionClass: SessionClass;
  browserId: string;
  authGeneration: string;
}

export function createToken(payload: Omit<TokenPayload, "sessionClass"> & { sessionClass?: SessionClass }, browserExpiresAt = Math.floor(Date.now() / 1000) + 7 * 86400): string {
  const role = payload.role.toLowerCase();
  if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) throw new AuthenticationChangedError();
  const sessionClass = role === "admin" ? "admin" : "user";
  if (payload.sessionClass && payload.sessionClass !== sessionClass) throw new AuthenticationChangedError();
  if (!isBrowserAuthentication(payload)) throw new AuthenticationChangedError();
  const exp = Math.min(Math.floor(Date.now() / 1000) + 7 * 86400, browserExpiresAt);
  if (!Number.isSafeInteger(exp) || exp <= Math.floor(Date.now() / 1000)) throw new AuthenticationChangedError();
  return jwt.sign({ ...payload, role, sessionClass, exp }, getJwtSecret(), {
    algorithm: "HS256", audience: `proctorshield:${sessionClass}`,
  });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: ["HS256"],
      audience: ["proctorshield:admin", "proctorshield:user"],
    }) as TokenPayload & { aud?: unknown };

    if (
      typeof payload.userId !== "string" || !payload.userId ||
      typeof payload.role !== "string" ||
      !Number.isInteger(payload.sessionVersion) ||
      payload.sessionVersion < 0 ||
      !isBrowserAuthentication(payload) ||
      !VALID_ROLES.includes(payload.role.toLowerCase() as (typeof VALID_ROLES)[number])
    ) {
      return null;
    }
    const expectedClass = payload.role.toLowerCase() === "admin" ? "admin" : "user";
    if (payload.sessionClass !== expectedClass || payload.aud !== `proctorshield:${expectedClass}`) return null;

    return payload;
  } catch {
    return null;
  }
}

// ── COOKIE / SESSION ────────────────────────────────────

// The password hash is server-only and is never included in the signed token.
export interface AuthenticationSnapshot {
  userId: string;
  role: string;
  sessionVersion: number;
  password: string;
}

export async function setSessionCookie(
  payload: SessionIdentity,
  expected: AuthenticationSnapshot,
  browser: BrowserAuthenticationState,
) {
  // Final commitment never bootstraps or adopts a newer authentication event.
  if (!isBrowserAuthentication(browser) || !Number.isSafeInteger(browser.expiresAt)) throw new AuthenticationChangedError();
  const starting = await readBrowserAuthentication();
  if (!starting || browser.browserId !== starting.browserId || browser.authGeneration !== starting.authGeneration
    || browser.expiresAt !== starting.expiresAt) throw new AuthenticationChangedError();
  const { default: prisma } = await import("@/lib/prisma");
  const identity = await prepareSessionIdentity(payload, expected, prisma);
  const next = randomUUID();
  const token = createToken({ ...identity, browserId: starting.browserId, authGeneration: next }, starting.expiresAt);
  const writeCookie = await prepareCookieWrite(token);
  await advanceBrowserAuthentication(starting, next);
  // No Redis read, signing or asynchronous preparation after authoritative CAS.
  writeCookie();
  return token;
}

// Profile writers prepare under their transaction's row lock. They write the
// browser cookie only after that transaction (including the audit) commits.
export async function prepareSessionToken(
  payload: SessionIdentity,
  expected: AuthenticationSnapshot,
  database: Pick<Prisma.TransactionClient, "user">,
) {
  const identity = await prepareSessionIdentity(payload, expected, database);
  // Profile refreshes retain their request's generation; they never advance a
  // newer authentication event or adopt the generation of a replacement login.
  const store = await cookies();
  const previous = verifyToken(store.get(SESSION_COOKIES[payload.role.toLowerCase() === "admin" ? "admin" : "user"])?.value || "");
  if (!previous || previous.userId !== expected.userId || previous.role !== expected.role.toLowerCase()) throw new AuthenticationChangedError();
  const browser = await readBrowserAuthentication();
  if (!browser || browser.browserId !== previous.browserId || browser.authGeneration !== previous.authGeneration) throw new AuthenticationChangedError();
  return createToken({ ...identity, browserId: previous.browserId, authGeneration: previous.authGeneration }, browser.expiresAt);
}

type SessionIdentity = Omit<TokenPayload, "sessionVersion" | "sessionClass" | "browserId" | "authGeneration">;
async function prepareSessionIdentity(
  payload: SessionIdentity,
  expected: AuthenticationSnapshot,
  database: Pick<Prisma.TransactionClient, "user">,
) {
  if (!expected || typeof expected.userId !== "string" || !expected.userId ||
    typeof payload.role !== "string" || typeof expected.password !== "string" || !expected.password ||
    typeof expected.role !== "string" || !Number.isInteger(expected.sessionVersion) || expected.sessionVersion < 0 ||
    payload.userId !== expected.userId || payload.role.toLowerCase() !== expected.role.toLowerCase()) {
    throw new AuthenticationChangedError();
  }
  // One conditional UPDATE locks/revalidates the row. A concurrent reset or
  // suspension cannot be stamped with its new version by old credentials.
  const user = await database.user.update({
    where: {
      id: expected.userId, status: "active", sessionVersion: expected.sessionVersion,
      password: expected.password, role: { roleName: { equals: expected.role, mode: "insensitive" } },
    },
    data: { isOnline: true, lastSeenAt: new Date() },
    select: { id: true, email: true, fullName: true, sessionVersion: true, role: { select: { roleName: true } } },
  }).catch((error: { code?: string }) => {
    if (error?.code === "P2025") throw new AuthenticationChangedError();
    throw error;
  });
  if (!user || user.id !== expected.userId || user.sessionVersion !== expected.sessionVersion
    || user.role.roleName.toLowerCase() !== expected.role.toLowerCase()) throw new AuthenticationChangedError();
  const role = expected.role.toLowerCase();
  return { userId: user.id, email: user.email, fullName: user.fullName, role, sessionVersion: user.sessionVersion };
}

export async function setPreparedSessionCookie(token: string) {
  const payload = verifyToken(token);
  if (!payload || !await isCurrentBrowserAuthentication(payload)) throw new AuthenticationChangedError();
  const writeCookie = await prepareCookieWrite(token);
  writeCookie();
}

async function prepareCookieWrite(token: string) {
  const payload = verifyToken(token) as (TokenPayload & { exp: number }) | null;
  if (!payload || !Number.isSafeInteger(payload.exp)) throw new AuthenticationChangedError();
  const cookieStore = await cookies();
  const options = {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const,
    path: "/", expires: new Date(payload.exp * 1000),
    maxAge: Math.max(0, payload.exp - Math.floor(Date.now() / 1000)),
  };
  return () => {
    for (const name of ALL_SESSION_COOKIES) cookieStore.delete(name);
    cookieStore.set(SESSION_COOKIES[payload.sessionClass], token, options);
  };
}

interface SessionReadOptions { touchActivity?: boolean }

async function readSession(sessionClass: SessionClass, options: SessionReadOptions = {}): Promise<TokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIES[sessionClass])?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.sessionClass !== sessionClass || !await isCurrentBrowserAuthentication(payload)) return null;

  const { default: prisma } = await import("@/lib/prisma");
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      email: true,
      fullName: true,
      status: true,
      lastSeenAt: true,
      sessionVersion: true,
      role: { select: { roleName: true } },
    },
  });

  if (!user || user.status !== "active") return null;
  if (payload.sessionVersion !== user.sessionVersion) return null;

  const currentRole = user.role.roleName.toLowerCase();
  if (currentRole !== payload.role.toLowerCase()) return null;
  if ((currentRole === "admin" ? "admin" : "user") !== sessionClass) return null;

  if (options.touchActivity !== false && (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 30_000)) {
    await runIncidentalBackupWrite(() => prisma.user.update({
      where: { id: payload.userId },
      data: { isOnline: true, lastSeenAt: new Date() },
    }), null);
  }

  return {
    userId: payload.userId,
    email: user.email,
    role: currentRole,
    fullName: user.fullName,
    sessionVersion: user.sessionVersion,
    sessionClass,
    browserId: payload.browserId,
    authGeneration: payload.authGeneration,
  };
}

export function getAdminSession(options?: SessionReadOptions) { return readSession("admin", options); }
export async function getUserSession(role?: "teacher" | "student", options?: SessionReadOptions) {
  const session = await readSession("user", options);
  return role && session?.role !== role ? null : session;
}

// Browser consumer scope only selects a strict reader; it never grants a role.
// Unscoped identity/profile/notification calls default to User, never Admin.
export async function getScopedSession(request: Pick<Request, "url">, allowed: readonly SessionClass[] = ["admin", "user"]) {
  const params = new URL(request.url).searchParams;
  const scope = params.get("scope") || "user";
  if ((scope !== "admin" && scope !== "user") || !allowed.includes(scope)) return null;
  if (scope === "admin") return getAdminSession();
  const role = params.get("role");
  if (role && role !== "teacher" && role !== "student") return null;
  return role === "teacher" || role === "student" ? getUserSession(role) : getUserSession();
}

// Compatibility for audited mixed-role callers only. No role fallback and no
// legacy-token acceptance. Both current cookies means ambiguous identity: deny.
// Legacy users must authenticate again; legacy cookies are cleared on issuance.
export async function getSession(roleHint?: string, options?: SessionReadOptions): Promise<TokenPayload | null> {
  if (roleHint === "admin") return getAdminSession(options);
  if (roleHint === "teacher" || roleHint === "student") return getUserSession(roleHint, options);
  if (roleHint !== undefined) return null;
  const store = await cookies();
  const admin = Boolean(store.get(SESSION_COOKIES.admin)?.value);
  const user = Boolean(store.get(SESSION_COOKIES.user)?.value);
  if (admin === user) return null;
  return admin ? getAdminSession(options) : getUserSession(undefined, options);
}

export async function hasConflictingSessionCookies() {
  const store = await cookies();
  return Boolean(store.get(SESSION_COOKIES.admin)?.value && store.get(SESSION_COOKIES.user)?.value);
}

// Logout expectation only: signature/class/browser binding, without adopting
// Redis's newest generation. This is not an authorization reader.
export async function getLogoutSessionToken(): Promise<TokenPayload | null> {
  const store = await cookies();
  const admin = store.get(SESSION_COOKIES.admin)?.value;
  const user = store.get(SESSION_COOKIES.user)?.value;
  if (Boolean(admin) === Boolean(user)) return null;
  const payload = verifyToken(admin || user || "");
  return payload && payload.sessionClass === (admin ? "admin" : "user")
    && store.get("ps_browser_auth")?.value === payload.browserId ? payload : null;
}

export async function clearSession(response?: Response) {
  // Explicit response headers also cover write-gate rejection, which returns a
  // plain Response before any handler cookie-store mutation can run.
  if (response) {
    for (const name of ALL_SESSION_COOKIES) response.headers.append("Set-Cookie",
      `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return;
  }
  const cookieStore = await cookies();
  for (const name of ALL_SESSION_COOKIES) cookieStore.delete(name);
}
