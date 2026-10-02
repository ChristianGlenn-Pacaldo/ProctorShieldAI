import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createRequire } from "node:module";

const requireNode = createRequire(import.meta.url);
export type AuthUser = {
  id: string; email: string; fullName: string; password: string; status: string;
  role: { roleName: string }; sessionVersion: number; lastSeenAt: Date; isOnline: boolean;
};

// No .env, configured DB, Redis, email or provider network calls. Actual route,
// token, cookie and Origin implementations run against explicitly owned mocks.
export function authFixture() {
  const users = new Map<string, AuthUser>();
  for (const role of ["admin", "teacher", "student"]) users.set(role, {
    id: role, email: `${role}@example.test`, fullName: role, status: "active",
    role: { roleName: role }, sessionVersion: 0, lastSeenAt: new Date(), isOnline: false,
    password: bcrypt.hashSync("FixturePassword123", 4),
  });
  const cookies = new Map<string, string>();
  const cookieOptions = new Map<string, Record<string, unknown>>();
  const logs: unknown[] = [], events: string[] = [], mail: string[] = [];
  const otps: Array<{ id: number; userId: string; code: string; expiresAt: Date }> = [];
  let beforeUpdate: (() => void) | null = null, failAudit = false;
  let failRead = false;
  let failCookie = false, gatePaused = false, gateUnavailable = false;
  const afterWork: Array<() => Promise<void>> = [];
  let realtime: (payload: unknown) => Promise<void> = async () => {};
  let googleEmail = "teacher@example.test";
  const matches = (u: AuthUser, w: any) => (!w.id || u.id === w.id)
    && (w.sessionVersion === undefined || w.sessionVersion === u.sessionVersion)
    && (!w.password || w.password === u.password) && (!w.status || w.status === u.status)
    && (!w.role || w.role.roleName.equals.toLowerCase() === u.role.roleName.toLowerCase());
  const updateUser = (u: AuthUser, data: any) => {
    const { sessionVersion, ...rest } = data;
    Object.assign(u, rest);
    if (sessionVersion) u.sessionVersion += sessionVersion.increment;
  };
  const prisma: any = {
    user: {
      findUnique: async ({ where }: any) => {
        if (failRead) throw new Error("Injected read outage");
        const u = where.id ? users.get(where.id) : [...users.values()].find(u => u.email === where.email);
        return u ? structuredClone(u) : null;
      },
      update: async ({ where, data }: any) => {
        const hook = beforeUpdate; beforeUpdate = null; hook?.();
        const u = users.get(where.id);
        if (!u || !matches(u, where)) throw Object.assign(new Error("Conditional update rejected"), { code: "P2025" });
        updateUser(u, data); return structuredClone(u);
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const u of users.values()) if (matches(u, where)) { updateUser(u, data); count++; }
        return { count };
      },
      create: async ({ data }: any) => {
        const role = ["admin", "teacher", "student"][data.roleId - 1];
        const u = { ...data, id: "new-user", role: { roleName: role }, status: "active", sessionVersion: 0, lastSeenAt: new Date(), isOnline: false };
        users.set(u.id, u); return structuredClone(u);
      },
    },
    role: { findFirst: async ({ where }: any) => ({ id: ["admin", "teacher", "student"].indexOf(where.roleName.equals) + 1 }),
      findUnique: async ({ where }: any) => ({ id: ["admin", "teacher", "student"].indexOf(where.roleName) + 1 }) },
    otpCode: {
      create: async ({ data }: any) => { otps.push({ ...data, id: otps.length + 1 }); return otps.at(-1); },
      deleteMany: async ({ where }: any) => {
        const victims = otps.filter(o => where.id ? o.id === where.id : o.userId === where.userId);
        for (const o of victims) otps.splice(otps.indexOf(o), 1);
        return { count: victims.length };
      },
      findFirst: async ({ where }: any) => otps.find(o => o.userId === where.userId && o.code === where.code && o.expiresAt > where.expiresAt.gt) ?? null,
    },
    activityLog: { create: async (row: unknown) => { if (failAudit) throw new Error("Injected audit failure"); logs.push(row); } },
    quiz: { findFirst: async () => null }, studentQuiz: { findFirst: async () => null },
    notification: { findMany: async ({ where }: any) => [{ id: "fixture", userId: where.userId, title: `${where.userId} notification`, message: "fixture", actionUrl: "/", createdAt: new Date() }], count: async () => 1,
      updateMany: async () => ({ count: 1 }) },
    setting: { findUnique: async () => { if (gateUnavailable) throw new Error("Injected gate outage"); return { settingValue: gatePaused ? "paused" : "open" }; },
      create: async () => ({}), deleteMany: async () => ({ count: 1 }) },
    $queryRaw: async () => [],
    $transaction: async (work: (tx: any) => Promise<any>) => {
      const previous = structuredClone(users), previousLogs = logs.length;
      try { return await work(prisma); } catch (error) {
        users.clear(); for (const [id, u] of previous) users.set(id, u);
        logs.splice(previousLogs); throw error;
      }
    },
  };
  const environment: Record<string, string> = { NODE_ENV: "production", NEXTAUTH_SECRET: "fixture-only-session-signing-secret-at-least-32-characters", NEXT_PUBLIC_APP_URL: "https://app.example.test" };
  const modules = new Map<string, any>();
  function load(relative: string): any {
    if (modules.has(relative)) return modules.get(relative);
    const exports: any = {};
    modules.set(relative, exports);
    const code = ts.transpileModule(fs.readFileSync(relative, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      exports, process: { env: environment }, crypto, Date, URL, Error, Buffer, Response, console: { error() {} },
      require(name: string) {
        if (name === "next/headers") return { cookies: async () => ({
          get: (name: string) => cookies.has(name) ? { value: cookies.get(name) } : undefined,
          set: (name: string, token: string, options: any) => { if (failCookie) throw new Error("Injected cookie transport failure"); cookies.set(name, token); cookieOptions.set(name, options); },
          delete: (name: string) => cookies.delete(name),
        }) };
        if (name === "next/server") return { NextResponse: { json: (body: unknown, options?: ResponseInit) => Response.json(body, options) }, after(work: () => Promise<void>) { afterWork.push(work); } };
        if (name === "server-only") return {};
        if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
        if (name === "@/lib/auth") return load("src/lib/auth.ts");
        if (name === "@/lib/auth-origin") return load("src/lib/auth-origin.ts");
        if (name === "@/lib/notification-destination") return load("src/lib/notification-destination.ts");
        if (name.endsWith("backup-write-gate")) return load("src/lib/backup-write-gate.ts");
        if (name === "./prisma") return { __esModule: true, default: prisma };
        if (name === "@/lib/logout-realtime") return { sendLogoutActivity: (payload: unknown) => realtime(payload) };
        if (name === "@/lib/security") return { consumeRateLimitGroup: async () => ({ allowed: true }),
          getClientIp: () => "fixture", generateOtp: () => "123456", isStrongPassword: () => true,
          hashOtp: (id: string, code: string, purpose: string) => `${purpose}:${id}:${code}` };
        if (name === "@/lib/google-identity") return { hasVerifiedGoogleEmail: (p: any) => p.email_verified === true };
        if (name === "google-auth-library") return { OAuth2Client: class {
          async verifyIdToken() { return { getPayload: () => ({ email: googleEmail, name: "Google fixture", email_verified: true }) }; }
        } };
        if (name === "@/lib/email") return { sendOtpEmail: async (recipient: string) => { mail.push(recipient); return true; } };
        if (name === "@/lib/pusher") return { pusherServer: { trigger: async () => {}, authorizeChannel: (_id: string, channel: string) => { events.push(channel); return { auth: "fixture-signature" }; } } };
        if (name === "@/lib/teacher-entitlements") return { hasActiveProSubscription: async () => true };
        if (name === "@/lib/quiz-availability") return { UNAVAILABLE_QUIZ_STATUSES: ["deleted"] };
        return requireNode(name);
      },
    }, { filename: relative });
    return exports;
  }
  return {
    users, cookies, cookieOptions, logs, events, mail, otps, environment, load,
    auth: load("src/lib/auth.ts"),
    beforeUpdate: (hook: () => void) => { beforeUpdate = hook; },
    failAudit: () => { failAudit = true; },
    failRead: () => { failRead = true; },
    failCookie: () => { failCookie = true; },
    realtime: (work: (payload: unknown) => Promise<void>) => { realtime = work; },
    afterWork,
    flushAfter: async () => { for (const work of afterWork.splice(0)) await work(); },
    pauseGate: (unavailable = false) => {
      gatePaused = true; gateUnavailable = unavailable;
      Object.assign(environment, { BACKUP_WRITE_GATE_STAGING_TEST: "true", RAILWAY_ENVIRONMENT_NAME: "staging",
        RAILWAY_PROJECT_ID: "8007b266-c02c-4c99-ba85-a210b7b3f777", RAILWAY_ENVIRONMENT_ID: "0a5835a6-ea32-44f5-848f-63e4536da240", RAILWAY_SERVICE_ID: "5bdc84f0-91cb-4328-b04c-d67b0d6eb133" });
    },
    googleIdentity: (role: string) => { googleEmail = `${role}@example.test`; },
    snapshot: (id: string) => { const u = users.get(id)!; return { userId: u.id, role: u.role.roleName, sessionVersion: u.sessionVersion, password: u.password }; },
    token: (id: string) => { const u = users.get(id)!; return load("src/lib/auth.ts").createToken({ userId: id, email: u.email, fullName: u.fullName, role: u.role.roleName, sessionVersion: u.sessionVersion }); },
    post: async (route: string, body: unknown = {}, origin: string | null = environment.NEXT_PUBLIC_APP_URL) => {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (origin !== null) headers.set("Origin", origin);
      const response = await load(`src/app/api/${route}/route.ts`).POST(new Request(`${environment.NEXT_PUBLIC_APP_URL}/api/${route}`, { method: "POST", headers, body: JSON.stringify(body) }));
      // Apply actual response cookie deletion headers as a browser would.
      for (const header of response.headers.getSetCookie()) {
        if (header.includes("Max-Age=0")) cookies.delete(header.split("=")[0]);
      }
      return response;
    },
  };
}
