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
  { file: "src/app/api/dashboard/admin/users/[id]/route.ts", grant: { subscriptionStatus: "active" }, free: { subscriptionStatus: "expired" } },
  { file: "src/app/api/users/[id]/route.ts", grant: { plan: "Premium" }, free: { plan: "Free Tier" } },
] as const;

type PlanAvailability = "missing" | "free" | "paid";

function routeFixture(file: string, role = "teacher", planAvailability: PlanAvailability = "paid", hasPaidAccess = false) {
  let state = { status: "active", hasPaidAccess, subscription: null as any, adjustments: [] as any[] };
  const writes: string[] = [];
  let broadcasts = 0;
  let planWasFilteredByPrice = false;
  const clientFor = (target: typeof state) => ({
    $executeRaw: async () => 1,
    payment: { findMany: async () => [] },
    manualSubscriptionAdjustment: {
      findMany: async () => target.adjustments,
      create: async ({ data }: any) => { const a = { ...data, id: "manual" }; target.adjustments.push(a); return a; },
    },
    user: {
      findUnique: async () => ({ id: "target", fullName: "QA User", roleId: 2, status: target.status, role: { roleName: role }, userSubscriptions: [] }),
      update: async ({ data }: { data: { status: string } }) => { writes.push("user"); target.status = data.status; },
      count: async () => 2,
    },
    userSubscription: {
      findMany: async () => target.hasPaidAccess ? [target.subscription ?? { id: "paid-subscription" }] : [],
      findUnique: async () => target.subscription,
      update: async ({ data }: any) => {
        const increment = data.accountingSequence?.increment;
        const oldSequence = target.subscription.accountingSequence;
        Object.assign(target.subscription, data);
        if (increment) target.subscription.accountingSequence = oldSequence + BigInt(increment);
        if (data.subscriptionStatus) target.hasPaidAccess = data.subscriptionStatus === "active";
        return target.subscription;
      },
      findFirst: async () => target.hasPaidAccess ? { id: "paid-subscription" } : null,
      updateMany: async () => { writes.push("subscription update"); target.hasPaidAccess = false; },
      upsert: async ({ create }: any) => { writes.push("subscription grant"); target.subscription = { ...create, id: "manual-sub", accountingSequence: BigInt(0) }; return target.subscription; },
    },
    subscriptionPlan: {
      findFirst: async ({ where }: { where: { yearlyPrice?: { gt: number } } }) => {
        planWasFilteredByPrice = where.yearlyPrice?.gt === 0;
        return planAvailability === "paid" || (planAvailability === "free" && !planWasFilteredByPrice)
          ? { id: 2, planName: "Premium Monthly", yearlyPrice: planAvailability === "paid" ? 500 : 0 }
          : null;
      },
    },
    activityLog: { create: async () => { writes.push("activity log"); } },
  });
  const prisma = {
    ...clientFor(state),
    $transaction: async <Result>(callback: (client: ReturnType<typeof clientFor>) => Promise<Result>) => {
      const draft = structuredClone(state);
      const result = await callback(clientFor(draft));
      state = draft;
      return result;
    },
  };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) => new Response(JSON.stringify(body), { status: options?.status ?? 200 }) } },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/auth-origin": { isTrustedAuthOrigin },
    "@/lib/auth": { getAdminSession: async () => ({ role: "admin", userId: "admin" }) },
    "@/lib/paymongo-subscription": loadBillingModule(prisma as unknown as PrismaClient),
    "@/lib/pusher": { pusherServer: { trigger: async () => { broadcasts++; } } },
  };
  const filename = path.resolve(process.cwd(), file);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const route: { PUT?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } = {};
  vm.runInNewContext(compiled, {
    exports: route,
    require: (name: string) => name === "@/lib/backup-write-gate" ? { withBackupWriteGate: (handler: unknown) => handler } : dependencies[name],
    console: { error() {} },
  }, { filename });
  return {
    invoke: (body: unknown) => route.PUT!(new Request("http://localhost/api/users/target", {
      method: "PUT", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: "target" }) }),
    getState: () => state,
    getWrites: () => writes,
    getBroadcasts: () => broadcasts,
    wasFilteredByPrice: () => planWasFilteredByPrice,
  };
}

for (const route of routes) {
  test(`${route.file} rejects missing and zero-price Premium plans before any write`, async () => {
    for (const availability of ["missing", "free"] as const) {
      const setup = routeFixture(route.file, "teacher", availability);
      const response = await setup.invoke({ status: "suspended", ...route.grant });
      assert.equal(response.status, 422);
      assert.match((await response.json()).error, /valid paid Premium plan/);
      assert.equal(setup.getState().status, "active");
      assert.equal(setup.getState().hasPaidAccess, false);
      assert.deepEqual(setup.getWrites(), []);
      assert.equal(setup.getBroadcasts(), 0);
      assert.equal(setup.wasFilteredByPrice(), true);
    }
  });

  test(`${route.file} rejects unsupported fields and invalid values without partial updates`, async () => {
    for (const field of ["fullName", "email", "role"]) {
      const setup = routeFixture(route.file);
      const response = await setup.invoke({ status: "suspended", [field]: "changed" });
      assert.equal(response.status, 400);
      assert.equal(setup.getState().status, "active");
      assert.deepEqual(setup.getWrites(), []);
      assert.equal(setup.getBroadcasts(), 0);
    }
    for (const body of [null, [], {}, { status: "unknown" }, route.file.includes("dashboard/admin") ? { subscriptionStatus: "unknown" } : { plan: "unknown" }]) {
      const setup = routeFixture(route.file);
      assert.equal((await setup.invoke(body)).status, 400);
      assert.deepEqual(setup.getWrites(), []);
    }
  });

  test(`${route.file} rejects Student subscription changes without writes`, async () => {
    const setup = routeFixture(route.file, "student");
    const response = await setup.invoke({ status: "suspended", ...route.grant });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Teachers/);
    assert.equal(setup.getState().status, "active");
    assert.deepEqual(setup.getWrites(), []);
  });

  test(`${route.file} keeps valid unchanged subscriptions idempotent and allows paid grants`, async () => {
    const paid = routeFixture(route.file, "teacher", "missing", true);
    assert.equal((await paid.invoke(route.grant)).status, 200);
    assert.equal(paid.getState().hasPaidAccess, true);
    assert.deepEqual(paid.getWrites(), []);

    const free = routeFixture(route.file);
    assert.equal((await free.invoke(route.free)).status, 200);
    assert.equal(free.getState().hasPaidAccess, false);
    assert.deepEqual(free.getWrites(), []);

    const grant = routeFixture(route.file);
    assert.equal((await grant.invoke(route.grant)).status, 200);
    assert.equal(grant.getState().hasPaidAccess, true);
    assert.ok(grant.getWrites().includes("subscription grant"));
  });
}

type ElementNode = { type: string; props: Record<string, unknown> };

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) return textOf((value as ElementNode).props.children);
  return value === null || value === undefined || typeof value === "boolean" ? "" : String(value);
}

function findElement(value: unknown, predicate: (node: ElementNode) => boolean): ElementNode | undefined {
  if (Array.isArray(value)) return value.map((child) => findElement(child, predicate)).find(Boolean);
  if (!value || typeof value !== "object" || !("props" in value)) return undefined;
  const node = value as ElementNode;
  return predicate(node) ? node : findElement(node.props.children, predicate);
}

test("Student user details has no actionable Save while Teacher editing retains one", () => {
  const filename = path.resolve(process.cwd(), "src/app/dashboard/admin/users/content.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  for (const role of ["Student", "Teacher"]) {
    const states: unknown[] = [];
    let index = 0;
    const user = { id: "target", name: "QA User", email: "qa@example.invalid", role, roleClass: "", status: "Active", statusClass: "", joined: "Today", subscription: "Free Plan" };
    const react = {
      useState: (initial: unknown) => {
        const current = index++;
        if (!(current in states)) states[current] = current === 1 ? [user] : initial;
        return [states[current], (next: unknown) => { states[current] = next; }];
      },
      useEffect: () => {},
    };
    const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
    const exports: { default?: () => ElementNode } = {};
    vm.runInNewContext(compiled, {
      exports,
      require: (name: string) => name === "react" ? react : name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : {},
    }, { filename });
    const render = () => { index = 0; return exports.default!(); };
    const action = findElement(render(), (node) => node.type === "button" && textOf(node) === (role === "Teacher" ? "Edit" : "View"));
    assert.ok(action);
    (action.props.onClick as () => void)();
    const modal = render();
    assert.match(textOf(modal), role === "Teacher" ? /Edit User/ : /User Details/);
    assert.equal(Boolean(findElement(modal, (node) => node.type === "button" && textOf(node) === "Save Changes")), role === "Teacher");
  }
});
