import type { BrowserContext } from "@playwright/test";
import jwt from "jsonwebtoken";
import { isolatedBrowserOrigin } from "../../tests/helpers/isolated-test-environment.ts";

export type TestRole = "student" | "teacher" | "admin";
export interface SyntheticAccount { id: string; email: string; fullName: string; password: string; sessionVersion: number }
const id = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function loginSyntheticAccount(context: BrowserContext, user: SyntheticAccount, role: TestRole, baseURL: string) {
  const origin = isolatedBrowserOrigin(baseURL);
  if (!["student", "teacher", "admin"].includes(role) || !id.test(user.id)
    || user.email !== `psai-e2e-${user.id}@example.invalid` || !user.password
    || !Number.isSafeInteger(user.sessionVersion) || user.sessionVersion < 0) throw new Error("Only owned synthetic test identities may log in");
  const submit = () => context.request.post(`${origin}/api/auth/login`, {
    data: { email: user.email, password: user.password, role }, headers: { Origin: origin }, maxRedirects: 0,
  });
  let response = await submit();
  if (response.status() === 409 && (await response.json()).code === "BROWSER_AUTH_INITIALIZED") response = await submit();
  if (response.status() !== 200) throw new Error("Synthetic login failed; persistence/Redis/Origin prerequisites must be verified");
  const body = await response.json();
  if (body.success !== true || body.user?.id !== user.id || body.user?.role !== role) throw new Error("Synthetic login identity mismatch");
  const cookies = await context.cookies(origin);
  const sessionClass = role === "admin" ? "admin" : "user";
  const session = cookies.find(cookie => cookie.name === `ps_session_${sessionClass}`);
  const browser = cookies.find(cookie => cookie.name === "ps_browser_auth");
  const payload = session ? jwt.decode(session.value) : null;
  if (!session || !browser || !session.httpOnly || !browser.httpOnly || !session.secure || !browser.secure
    || session.sameSite !== "Lax" || browser.sameSite !== "Lax" || session.path !== "/" || browser.path !== "/"
    || cookies.some(cookie => ["ps_session_admin", "ps_session_user"].includes(cookie.name) && cookie.name !== session.name)
    || !payload || typeof payload === "string" || payload.sessionClass !== sessionClass || payload.aud !== `proctorshield:${sessionClass}`
    || payload.userId !== user.id || payload.role !== role || payload.sessionVersion !== user.sessionVersion
    || payload.browserId !== browser.value || !id.test(payload.browserId) || !id.test(payload.authGeneration)
    || typeof payload.exp !== "number" || payload.exp <= Date.now()/1000) throw new Error("Synthetic login did not establish the required browser-bound HttpOnly session");
  // Decoding above only checks fixture shape. These requests require the actual
  // server reader to verify signature, Redis generation, persisted version/RBAC.
  const scope = sessionClass === "admin" ? "scope=admin" : `scope=user&role=${role}`;
  const accepted = await context.request.get(`${origin}/api/auth/session?${scope}`, { maxRedirects: 0 });
  const identity = await accepted.json();
  if (accepted.status() !== 200 || identity.authenticated !== true || identity.user?.userId !== user.id || identity.user?.role !== role) throw new Error("Server rejected the synthetic stored-account session");
  const wrongScope = sessionClass === "admin" ? "scope=user" : "scope=admin";
  if ((await context.request.get(`${origin}/api/auth/session?${wrongScope}`, { maxRedirects: 0 })).status() !== 401) throw new Error("Admin/User session isolation failed");
  return user;
}
