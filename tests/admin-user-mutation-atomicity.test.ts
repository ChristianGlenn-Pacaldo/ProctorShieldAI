import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const adminRoute = "src/app/api/dashboard/admin/users/[id]/route.ts";
const dashboardRoute = "src/app/api/users/[id]/route.ts";

type Subscription = {
  userId: string;
  planId: number;
  subscriptionStatus: string;
  paymentStatus: string;
};

type State = {
  user: { id: string; fullName: string; status: string };
  subscriptions: Subscription[];
  logs: Array<{ activity: string }>;
};

type Fault = "activityLog" | "updateMany" | "upsert" | null;

function fixture(fault: Fault = null) {
  let state: State = {
    user: { id: "teacher-1", fullName: "Teacher Name", status: "active" },
    subscriptions: [{ userId: "teacher-1", planId: 1, subscriptionStatus: "active", paymentStatus: "paid" }],
    logs: [],
  };
  let commits = 0;
  const events: Array<{ committed: boolean; status: string; type: string }> = [];

  const clientFor = (target: State) => ({
    user: {
      findUnique: async () => ({ ...target.user, role: { roleName: "teacher" }, userSubscriptions: target.subscriptions }),
      update: async ({ data }: { data: { status: string } }) => {
        target.user.status = data.status;
        return target.user;
      },
    },
    subscriptionPlan: { findFirst: async () => ({ id: 2, planName: "Premium Monthly" }) },
    userSubscription: {
      updateMany: async ({ where, data }: {
        where: { userId: string; planId?: { not: number }; subscriptionStatus?: string };
        data: { subscriptionStatus: string };
      }) => {
        if (fault === "updateMany") throw new Error("subscription update failed");
        const matching = target.subscriptions.filter((subscription) =>
          subscription.userId === where.userId
          && (!where.planId || subscription.planId !== where.planId.not)
          && (!where.subscriptionStatus || subscription.subscriptionStatus === where.subscriptionStatus));
        for (const subscription of matching) subscription.subscriptionStatus = data.subscriptionStatus;
        return { count: matching.length };
      },
      upsert: async ({ where, update, create }: {
        where: { userId_planId: { userId: string; planId: number } };
        update: Subscription;
        create: Subscription;
      }) => {
        if (fault === "upsert") throw new Error("subscription upsert failed");
        const existing = target.subscriptions.find((subscription) =>
          subscription.userId === where.userId_planId.userId
          && subscription.planId === where.userId_planId.planId);
        if (existing) Object.assign(existing, update);
        else target.subscriptions.push({ ...create });
        return existing ?? create;
      },
    },
    activityLog: {
      create: async ({ data }: { data: { activity: string } }) => {
        if (fault === "activityLog") throw new Error("activity log failed");
        target.logs.push({ activity: data.activity });
        return data;
      },
    },
  });

  const prisma = {
    ...clientFor(state),
    $transaction: async <Result>(operation: (client: ReturnType<typeof clientFor>) => Promise<Result>) => {
      const draft = structuredClone(state);
      const result = await operation(clientFor(draft));
      state = draft;
      commits++;
      return result;
    },
  };
  const dependencies: Record<string, unknown> = {
    "next/server": {
      NextResponse: {
        json: (body: unknown, options: { status?: number } = {}) =>
          new Response(JSON.stringify(body), { status: options.status ?? 200 }),
      },
    },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/auth": { getSession: async () => ({ role: "admin", userId: "admin-1" }) },
    "@/lib/subscription-rules": { PRO_SUBSCRIPTION_DURATION_DAYS: 30 },
    "@/lib/pusher": {
      pusherServer: {
        trigger: async (_channel: string, _event: string, payload: { type: string }) => {
          events.push({ committed: commits > 0, status: state.user.status, type: payload.type });
        },
      },
    },
  };

  return { dependencies, events, getState: () => state, getCommits: () => commits };
}

async function invoke(routeFile: string, setup: ReturnType<typeof fixture>, body: Record<string, string>) {
  const routePath = path.resolve(process.cwd(), routeFile);
  const compiled = ts.transpileModule(fs.readFileSync(routePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const route: { PUT?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } = {};
  vm.runInNewContext(compiled, {
    exports: route,
    require: (name: string) => setup.dependencies[name],
    console: { error() {} },
  }, { filename: routePath });
  return route.PUT!(new Request("http://localhost/api/users/teacher-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "teacher-1" }) });
}

test("Admin status rolls back when its activity log fails", async () => {
  const setup = fixture("activityLog");
  const response = await invoke(adminRoute, setup, { status: "suspended" });

  assert.equal(response.status, 500);
  assert.equal(setup.getState().user.status, "active");
  assert.equal(setup.getState().logs.length, 0);
  assert.equal(setup.events.length, 0);
  assert.equal(setup.getCommits(), 0);
});

test("Admin grant rolls back status and prior-plan cancellation when upsert fails", async () => {
  const setup = fixture("upsert");
  const response = await invoke(adminRoute, setup, { status: "suspended", subscriptionStatus: "active" });

  assert.equal(response.status, 500);
  assert.equal(setup.getState().user.status, "active");
  assert.deepEqual(setup.getState().subscriptions.map((subscription) => [subscription.planId, subscription.subscriptionStatus]), [[1, "active"]]);
  assert.equal(setup.getState().logs.length, 0);
  assert.equal(setup.events.length, 0);
  assert.equal(setup.getCommits(), 0);
});

test("Admin revoke rolls back when its activity log fails", async () => {
  const setup = fixture("activityLog");
  const response = await invoke(adminRoute, setup, { subscriptionStatus: "expired" });

  assert.equal(response.status, 500);
  assert.equal(setup.getState().subscriptions[0].subscriptionStatus, "active");
  assert.equal(setup.getState().logs.length, 0);
  assert.equal(setup.events.length, 0);
});

test("Admin grant rolls back subscription changes when its activity log fails", async () => {
  const setup = fixture("activityLog");
  const response = await invoke(adminRoute, setup, { subscriptionStatus: "active" });

  assert.equal(response.status, 500);
  assert.deepEqual(setup.getState().subscriptions.map((subscription) => [subscription.planId, subscription.subscriptionStatus]), [[1, "active"]]);
  assert.equal(setup.getState().logs.length, 0);
  assert.equal(setup.events.length, 0);
  assert.equal(setup.getCommits(), 0);
});

test("Admin status-only update commits its audit record before realtime", async () => {
  const setup = fixture();
  const response = await invoke(adminRoute, setup, { status: "suspended" });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(setup.getState().user.status, "suspended");
  assert.match(setup.getState().logs[0].activity, /suspended user/);
  assert.deepEqual(setup.events, [{ committed: true, status: "suspended", type: "user_update" }]);
  assert.equal(setup.getCommits(), 1);
});

test("Admin compound grant commits status, subscription, and logs before realtime", async () => {
  const setup = fixture();
  const response = await invoke(adminRoute, setup, { status: "suspended", subscriptionStatus: "active" });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(setup.getState().user.status, "suspended");
  assert.deepEqual(setup.getState().subscriptions.map((subscription) => [subscription.planId, subscription.subscriptionStatus]), [[1, "cancelled"], [2, "active"]]);
  assert.equal(setup.getState().logs.length, 2);
  assert.deepEqual(setup.events, [{ committed: true, status: "suspended", type: "user_update" }]);
  assert.equal(setup.getCommits(), 1);
});

test("Admin revoke commits the subscription and audit record before realtime", async () => {
  const setup = fixture();
  const response = await invoke(adminRoute, setup, { subscriptionStatus: "expired" });

  assert.equal(response.status, 200);
  assert.equal(setup.getState().subscriptions[0].subscriptionStatus, "expired");
  assert.match(setup.getState().logs[0].activity, /revoked Pro subscription/);
  assert.deepEqual(setup.events, [{ committed: true, status: "active", type: "user_update" }]);
});

test("Dashboard user update rolls back status and cancellation when Premium upsert fails", async () => {
  const setup = fixture("upsert");
  const response = await invoke(dashboardRoute, setup, { status: "suspended", plan: "Premium" });

  assert.equal(response.status, 500);
  assert.equal(setup.getState().user.status, "active");
  assert.deepEqual(setup.getState().subscriptions.map((subscription) => [subscription.planId, subscription.subscriptionStatus]), [[1, "active"]]);
  assert.equal(setup.getCommits(), 0);
});

test("Dashboard user update rolls back status when Free Tier cancellation fails", async () => {
  const setup = fixture("updateMany");
  const response = await invoke(dashboardRoute, setup, { status: "suspended", plan: "Free Tier" });

  assert.equal(response.status, 500);
  assert.equal(setup.getState().user.status, "active");
  assert.equal(setup.getState().subscriptions[0].subscriptionStatus, "active");
  assert.equal(setup.getCommits(), 0);
});

test("Dashboard user update commits status and plan without changing its response contract", async () => {
  const setup = fixture();
  const response = await invoke(dashboardRoute, setup, { status: "suspended", plan: "Premium" });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(setup.getState().user.status, "suspended");
  assert.deepEqual(setup.getState().subscriptions.map((subscription) => [subscription.planId, subscription.subscriptionStatus]), [[1, "cancelled"], [2, "active"]]);
  assert.equal(setup.getState().logs.length, 0);
  assert.equal(setup.events.length, 0);
  assert.equal(setup.getCommits(), 1);
});

test("Dashboard Free Tier cancellation commits and returns success", async () => {
  const setup = fixture();
  const response = await invoke(dashboardRoute, setup, { plan: "Free Tier" });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(setup.getState().subscriptions[0].subscriptionStatus, "cancelled");
  assert.equal(setup.getCommits(), 1);
});
