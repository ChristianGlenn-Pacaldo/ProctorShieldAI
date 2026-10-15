import type { BrowserContext } from "@playwright/test";
import { randomInt } from "node:crypto";

export type TestRole = "student" | "teacher" | "admin";

export function syntheticAccount(role: TestRole, email?: string) {
  const baseURL = process.env.E2E_BASE_URL;
  const database = process.env.E2E_DATABASE_URL;
  const password = process.env.E2E_ACCOUNT_PASSWORD;
  if (process.env.RUN_AUTHENTICATED_E2E !== "true" || !baseURL || !database || !password)
    throw new Error("Explicit disposable E2E configuration and synthetic account password are required");
  const url = new URL(baseURL), db = new URL(database);
  if (![url.hostname, db.hostname].every(host => ["127.0.0.1", "localhost"].includes(host))
    || !/^\/proctorshield_mvp_[a-f0-9]{8}$/.test(db.pathname))
    throw new Error("Database MVP authentication is restricted to the owned loopback fixture");
  const address = email || process.env[`E2E_${role.toUpperCase()}_EMAIL`] || `${role}@mvp.example.test`;
  if (!/^[a-z0-9-]{1,64}@mvp\.example\.test$/.test(address)) throw new Error("Use only synthetic MVP accounts");
  return { origin: url.origin, email: address, password, role };
}

// Real password authentication sets all current HttpOnly/browser-generation
// cookies. Never forge JWTs or weaken server session validation for E2E.
export async function authenticateAsExistingRole(context: BrowserContext, role: TestRole, email?: string) {
  const account = syntheticAccount(role, email);
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === account.origin) return route.continue();
    if (url.hostname === "fonts.googleapis.com") return route.fulfill({ contentType: "text/css", body: "/* isolated provider */" });
    return route.abort();
  });
  const headers = { Origin: account.origin, "X-Forwarded-For": `127.20.${randomInt(1, 254)}.${randomInt(1, 254)}` };
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await context.request.post(account.origin + "/api/auth/login", { headers, data: account });
    const body = await response.json();
    if (response.status() === 409 && body.code === "BROWSER_AUTH_INITIALIZED") continue;
    if (response.status() === 503 && attempt < 4) { await new Promise(resolve => setTimeout(resolve, 300)); continue; }
    if (!response.ok() || !body.success || body.user?.role !== role)
      throw new Error(`Synthetic ${role} login failed (${response.status()}): ${body.message || body.error || "unexpected response"}`);
    const scope = role === "admin" ? "scope=admin" : `scope=user&role=${role}`;
    const verified = await context.request.get(account.origin + "/api/auth/session?" + scope);
    const session = await verified.json();
    if (!verified.ok() || !session.authenticated || session.user?.role !== role)
      throw new Error(`Synthetic ${role} session validation failed (${verified.status()})`);
    return session.user as { userId: string; role: TestRole; email: string; fullName: string };
  }
  throw new Error("Synthetic authentication initialization did not complete");
}
