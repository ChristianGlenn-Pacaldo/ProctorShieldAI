import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { runIncidentalBackupWrite } from "./backup-write-gate";
import type { Prisma } from "@prisma/client";

// ── SECURITY: Fail loudly if JWT secret is not configured ────────
function getJwtSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("NEXTAUTH_SECRET must be configured with at least 32 characters");
  }
  return secret;
}
const TOKEN_EXPIRY = "7d";
const VALID_ROLES = ["student", "teacher", "admin"] as const;
export type SessionClass = "admin" | "user";
const SESSION_COOKIES = { admin: "ps_session_admin", user: "ps_session_user" } as const;
const ALL_SESSION_COOKIES = [...Object.values(SESSION_COOKIES), "ps_session_teacher", "ps_session_student"];

export class AuthenticationChangedError extends Error {
  constructor() { super("Authentication changed; sign in again"); }
}

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
}

export function createToken(payload: Omit<TokenPayload, "sessionClass"> & { sessionClass?: SessionClass }): string {
  const role = payload.role.toLowerCase();
  if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) throw new AuthenticationChangedError();
  const sessionClass = role === "admin" ? "admin" : "user";
  if (payload.sessionClass && payload.sessionClass !== sessionClass) throw new AuthenticationChangedError();
  return jwt.sign({ ...payload, role, sessionClass }, getJwtSecret(), {
    algorithm: "HS256", expiresIn: TOKEN_EXPIRY, audience: `proctorshield:${sessionClass}`,
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
  payload: Omit<TokenPayload, "sessionVersion" | "sessionClass">,
  expected: AuthenticationSnapshot,
) {
  const { default: prisma } = await import("@/lib/prisma");
  const token = await prepareSessionToken(payload, expected, prisma);
  await setPreparedSessionCookie(token);
  return token;
}

// Profile writers prepare under their transaction's row lock. They write the
// browser cookie only after that transaction (including the audit) commits.
export async function prepareSessionToken(
  payload: Omit<TokenPayload, "sessionVersion" | "sessionClass">,
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
  return createToken({ userId: user.id, email: user.email, fullName: user.fullName, role, sessionVersion: user.sessionVersion });
}

export async function setPreparedSessionCookie(token: string) {
  const payload = verifyToken(token);
  if (!payload) throw new AuthenticationChangedError();
  const cookieStore = await cookies();

  // Clear existing session cookies for all roles to prevent stale cross-role cookie conflicts
  for (const name of ALL_SESSION_COOKIES) cookieStore.delete(name);

  cookieStore.set(SESSION_COOKIES[payload.sessionClass], token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

async function readSession(sessionClass: SessionClass): Promise<TokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIES[sessionClass])?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.sessionClass !== sessionClass) return null;

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

  if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 30_000) {
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
  };
}

export function getAdminSession() { return readSession("admin"); }
export async function getUserSession(role?: "teacher" | "student") {
  const session = await readSession("user");
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
export async function getSession(roleHint?: string): Promise<TokenPayload | null> {
  if (roleHint === "admin") return getAdminSession();
  if (roleHint === "teacher" || roleHint === "student") return getUserSession(roleHint);
  if (roleHint !== undefined) return null;
  const store = await cookies();
  const admin = Boolean(store.get(SESSION_COOKIES.admin)?.value);
  const user = Boolean(store.get(SESSION_COOKIES.user)?.value);
  if (admin === user) return null;
  return admin ? getAdminSession() : getUserSession();
}

export async function hasConflictingSessionCookies() {
  const store = await cookies();
  return Boolean(store.get(SESSION_COOKIES.admin)?.value && store.get(SESSION_COOKIES.user)?.value);
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
