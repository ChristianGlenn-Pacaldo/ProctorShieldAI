import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import bcrypt from "bcryptjs";
import { loadEmail } from "./helpers/email-harness.ts";
import { browserAuthStore } from "./helpers/browser-auth-store.ts";

const nodeRequire = createRequire(import.meta.url);
type Otp = { id: string; userId: string; code: string; expiresAt: Date };
type FakeUser = {
  id: string; email: string; fullName: string; role: { roleName: string }; status: string;
  password: string; sessionVersion: number; lastSeenAt: Date | null; isOnline: boolean; profileImage: string | null;
};

function fixture(options: { deliveryFailure?: boolean; unverifiedGoogle?: boolean } = {}) {
  const environment = {
    NODE_ENV: "production" as const, NEXTAUTH_SECRET: "otp-test-signing-secret-longer-than-thirty-two-characters",
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: "123456-login.apps.googleusercontent.com", EMAIL_PROVIDER: "gmail-api",
    GMAIL_SENDER_EMAIL: "sender@gmail.com", GMAIL_OAUTH_CLIENT_ID: "123456-mail.apps.googleusercontent.com",
    GMAIL_OAUTH_CLIENT_SECRET: "mock-private-client-secret", GMAIL_OAUTH_REFRESH_TOKEN: "mock-private-refresh-token",
  };
  let user: FakeUser = {
    id: "teacher-otp-test", email: "recipient@gmail.com", fullName: "Teacher", role: { roleName: "teacher" },
    status: "active", password: bcrypt.hashSync("OriginalPass123", 4), sessionVersion: 0,
    lastSeenAt: new Date(), isOnline: false, profileImage: null,
  };
  let otps: Otp[] = [];
  const cookieValues = new Map<string, string>();
  const mails: Array<{ raw: string }> = [];
  let sessionCreations = 0;
  const hashOtp = (userId: string, code: string, purpose: string) => crypto.createHmac("sha256", environment.NEXTAUTH_SECRET)
    .update(`${purpose}:${userId}:${code}`).digest("hex");
  const email = loadEmail({ environment, console: { log: () => {}, error: () => {} },
    fetch: (async (url, init) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        if (options.deliveryFailure) return Response.json({ error: "invalid_grant" }, { status: 400 });
        return Response.json({ access_token: "mock-access-token", token_type: "Bearer", expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.send" });
      }
      assert.equal(String(url), "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
      mails.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "test-message-id" });
    }) as typeof fetch,
  });
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
        (where.id === user.id || where.email === user.email) ? structuredClone(user) : null,
      update: async ({ where, data }: { where: { sessionVersion?: number; password?: string; status?: string; role?: { roleName: { equals: string } } }; data: Partial<Omit<FakeUser, "sessionVersion">> & { sessionVersion?: { increment: number } } }) => {
        if ((where.sessionVersion !== undefined && where.sessionVersion !== user.sessionVersion)
          || (where.password && where.password !== user.password) || (where.status && where.status !== user.status)
          || (where.role && where.role.roleName.equals.toLowerCase() !== user.role.roleName.toLowerCase())) {
          throw Object.assign(new Error("Authentication changed"), { code: "P2025" });
        }
        const { sessionVersion, ...values } = data;
        Object.assign(user, values);
        if (sessionVersion) user.sessionVersion += sessionVersion.increment;
        return structuredClone(user);
      },
    },
    role: { findFirst: async () => ({ id: 2, roleName: "teacher" }) },
    otpCode: {
      create: async ({ data }: { data: Omit<Otp, "id"> }) => {
        const row = { ...data, id: crypto.randomUUID() }; otps.push(row); return row;
      },
      findFirst: async ({ where }: { where: { userId: string; code: string; expiresAt: { gt: Date } } }) =>
        otps.find(o => o.userId === where.userId && o.code === where.code && o.expiresAt > where.expiresAt.gt) ?? null,
      deleteMany: async ({ where }: { where: { userId?: string; id?: string } }) => {
        const previous = otps.length;
        otps = otps.filter(o => !(where.id ? o.id === where.id : o.userId === where.userId));
        return { count: previous - otps.length };
      },
    },
    activityLog: { create: async () => ({}) },
    $transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      const beforeUser = structuredClone(user), beforeOtps = structuredClone(otps);
      try { return await work(prisma); } catch (error) { user = beforeUser; otps = beforeOtps; throw error; }
    },
  };
  const modules = new Map<string, Record<string, unknown>>();
  const generations = browserAuthStore();
  function load(relativePath: string): Record<string, unknown> {
    if (modules.has(relativePath)) return modules.get(relativePath)!;
    const exports: Record<string, unknown> = {};
    modules.set(relativePath, exports);
    const code = ts.transpileModule(fs.readFileSync(relativePath, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      exports, process: { env: environment }, crypto, Date, URL, Response, console: { error: () => {} },
      require: (name: string) => {
        if (name === "@/lib/browser-auth" || name === "./browser-auth") return load("src/lib/browser-auth.ts");
        if (name === "./redis.ts") return generations.module;
        if (name === "next/server") return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) }, after: () => {} };
        if (name === "next/headers") return { cookies: async () => ({
          get: (key: string) => cookieValues.has(key) ? { value: cookieValues.get(key) } : undefined,
          delete: (key: string) => cookieValues.delete(key),
          set: (key: string, value: string) => { if (key !== "ps_browser_auth") sessionCreations++; cookieValues.set(key, value); },
        }) };
        if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
        if (name === "@/lib/email") return email;
        if (name === "@/lib/auth") return load("src/lib/auth.ts");
        if (name === "@/lib/auth-origin") return load("src/lib/auth-origin.ts");
        if (name === "@/lib/google-signin-challenge") return load("src/lib/google-signin-challenge.ts");
        if (name === "./redis.ts") return { getRedis: () => null, isRedisReady: () => false };
        if (name === "@/lib/security" || name === "./security") return {
          ...load("src/lib/security.ts"), generateOtp: () => "123456",
          consumeRateLimitGroup: async () => ({ allowed: true }),
        };
        if (name === "@/lib/google-identity") return {
          hasVerifiedGoogleEmail: (payload: { email?: string; email_verified?: boolean }) => Boolean(payload?.email && payload.email_verified === true),
        };
        if (name === "google-auth-library") return { OAuth2Client: class {
          async verifyIdToken() { return { getPayload: () => ({ email: user.email, name: user.fullName, email_verified: !options.unverifiedGoogle }) }; }
        } };
        if (name.endsWith("backup-write-gate")) return {
          withBackupWriteGate: (work: unknown) => work,
          scheduleTrackedBackupWork: async () => {},
          runIncidentalBackupWrite: async (work: () => unknown) => work(),
        };
        return nodeRequire(name);
      },
    }, { filename: path.resolve(relativePath) });
    return exports;
  }
  async function post(route: string, body: unknown) {
    const routeModule = load(`src/app/api/auth/${route}/route.ts`);
    const send = () => (routeModule.POST as (request: Request) => Promise<Response>)(new Request(`https://test.invalid/api/auth/${route}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://test.invalid" }, body: JSON.stringify(body),
    }));
    const first = await send();
    return first.status === 409 && (await first.clone().json()).code === "BROWSER_AUTH_INITIALIZED" ? send() : first;
  }
  return {
    post, mails, get user() { return user; }, get otps() { return otps; }, get sessionCreations() { return sessionCreations; },
    cookies: cookieValues,
    addOtp(purpose: "login" | "password-reset", expiresAt = new Date(Date.now() + 600_000)) {
      otps.push({ id: crypto.randomUUID(), userId: user.id, code: hashOtp(user.id, "123456", purpose), expiresAt });
    },
    getSession: () => (load("src/lib/auth.ts").getSession as () => Promise<unknown>)(),
    createSession: async () => { const browser = await (load("src/lib/browser-auth.ts").ensureBrowserAuthentication as () => Promise<unknown>)(); return (load("src/lib/auth.ts").setSessionCookie as (payload: unknown, snapshot: unknown, browser: unknown) => Promise<unknown>)({
      userId: user.id, email: user.email, fullName: user.fullName, role: "teacher",
    }, { userId: user.id, role: user.role.roleName, sessionVersion: user.sessionVersion, password: user.password }, browser); },
  };
}

test("verified Google identity emails OTP to that Gmail and creates no session until OTP verification", async () => {
  const setup = fixture(), start = Date.now();
  const response = await setup.post("google", { credential: "mock-google-id-token", role: "teacher" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.requiresMfa, true); assert.equal(body.email, setup.user.email);
  assert.equal(setup.sessionCreations, 0); assert.equal([...setup.cookies.keys()].filter(name => name.startsWith("ps_session_")).length, 0);
  assert.equal(setup.otps.length, 1); assert.notEqual(setup.otps[0].code, "123456");
  assert.ok(setup.otps[0].expiresAt.getTime() >= start + 600_000);
  assert.ok(setup.otps[0].expiresAt.getTime() <= Date.now() + 600_000);
  const mime = Buffer.from(setup.mails[0].raw, "base64url").toString();
  assert.match(mime, /To: recipient@gmail.com\r\n/); assert.match(mime, /123456/);
  assert.doesNotMatch(JSON.stringify(body), /mock-private|mock-access-token|123456/);
  const verified = await setup.post("verify-otp", { userId: setup.user.id, otpCode: "123456" });
  assert.equal(verified.status, 200); assert.equal(setup.sessionCreations, 1);
  assert.ok(setup.cookies.has("ps_session_user")); assert.ok(await setup.getSession());
  const replay = await setup.post("verify-otp", { userId: setup.user.id, otpCode: "123456" });
  assert.equal(replay.status, 401); assert.equal(setup.sessionCreations, 1);
});

test("Google delivery failure removes the unusable OTP and never creates a session", async () => {
  const setup = fixture({ deliveryFailure: true });
  const response = await setup.post("google", { credential: "mock-google-id-token", role: "teacher" });
  assert.equal(response.status, 503); assert.equal(setup.otps.length, 0); assert.equal(setup.sessionCreations, 0);
  assert.equal(setup.mails.length, 0);
});

test("unverified Google identity cannot request an OTP or create a session", async () => {
  const setup = fixture({ unverifiedGoogle: true });
  assert.equal((await setup.post("google", { credential: "mock-google-id-token", role: "teacher" })).status, 401);
  assert.equal(setup.otps.length, 0); assert.equal(setup.mails.length, 0); assert.equal(setup.sessionCreations, 0);
});

for (const kind of ["wrong", "expired", "different-purpose"] as const) {
  test(`login OTP rejects ${kind} codes without creating a session`, async () => {
    const setup = fixture();
    setup.addOtp(kind === "different-purpose" ? "password-reset" : "login", new Date(Date.now() + (kind === "expired" ? -1000 : 600_000)));
    const response = await setup.post("verify-otp", { userId: setup.user.id, otpCode: kind === "wrong" ? "654321" : "123456" });
    assert.equal(response.status, 401); assert.equal(setup.sessionCreations, 0); assert.equal([...setup.cookies.keys()].filter(name => name.startsWith("ps_session_")).length, 0);
  });
}

test("forgot-password delivery failure returns the same generic response as an unknown account", async () => {
  const setup = fixture({ deliveryFailure: true });
  const known = await setup.post("forgot-password", { email: setup.user.email });
  const unknown = await setup.post("forgot-password", { email: "unknown@gmail.com" });
  assert.equal(known.status, 200); assert.equal(unknown.status, 200);
  assert.deepEqual(await known.json(), await unknown.json());
  assert.equal(setup.otps.length, 0); assert.equal(setup.sessionCreations, 0);
});

test("successful reset consumes emailed OTP, changes password, and rejects the old real signed session", async () => {
  const setup = fixture(); await setup.createSession(); assert.ok(await setup.getSession());
  const originalCookie = setup.cookies.get("ps_session_user");
  assert.equal((await setup.post("forgot-password", { email: setup.user.email })).status, 200);
  assert.equal(setup.mails.length, 1);
  assert.equal((await setup.post("reset-password", { email: setup.user.email, otpCode: "123456", newPassword: "ChangedPass456" })).status, 200);
  assert.equal(await bcrypt.compare("ChangedPass456", setup.user.password), true);
  assert.equal(setup.user.sessionVersion, 1); assert.equal(setup.otps.length, 0);
  assert.equal(setup.cookies.get("ps_session_user"), originalCookie); assert.equal(await setup.getSession(), null);
  assert.equal((await setup.post("reset-password", { email: setup.user.email, otpCode: "123456", newPassword: "AnotherPass789" })).status, 401);
  assert.equal(setup.user.sessionVersion, 1);
});

for (const kind of ["wrong", "expired", "different-purpose"] as const) {
  test(`password reset rejects ${kind} OTP without changing password or sessionVersion`, async () => {
    const setup = fixture(), original = setup.user.password;
    setup.addOtp(kind === "different-purpose" ? "login" : "password-reset", new Date(Date.now() + (kind === "expired" ? -1000 : 600_000)));
    const response = await setup.post("reset-password", { email: setup.user.email, otpCode: kind === "wrong" ? "654321" : "123456", newPassword: "ChangedPass456" });
    assert.equal(response.status, 401); assert.equal(setup.user.password, original); assert.equal(setup.user.sessionVersion, 0);
  });
}
