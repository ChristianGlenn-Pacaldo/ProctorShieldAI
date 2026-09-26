import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type Subscription = {
  subscriptionStatus: string;
  endDate: Date;
  plan: { planName: string; yearlyPrice: number };
};

function loadRoute(routePath: string, prisma: object) {
  const absolutePath = path.resolve(process.cwd(), routePath);
  const compiled = ts.transpileModule(fs.readFileSync(absolutePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const route: { GET?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext(compiled, {
    exports: route,
    require: (name: string) => {
      if (name === "next/server") return {
        NextResponse: { json: (body: unknown, options: { status?: number } = {}) =>
          new Response(JSON.stringify(body), { status: options.status ?? 200 }) },
      };
      if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
      if (name === "@/lib/auth") return { getSession: async () => ({ role: "admin", userId: "admin-1" }) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console,
  }, { filename: absolutePath });
  return route.GET!;
}

function subscriptionMatches(subscription: Subscription, where: {
  subscriptionStatus: string;
  endDate: { gt: Date };
  plan: { yearlyPrice: { gt: number } };
}) {
  return subscription.subscriptionStatus === where.subscriptionStatus
    && subscription.endDate > where.endDate.gt
    && subscription.plan.yearlyPrice > where.plan.yearlyPrice.gt;
}

test("Admin dashboard counts only today's UTC flagged analyses and shows only paid plans as Pro", async () => {
  const originalNow = new Date();
  const utcStart = new Date(Date.UTC(originalNow.getUTCFullYear(), originalNow.getUTCMonth(), originalNow.getUTCDate()));
  const utcEnd = new Date(utcStart.getTime() + 86_400_000);
  let analysisWhere: {
    finalVerdict: { in: string[] };
    analyzedAt: { gte: Date; lt: Date };
  } | undefined;
  let subscriptionWhere: Parameters<typeof subscriptionMatches>[1] | undefined;
  const paidSubscription: Subscription = {
    subscriptionStatus: "active",
    endDate: new Date("2099-01-01"),
    plan: { planName: "Premium Monthly", yearlyPrice: 500 },
  };
  const freeSubscription: Subscription = {
    subscriptionStatus: "active",
    endDate: new Date("2099-01-01"),
    plan: { planName: "Free Tier", yearlyPrice: 0 },
  };
  const users = [
    { id: "paid", fullName: "Paid Teacher", email: "paid@example.invalid", userSubscriptions: [paidSubscription] },
    { id: "free", fullName: "Free Teacher", email: "free@example.invalid", userSubscriptions: [freeSubscription] },
  ];
  const prisma = {
    user: {
      count: async () => 2,
      findMany: async (query: { include: { userSubscriptions: { where: Parameters<typeof subscriptionMatches>[1] } } }) => {
        subscriptionWhere = query.include.userSubscriptions.where;
        return users.map((user) => ({
          ...user,
          status: "active",
          lastSeenAt: null,
          createdAt: new Date("2025-01-01"),
          role: { roleName: "teacher" },
          userSubscriptions: user.userSubscriptions.filter((subscription) => subscriptionMatches(subscription, subscriptionWhere!)),
        }));
      },
    },
    quiz: { count: async () => 0 },
    violation: { count: async () => 0 },
    aiAnalysis: {
      count: async (query: { where: typeof analysisWhere }) => {
        analysisWhere = query.where;
        const analyses = [
          { finalVerdict: "suspicious", analyzedAt: new Date(utcStart.getTime() - 1) },
          { finalVerdict: "cheated", analyzedAt: new Date(utcStart.getTime() + 1) },
          { finalVerdict: "suspicious", analyzedAt: utcEnd },
          { finalVerdict: "clean", analyzedAt: new Date(utcStart.getTime() + 1) },
        ];
        return analyses.filter((analysis) => query.where?.finalVerdict.in.includes(analysis.finalVerdict)
          && analysis.analyzedAt >= query.where.analyzedAt.gte
          && analysis.analyzedAt < query.where.analyzedAt.lt).length;
      },
    },
  };
  const get = loadRoute("src/app/api/dashboard/admin/route.ts", prisma);
  const response = await get(new Request("http://localhost/api/dashboard/admin"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.stats.aiVerdictsToday, 1);
  assert.equal(analysisWhere?.analyzedAt.gte.getTime(), utcStart.getTime());
  assert.equal(analysisWhere?.analyzedAt.lt.getTime(), utcEnd.getTime());
  assert.deepEqual(Array.from(analysisWhere?.finalVerdict.in ?? []), ["suspicious", "cheated"]);
  assert.equal(subscriptionWhere?.subscriptionStatus, "active");
  assert.equal(subscriptionWhere?.plan.yearlyPrice.gt, 0);
  assert.equal(body.users.find((user: { id: string }) => user.id === "paid").plan, "Premium");
  assert.equal(body.users.find((user: { id: string }) => user.id === "free").plan, "Free Tier");
});

test("Admin analytics counts ended quizzes and distinct teachers with paid entitlement", async () => {
  const paidSubscription: Subscription = {
    subscriptionStatus: "active",
    endDate: new Date("2099-01-01"),
    plan: { planName: "Premium Monthly", yearlyPrice: 500 },
  };
  const freeSubscription: Subscription = {
    subscriptionStatus: "active",
    endDate: new Date("2099-01-01"),
    plan: { planName: "Free Tier", yearlyPrice: 0 },
  };
  const teachers = [
    { id: "paid", subscriptions: [paidSubscription, paidSubscription] },
    { id: "free", subscriptions: [freeSubscription] },
  ];
  const quizzes = ["ended", "completed", "active"];
  let completedQuizQuery: { quizStatus: { in: string[] } } | undefined;
  let paidTeacherQuery: { userSubscriptions: { some: Parameters<typeof subscriptionMatches>[1] } } | undefined;
  const prisma = {
    user: {
      count: async (query: { where: { role?: { roleName: string }; userSubscriptions?: { some: Parameters<typeof subscriptionMatches>[1] } } }) => {
        const role = query.where.role?.roleName;
        if (role === "teacher" && query.where.userSubscriptions) {
          paidTeacherQuery = { userSubscriptions: query.where.userSubscriptions };
          return teachers.filter((teacher) => teacher.subscriptions.some((subscription) =>
            subscriptionMatches(subscription, query.where.userSubscriptions!.some))).length;
        }
        if (role === "teacher") return teachers.length;
        if (query.where.role) return 0;
        return 0;
      },
    },
    userSubscription: { count: async () => { throw new Error("Subscription rows must not be counted"); } },
    quiz: {
      count: async (query?: { where: { quizStatus: { in: string[] } } }) => {
        if (!query) return quizzes.length;
        completedQuizQuery = query.where;
        return quizzes.filter((status) => query.where.quizStatus.in.includes(status)).length;
      },
    },
    studentQuiz: { count: async (query?: object) => {
      assert.equal(query, undefined);
      return 5;
    } },
    aiAnalysis: { count: async () => 0 },
    violation: { count: async () => 0 },
  };
  const get = loadRoute("src/app/api/dashboard/admin/analytics/route.ts", prisma);
  const response = await get(new Request("http://localhost/api/dashboard/admin/analytics"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(Array.from(completedQuizQuery?.quizStatus.in ?? []), ["ended", "completed"]);
  assert.equal(body.quizStats.totalQuizzes, 3);
  assert.equal(body.quizStats.completedQuizzes, 2);
  assert.equal(body.quizStats.totalAttempts, 5);
  assert.equal(paidTeacherQuery?.userSubscriptions.some.subscriptionStatus, "active");
  assert.equal(paidTeacherQuery?.userSubscriptions.some.plan.yearlyPrice.gt, 0);
  assert.equal(body.subscriptionStats.proTeachers, 1);
  assert.equal(body.subscriptionStats.freeTeachers, 1);
  assert.equal(body.subscriptionStats.conversionPct, 50);
  assert.ok(body.subscriptionStats.conversionPct <= 100);
});

test("Admin analytics completion rate uses quizzes rather than attempt count", () => {
  const componentPath = path.resolve(process.cwd(), "src/app/dashboard/admin/analytics/content.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(componentPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const data = {
    userStats: { totalUsers: 2, totalStudents: 0, totalTeachers: 2, totalAdmins: 0, newUsersThisMonth: 0 },
    subscriptionStats: { proTeachers: 1, freeTeachers: 1, conversionPct: 50 },
    quizStats: { totalQuizzes: 3, completedQuizzes: 2, totalAttempts: 5 },
    aiStats: { totalVerdicts: 0, totalViolations: 0, cleanCount: 0, suspiciousCount: 0, cheatedCount: 0, cleanPct: 0, suspiciousPct: 0, cheatedPct: 0, flaggedPct: 0 },
  };
  let stateCalls = 0;
  const component: { default?: () => unknown } = {};
  const jsx = (type: string | ((...args: unknown[]) => unknown), props: Record<string, unknown>) => ({ type, props });
  vm.runInNewContext(compiled, {
    exports: component,
    require: (name: string) => {
      if (name === "react") return { useState: () => stateCalls++ === 0 ? [data, () => {}] : [false, () => {}], useEffect: () => {} };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "lucide-react") return { Users: "Users", BookOpen: "BookOpen", Brain: "Brain", CreditCard: "CreditCard" };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename: componentPath });
  const view = component.default!();
  const found: Array<{ type: string | ((...args: unknown[]) => unknown); props: Record<string, unknown> }> = [];
  function visit(node: unknown) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const element = node as { type: string | ((...args: unknown[]) => unknown); props: Record<string, unknown> };
    found.push(element);
    visit(element.props.children);
  }
  visit(view);
  const completionBar = found.find((element) => element.props.label === "Completion Rate");
  assert.equal(completionBar?.props.value, "67%");
  assert.equal(completionBar?.props.pct, 67);
  assert.ok(found.some((element) => element.props.children === "Completed Quizzes"));
});
