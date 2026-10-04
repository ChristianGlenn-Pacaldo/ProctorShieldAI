import { createHmac, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { AuthenticationChangedError, isBrowserAuthentication, isCurrentBrowserAuthentication,
  BROWSER_AUTH_COOKIE, type BrowserAuthentication, type BrowserAuthenticationState } from "@/lib/browser-auth";

type Intent = BrowserAuthentication & { browser: string; nonce: string };
type Challenge = Intent & { userId: string; role: "student" | "teacher"; sessionVersion: number; passwordDigest: string };

function secret() {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value || value.length < 32) throw new Error("Session signing is unavailable");
  return value;
}

function digest(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

// Bind the flow to the starting browser identity, including DB revocation.
// Neither raw cookies nor password hashes leave the server.
export async function googleBrowserIdentity() {
  const store = await cookies();
  const values = ["ps_session_admin", "ps_session_user", "ps_session_teacher", "ps_session_student"]
    .map(name => store.get(name)?.value || "");
  const session = await getSession(undefined, { touchActivity: false });
  return digest(JSON.stringify([store.get(BROWSER_AUTH_COOKIE)?.value || "", values,
    session ? [session.userId, session.role, session.sessionVersion] : null]));
}

function sign(value: Intent | Challenge, audience: string) {
  return jwt.sign(value, secret(), { algorithm: "HS256", audience, expiresIn: "10m" });
}

function read(value: unknown, audience: string): Record<string, unknown> | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const result = jwt.verify(value, secret(), { algorithms: ["HS256"], audience });
    return typeof result === "object" && isBrowserAuthentication(result) && typeof result.browser === "string" && typeof result.nonce === "string"
      ? result : null;
  } catch { return null; }
}

export async function beginGoogleSignIn(binding: BrowserAuthenticationState) {
  const nonce = randomUUID();
  if (!isBrowserAuthentication(binding) || !await isCurrentBrowserAuthentication(binding)) throw new AuthenticationChangedError();
  return { intent: sign({ ...binding, browser: await googleBrowserIdentity(), nonce }, "proctorshield:google-intent"), nonce };
}

export async function readGoogleIntent(value: unknown): Promise<Intent | null> {
  const result = read(value, "proctorshield:google-intent");
  return result && isBrowserAuthentication(result) && await isCurrentBrowserAuthentication(result)
    && result.browser === await googleBrowserIdentity()
    ? { browserId: result.browserId, authGeneration: result.authGeneration,
      browser: result.browser as string, nonce: result.nonce as string } : null;
}

export function createGoogleChallenge(intent: Intent, user: { id: string; role: { roleName: string }; sessionVersion: number; password: string }) {
  const role = user.role.roleName.toLowerCase();
  if (role !== "student" && role !== "teacher") throw new Error("Google account is not eligible");
  return sign({ ...intent, userId: user.id, role, sessionVersion: user.sessionVersion,
    passwordDigest: digest(`google-password:${user.password}`) }, "proctorshield:google-otp");
}

export async function readGoogleChallenge(value: unknown): Promise<Challenge | null> {
  const result = read(value, "proctorshield:google-otp");
  if (!result || !isBrowserAuthentication(result) || !await isCurrentBrowserAuthentication(result)
    || typeof result.userId !== "string" || !result.userId
    || (result.role !== "student" && result.role !== "teacher")
    || !Number.isInteger(result.sessionVersion) || Number(result.sessionVersion) < 0
    || typeof result.passwordDigest !== "string" || result.browser !== await googleBrowserIdentity()) return null;
  return result as Challenge;
}

export function matchesGoogleChallenge(challenge: Challenge, user: { role: { roleName: string }; sessionVersion: number; password: string }) {
  return challenge.role === user.role.roleName.toLowerCase() && challenge.sessionVersion === user.sessionVersion
    && challenge.passwordDigest === digest(`google-password:${user.password}`);
}

// A unified OTP cannot be completed by stripping the signed challenge and
// submitting it through the legacy login-purpose endpoint.
export function hashGoogleOtp(nonce: string, userId: string, code: string) {
  return digest(`unified-google-login:${nonce}:${userId}:${code}`);
}
