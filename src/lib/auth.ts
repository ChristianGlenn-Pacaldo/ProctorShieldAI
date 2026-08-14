import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

// ── SECURITY: Fail loudly if JWT secret is not configured ────────
const JWT_SECRET = process.env.NEXTAUTH_SECRET as string;
if (!JWT_SECRET) {
  throw new Error(
    "[ProctorShield] FATAL: NEXTAUTH_SECRET environment variable is not set. " +
    "The server cannot start without a JWT signing secret. " +
    "Add NEXTAUTH_SECRET to your .env file."
  );
}
const TOKEN_PREFIX = "ps_session_";
const TOKEN_EXPIRY = "7d";

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
}

export function createToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as unknown as TokenPayload;
  } catch {
    return null;
  }
}

// ── COOKIE / SESSION ────────────────────────────────────

export async function setSessionCookie(payload: TokenPayload) {
  const token = createToken(payload);
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
  let resolvedRole = roleHint;

  if (!resolvedRole) {
    try {
      // In Next.js App Router, headers() is available in Server Components and API routes
      const { headers } = await import("next/headers");
      const headersList = await headers();
      const activeRole = headersList.get("x-active-role");
      if (activeRole) {
        resolvedRole = activeRole;
      } else {
        // Deduce active role context from Referer header
        const referer = headersList.get("referer") || "";
        if (referer.includes("/dashboard/student") || referer.includes("/student") || referer.includes("/quiz/")) {
          resolvedRole = "student";
        } else if (referer.includes("/dashboard/teacher") || referer.includes("/teacher")) {
          resolvedRole = "teacher";
        } else if (referer.includes("/dashboard/admin") || referer.includes("/admin")) {
          resolvedRole = "admin";
        }
      }
    } catch {
      // Ignore if called from context where headers() isn't available
    }
  }
  
  if (resolvedRole) {
    const token = cookieStore.get(`${TOKEN_PREFIX}${resolvedRole}`)?.value;
    if (token) {
      const payload = verifyToken(token);
      if (payload) return payload;
    }
  }

  // If no hint or referer context matched, check student -> teacher -> admin
  const roles = ["student", "teacher", "admin"];
  for (const role of roles) {
    const token = cookieStore.get(`${TOKEN_PREFIX}${role}`)?.value;
    if (token) {
      const payload = verifyToken(token);
      if (payload) return payload;
    }
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
