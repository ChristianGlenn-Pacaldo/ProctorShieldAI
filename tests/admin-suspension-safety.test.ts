import { isTrustedAuthOrigin } from "../src/lib/auth-origin.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadBillingModule } from "./helpers/paymongo-fixture.ts";
import type { PrismaClient } from "@prisma/client";

const routes = [
  "src/app/api/dashboard/admin/users/[id]/route.ts",
  "src/app/api/users/[id]/route.ts",
];

type RoleName = "admin" | "teacher" | "student";
type User = { id: string; fullName: string; status: string; roleId: number; role: { roleName: RoleName } };
type State = { users: User[]; logs: string[] };

function fixture(targetRole: RoleName, targetId = "target", actorActive = true, writeConflict = false) {
  const roleIds = { admin: 1, teacher: 2, student: 3 };
  let state: State = {
    users: [
      { id: "admin-actor", fullName: "Acting Admin", status: actorActive ? "active" : "suspended", roleId: 1, role: { roleName: "admin" } },
      ...(targetId === "admin-actor" ? [] : [
        { id: targetId, fullName: "Target User", status: "active", roleId: roleIds[targetRole], role: { roleName: targetRole } },
      ]),
    ],
    logs: [],
  };
  let commits = 0;
  let updates = 0;
  let subscriptionWrites = 0;
  const counts: number[] = [];
  const isolationLevels: Array<string | undefined> = [];
  const events: unknown[] = [];

  const clientFor = (target: State) => ({
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => target.users.find((user) => user.id === where.id) ?? null,
      count: async ({ where }: { where: { roleId: number; status: string } }) => {
        const count = target.users.filter((user) => user.roleId === where.roleId && user.status === where.status).length;
        counts.push(count);
        return count;
      },
      update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
        updates++;
        const user = target.users.find((entry) => entry.id === where.id);
        assert.ok(user);
        user.status = data.status;
        return user;
      },
    },
    activityLog: {
      create: async ({ data }: { data: { activity: string } }) => {
        target.logs.push(data.activity);
        return data;
      },
    },
    userSubscription: {
      findFirst: async () => null,
      updateMany: async () => { subscriptionWrites++; return { count: 0 }; },
      upsert: async () => { subscriptionWrites++; return {}; },
    },
    subscriptionPlan: { findFirst: async () => null },
  });

  const prisma = {
    ...clientFor(state),
    $transaction: async <Result>(operation: (client: ReturnType<typeof clientFor>) => Promise<Result>, options?: { isolationLevel: string }) => {
      isolationLevels.push(options?.isolationLevel);
      const draft = structuredClone(state);
      const result = await operation(clientFor(draft));
      if (writeConflict) {
        throw Object.assign(new Error("TransactionWriteConflict"), {
          cause: { kind: "TransactionWriteConflict", originalCode: "40001" },
        });
      }
      state = draft;
      commits++;
      return result;
    },
  };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options: { status?: number } = {}) =>
      new Response(JSON.stringify(body), { status: options.status ?? 200 }) } },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/auth-origin": { isTrustedAuthOrigin },
    "@/lib/auth": { getAdminSession: async () => ({ role: "admin", userId: "admin-actor" }) },
    "@/lib/paymongo-subscription": loadBillingModule(prisma as unknown as PrismaClient),
    "@/lib/pusher": { pusherServer: { trigger: async (_channel: string, _event: string, payload: unknown) => { events.push(payload); } } },
  };

  return {
    dependencies,
    events,
    counts,
    isolationLevels,
    getState: () => state,
    getCommits: () => commits,
    getUpdates: () => updates,
    getSubscriptionWrites: () => subscriptionWrites,
  };
}

async function invoke(routeFile: string, setup: ReturnType<typeof fixture>, targetId: string, status: string) {
  const absolutePath = path.resolve(process.cwd(), routeFile);
  const code = ts.transpileModule(fs.readFileSync(absolutePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const route: { PUT?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } = {};
  vm.runInNewContext(code, {
    exports: route,
    require: (name: string) => name === "@/lib/backup-write-gate" ? { withBackupWriteGate: (handler: unknown) => handler } : setup.dependencies[name],
    console: { error() {} },
  }, { filename: absolutePath });
  return route.PUT!(new Request(`http://localhost/api/users/${targetId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({ status }),
  }), { params: Promise.resolve({ id: targetId }) });
}

for (const routeFile of routes) {
  test(`${routeFile} rejects Admin self-suspension without writes or events`, async () => {
    const setup = fixture("admin", "admin-actor");
    const response = await invoke(routeFile, setup, "admin-actor", "suspended");

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /cannot suspend your own Admin account/i);
    assert.equal(setup.getState().users[0].status, "active");
    assert.deepEqual([setup.getCommits(), setup.getUpdates(), setup.getSubscriptionWrites(), setup.getState().logs.length, setup.events.length], [0, 0, 0, 0, 0]);
  });

  test(`${routeFile} rejects suspension of the last active Admin without partial state`, async () => {
    const setup = fixture("admin", "target", false);
    const response = await invoke(routeFile, setup, "target", "suspended");

    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /last active Admin account/i);
    assert.equal(setup.getState().users[1].status, "active");
    assert.deepEqual(setup.counts, [1]);
    assert.deepEqual(setup.isolationLevels, ["Serializable"]);
    assert.deepEqual([setup.getCommits(), setup.getUpdates(), setup.getSubscriptionWrites(), setup.getState().logs.length, setup.events.length], [0, 0, 0, 0, 0]);
  });

  test(`${routeFile} suspends another Admin when two active Admins remain before the change`, async () => {
    const setup = fixture("admin");
    const response = await invoke(routeFile, setup, "target", "suspended");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(setup.getState().users[0].status, "active");
    assert.equal(setup.getState().users[1].status, "suspended");
    assert.deepEqual(setup.counts, [2]);
    assert.deepEqual(setup.isolationLevels, ["Serializable"]);
    assert.equal(setup.getCommits(), 1);
    assert.equal(setup.getUpdates(), 1);
    assert.equal(setup.getState().logs.length, routeFile === routes[0] ? 1 : 0);
    assert.equal(setup.events.length, routeFile === routes[0] ? 1 : 0);
  });

  test(`${routeFile} reports a concurrent Admin write conflict without committing`, async () => {
    const setup = fixture("admin", "target", true, true);
    const response = await invoke(routeFile, setup, "target", "suspended");

    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /concurrent Admin status change/i);
    assert.equal(setup.getState().users.filter((user) => user.role.roleName === "admin" && user.status === "active").length, 2);
    assert.deepEqual([setup.getCommits(), setup.getState().logs.length, setup.events.length, setup.getSubscriptionWrites()], [0, 0, 0, 0]);
  });

  test(`${routeFile} still restores a suspended Admin`, async () => {
    const setup = fixture("admin");
    setup.getState().users[1].status = "suspended";
    const response = await invoke(routeFile, setup, "target", "active");

    assert.equal(response.status, 200);
    assert.equal(setup.getState().users[1].status, "active");
    assert.deepEqual(setup.counts, []);
    assert.deepEqual(setup.isolationLevels, [undefined]);
  });

  for (const role of ["teacher", "student"] as const) {
    test(`${routeFile} preserves ${role} suspend and restore behavior`, async () => {
      const setup = fixture(role);
      const suspend = await invoke(routeFile, setup, "target", "suspended");
      assert.equal(suspend.status, 200);
      assert.equal(setup.getState().users[1].status, "suspended");

      const restore = await invoke(routeFile, setup, "target", "active");
      assert.equal(restore.status, 200);
      assert.equal(setup.getState().users[1].status, "active");
      assert.deepEqual(setup.counts, []);
      assert.deepEqual(setup.isolationLevels, [undefined, undefined]);
      assert.equal(setup.getCommits(), 2);
      assert.equal(setup.getUpdates(), 2);
      assert.equal(setup.getSubscriptionWrites(), 0);
      assert.equal(setup.getState().logs.length, routeFile === routes[0] ? 2 : 0);
      assert.equal(setup.events.length, routeFile === routes[0] ? 2 : 0);
    });
  }
}
