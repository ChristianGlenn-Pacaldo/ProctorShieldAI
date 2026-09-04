import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

// ── SECURITY: Fail loudly if JWT secret is not configured ────────
function getJwtSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("NEXTAUTH_SECRET must be configured with at least 32 characters");
  }
  return secret;
}
const TOKEN_PREFIX = "ps_session_";
const TOKEN_EXPIRY = "7d";
const VALID_ROLES = ["student", "teacher", "admin"] as const;

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
}

export function createToken(payload: TokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { algorithm: "HS256", expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: ["HS256"],
    }) as TokenPayload;

    if (
      !payload.userId ||
      !payload.role ||
      !Number.isInteger(payload.sessionVersion) ||
      !VALID_ROLES.includes(payload.role.toLowerCase() as (typeof VALID_ROLES)[number])
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ── COOKIE / SESSION ────────────────────────────────────

export async function setSessionCookie(payload: Omit<TokenPayload, "sessionVersion">) {
  const { default: prisma } = await import("@/lib/prisma");
  const user = await prisma.user.update({
    where: { id: payload.userId },
    data: { isOnline: true, lastSeenAt: new Date() },
    select: { sessionVersion: true },
  });
  if (!user) throw new Error("Cannot create a session for a missing user");
  const token = createToken({ ...payload, sessionVersion: user.sessionVersion });
  const cookieStore = await cookies();

  // Clear existing session cookies for all roles to prevent stale cross-role cookie conflicts
  cookieStore.delete(`${TOKEN_PREFIX}admin`);
  cookieStore.delete(`${TOKEN_PREFIX}teacher`);
  cookieStore.delete(`${TOKEN_PREFIX}student`);

  cookieStore.set(`${TOKEN_PREFIX}${payload.role}`, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return token;
}

export async function getSession(roleHint?: string): Promise<TokenPayload | null> {
  const cookieStore = await cookies();
  const normalizedHint = roleHint?.toLowerCase();
  const roles = normalizedHint
    ? [normalizedHint, ...VALID_ROLES.filter((role) => role !== normalizedHint)]
    : [...VALID_ROLES];

  for (const role of roles) {
    const token = cookieStore.get(`${TOKEN_PREFIX}${role}`)?.value;
    if (!token) continue;

    const payload = verifyToken(token);
    if (!payload || payload.role.toLowerCase() !== role) continue;

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

    if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 30_000) {
      await prisma.user.update({
        where: { id: payload.userId },
        data: { isOnline: true, lastSeenAt: new Date() },
      });
    }

    return {
      userId: payload.userId,
      email: user.email,
      role: currentRole,
      fullName: user.fullName,
      sessionVersion: user.sessionVersion,
    };
  }

  return null;
}

export async function clearSession(roleHint?: string) {
  const cookieStore = await cookies();
  if (roleHint) {
    cookieStore.delete(`${TOKEN_PREFIX}${roleHint}`);
  } else {
    cookieStore.delete(`${TOKEN_PREFIX}admin`);
    cookieStore.delete(`${TOKEN_PREFIX}teacher`);
    cookieStore.delete(`${TOKEN_PREFIX}student`);
  }
}
