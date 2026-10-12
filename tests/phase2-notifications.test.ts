import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { fixture as shellFixture, textOf, deferred } from "./helpers/dashboard-lifecycle-fixture.ts";

type Row = { id: bigint; userId: string; title: string; message: string; isRead: boolean; createdAt: Date };
type Where = { userId: string; isRead?: boolean; id?: bigint };
function fixture(role: string | null, count = 0, read = 0) {
  const userId = `${role}-owner`;
  const rows: Row[] = Array.from({ length: count }, (_, i) => ({ id: BigInt(i + 1), userId,
    title: "Quiz Completed", message: "Synthetic notification", isRead: i >= count - read, createdAt: new Date(i * 1000) }));
  rows.push({ id: BigInt(999), userId: "other-owner", title: "Private", message: "Do not disclose", isRead: false, createdAt: new Date(999999) });
  const matches = (row: Row, where: Where) => row.userId === where.userId && (where.isRead === undefined || row.isRead === where.isRead) && (where.id === undefined || row.id === where.id);
  const queries: Array<{ kind: string; where: Where; take?: number; orderBy?: unknown }> = [];
  const prisma = { notification: {
    findMany: async (q: { where: Where; take: number; orderBy: unknown }) => {
      queries.push({ kind: "list", ...q }); return rows.filter(row => matches(row, q.where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, q.take);
    },
    count: async (q: { where: Where }) => { queries.push({ kind: "count", ...q }); return rows.filter(row => matches(row, q.where)).length; },
    updateMany: async (q: { where: Where }) => { const found = rows.filter(row => matches(row, q.where)); found.forEach(row => { row.isRead = true; }); return { count: found.length }; },
  } };
  const route: { GET?: (req: Request) => Promise<Response>; PUT?: (req: Request) => Promise<Response> } = {};
  const code = ts.transpileModule(fs.readFileSync("src/app/api/notifications/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: route, console, require(name: string) {
    if (name === "next/server") return { NextResponse: Response };
    if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
    if (name === "@/lib/auth") return { getScopedSession: async () => role ? { role, userId } : null };
    if (name === "@/lib/auth-origin") return { isTrustedAuthOrigin: (req: Request) => req.headers.get("origin") === "https://app.example.test" };
    if (name === "@/lib/notification-destination") return { getNotificationDestination: () => `/dashboard/${role}` };
    if (name === "@/lib/backup-write-gate") return { withBackupWriteGate: (fn: unknown) => fn };
    throw Error(`Unexpected dependency ${name}`);
  } });
  return { rows, queries, userId, get: () => route.GET!(new Request("https://app.example.test/api/notifications")),
    put: (id: string, origin = "https://app.example.test") => route.PUT!(new Request("https://app.example.test/api/notifications", { method: "PUT", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ id }) })) };
}

for (const role of ["student", "teacher", "admin"]) for (const [count, read] of [[0, 0], [1, 0], [31, 0], [31, 30], [31, 9]]) {
  test(`${role}: full unread total with ${count} notifications / ${read} read; recent list unchanged`, async () => {
    const s = fixture(role, count, read); const response = await s.get(); const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.unreadCount, count - read);
    assert.equal(body.notifications.length, Math.min(count, 20));
    assert.deepEqual(body.notifications.map((n: { id: string }) => n.id), Array.from({ length: Math.min(count, 20) }, (_, i) => String(count - i)));
    assert.ok(!JSON.stringify(body).includes("Do not disclose"));
    assert.equal(s.queries.length, 2); assert.ok(s.queries.every(q => q.where.userId === s.userId));
    assert.equal(s.queries.find(q => q.kind === "count")?.where.isRead, false);
    assert.equal(s.queries.find(q => q.kind === "list")?.take, 20);
    assert.deepEqual(JSON.parse(JSON.stringify(s.queries.find(q => q.kind === "list")?.orderBy)), { createdAt: "desc" });
  });
  test(`${role}: scoped mark-one/all and concurrent idempotent updates cannot touch another user`, async () => {
    const s = fixture(role, 31); assert.equal((await s.put("999")).status, 404);
    assert.equal((await s.put("1")).status, 200); assert.equal((await (await s.get()).json()).unreadCount, 30);
    const responses = await Promise.all([s.put("all"), s.put("all")]); assert.ok(responses.every(r => r.status === 200));
    assert.equal((await (await s.get()).json()).unreadCount, 0); assert.equal(s.rows.find(r => r.userId === "other-owner")?.isRead, false);
    assert.equal((await s.put("all", "https://foreign.example.test")).status, 403);
  });
}
test("unauthenticated notification reads and writes disclose no records and run no queries", async () => {
  const s = fixture(null, 31); assert.equal((await s.get()).status, 401); assert.equal((await s.put("all")).status, 401); assert.equal(s.queries.length, 0);
});
for (const role of ["student", "teacher", "admin"] as const) test(`${role} shell uses full server count, not the bounded recent list`, async () => {
  const s = shellFixture(role); s.queue("/api/notifications", { body: { success: true, unreadCount: 31, notifications: [] } });
  s.render(); await s.ready(); assert.equal(s.notificationCount(), 0); assert.equal(textOf(s.bell()), "9+");
});
test("a stale notification response cannot replace the latest full total", async () => {
  const s = shellFixture("student"); const pending = deferred<{ body: unknown }>();
  s.queue("/api/notifications", pending.promise); s.render(); await s.ready();
  s.queue("/api/notifications", { body: { success: true, unreadCount: 23, notifications: [] } });
  s.shellCallback("notification")(); await s.ready();
  pending.resolve({ body: { success: true, unreadCount: 1, notifications: [] } }); await s.ready(); assert.equal(textOf(s.bell()), "9+");
});
