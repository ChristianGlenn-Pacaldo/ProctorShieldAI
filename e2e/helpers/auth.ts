import "dotenv/config";
import type { BrowserContext } from "@playwright/test";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

type Role = "student" | "teacher";

interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
}

async function findExistingUser(role: Role): Promise<AuthenticatedUser | null> {
  const connectionString = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("E2E_DATABASE_URL or DATABASE_URL is required for authenticated E2E tests");

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const result = await pool.query<AuthenticatedUser>(
      `SELECT u.id, u.email, u.full_name AS "fullName"
       FROM users u
       INNER JOIN roles r ON r.id = u.role_id
       WHERE r.role_name = $1 AND u.status = 'active'
       ORDER BY u.created_at ASC
       LIMIT 1`,
      [role],
    );
    return result.rows[0] ?? null;
  } finally {
    await pool.end();
  }
}

export async function authenticateAsExistingRole(context: BrowserContext, role: Role) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("NEXTAUTH_SECRET must contain at least 32 characters");

  const user = await findExistingUser(role);
  if (!user) throw new Error(`No active ${role} account exists for authenticated E2E testing`);

  const token = jwt.sign(
    { userId: user.id, email: user.email, role, fullName: user.fullName },
    secret,
    { algorithm: "HS256", expiresIn: "15m" },
  );

  await context.addCookies([{
    name: `ps_session_${role}`,
    value: token,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  }]);
}
