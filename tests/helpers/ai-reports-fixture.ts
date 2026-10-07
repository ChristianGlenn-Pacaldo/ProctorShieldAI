import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { loadUserLifecycleModule } from "./user-lifecycle-module.ts";

export const NOW = new Date("2026-10-07T01:00:00.000Z");
export function reportAttempt(overrides: Record<string, any> = {}): any {
  return {
    id: "attempt-1", studentId: "student-1", quizId: 7, attemptNumber: 1,
    attemptMode: "proctored", quizStatus: "completed", createdAt: NOW,
    startTime: NOW, endTime: NOW, score: 80, aiVerdict: "clean", cheatingProbability: 0,
    student: { id: "student-1", fullName: "Fixture Student", password: "never-expose" },
    quiz: { id: 7, title: "Fixture Quiz", teacherId: "teacher-1", quizMode: "arena" },
    aiAnalysis: { totalViolations: 0, aiExplanation: "No recorded events", analyzedAt: NOW },
    violations: [], ...overrides,
  };
}
export function reportEvent(id: bigint, violationType: string | null = "tab_switch", overrides: Record<string, any> = {}) {
  return { id, studentQuizId: "attempt-1", violationType, timestamp: NOW, confidenceScore: 90,
    durationSeconds: 4, screenshotPath: null, ...overrides };
}

function compiled(file: string) {
  return ts.transpileModule(fs.readFileSync(path.resolve(process.cwd(), file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
}
function matches(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]: [string, any]) => {
    if (key === "AND") return expected.every((part: any) => matches(row, part));
    if (key === "OR") return expected.some((part: any) => matches(row, part));
    if (key === "some") return Array.isArray(row) && row.some((event) => matches(event, expected));
    const value = row?.[key];
    if (expected === null || typeof expected !== "object") return value === expected;
    if ("not" in expected) return value !== expected.not;
    if ("in" in expected) return expected.in.includes(value);
    if ("contains" in expected) return String(value).toLowerCase().includes(String(expected.contains).toLowerCase());
    return matches(value, expected);
  });
}
function select(row: any, fields: any): any {
  return Object.fromEntries(Object.entries(fields).map(([key, query]: [string, any]) => {
    if (query === true) return [key, row[key]];
    if (Array.isArray(row[key])) {
      let items = row[key].filter((item: any) => matches(item, query.where));
      if (query.orderBy) items = ordered(items, query.orderBy);
      return [key, items.map((item: any) => select(item, query.select))];
    }
    return [key, row[key] == null ? null : select(row[key], query.select)];
  }));
}
function ordered(rows: any[], clauses: any) {
  const order = Array.isArray(clauses) ? clauses : [clauses];
  return [...rows].sort((a, b) => {
    for (const clause of order) {
      const [key, direction] = Object.entries(clause)[0] as [string, string];
      if (a[key] === b[key]) continue;
      const difference = a[key] == null ? -1 : b[key] == null ? 1 : a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
      if (difference) return difference * (direction === "desc" ? -1 : 1);
    }
    return 0;
  });
}
export function reportsRoute(role: "student" | "teacher", options: {
  attempts?: any[]; evidence?: any[]; session?: { role: string; userId: string } | null;
  pro?: boolean; evidenceFailure?: boolean; databaseFailure?: boolean;
} = {}) {
  const attempts = options.attempts ?? [reportAttempt()];
  const queries: any[] = [];
  const violations = () => attempts.flatMap((attempt) => attempt.violations.map((event: any) => ({ ...event, studentQuiz: attempt })));
  const prisma: any = {
    studentQuiz: {
      count: async (query: any) => { queries.push({ model: "attempt-count", ...query }); return attempts.filter((row) => matches(row, query.where)).length; },
      findMany: async (query: any) => {
        queries.push({ model: "attempts", ...query });
        let rows = attempts.filter((row) => matches(row, query.where));
        if (query.orderBy) rows = ordered(rows, query.orderBy);
        rows = rows.slice(query.skip ?? 0, query.take ? (query.skip ?? 0) + query.take : undefined);
        return query.select ? rows.map((row) => select(row, query.select)) : rows;
      },
    },
    violation: {
      count: async (query: any) => { queries.push({ model: "event-count", ...query }); return violations().filter((row) => matches(row, query.where)).length; },
      findMany: async (query: any) => {
        queries.push({ model: "events", ...query });
        let rows = violations().filter((row) => matches(row, query.where));
        if (query.orderBy) rows = ordered(rows, query.orderBy);
        if (query.distinct) { const seen = new Set(); rows = rows.filter((row) => { const key = JSON.stringify(query.distinct.map((field: string) => row[field])); if (seen.has(key)) return false; seen.add(key); return true; }); }
        return rows.map((row) => select(row, query.select));
      },
    },
    evidenceFile: { findMany: async (query: any) => {
      queries.push({ model: "evidence", ...query });
      if (options.evidenceFailure) throw new Error("Storage metadata offline");
      return ordered((options.evidence ?? []).filter((row) => matches(row, query.where)), query.orderBy).map((row) => select(row, query.select));
    } },
    $transaction: async (callback: (tx: any) => unknown, transactionOptions: any) => {
      queries.push({ model: "transaction", ...transactionOptions });
      if (options.databaseFailure) throw new Error("Database offline");
      return callback(prisma);
    },
  };
  const modules = new Map<string, any>();
  const load = (file: string): any => {
    if (modules.has(file)) return modules.get(file);
    const output = {}; modules.set(file, output);
    vm.runInNewContext(compiled(file), {
      exports: output, Date, URL, URLSearchParams, Map, Set, BigInt,
      console: { error() {}, warn() {} },
      require: (name: string): any => {
        if (name === "next/server") return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
        if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
        if (name === "@/lib/auth") return { getUserSession: async () => options.session === undefined ? { role, userId: role + "-1" } : options.session };
        if (name === "@/lib/maintenance") return { expireSubscriptions: async () => {} };
        if (name === "@/lib/teacher-entitlements") return { hasActiveProSubscription: async () => options.pro !== false };
        if (name.startsWith("@/lib/")) return load("src/lib/" + name.slice(6) + ".ts");
        throw new Error("Unexpected import " + name);
      },
    });
    return output;
  };
  const route = load("src/app/api/dashboard/" + role + "/reports/route.ts");
  return { queries, get: (query = "") => route.GET(new Request("https://app.test/api/dashboard/" + role + "/reports" + query)) as Promise<Response> };
}

export type ElementNode = { type: any; props: Record<string, any> };
export function textOf(value: any): string {
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) return textOf(value.props.children);
  return value == null || typeof value === "boolean" ? "" : String(value);
}
export function nodesOf(value: any, predicate: (node: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(value)) return value.flatMap((child) => nodesOf(child, predicate));
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  return [...(predicate(value) ? [value] : []), ...nodesOf(value.props.children, predicate)];
}
export function reportPayload(overrides: Record<string, any> = {}) {
  return { success: true, reports: [], totalReports: 0, totalViolations: 0, page: 1, pageSize: 20, pageCount: 1, types: [],
    filters: { search: "", type: "" }, ...overrides };
}
export function reportCard(overrides: Record<string, any> = {}) {
  return { id: "attempt-1", attemptNumber: 1, quizStatus: "completed", createdAt: NOW.toISOString(), startTime: NOW.toISOString(), endTime: NOW.toISOString(),
    isCompleted: true, score: 80, integrityInvalidated: false, quiz: { id: 7, title: "Fixture Quiz" },
    student: { id: "student-1", fullName: "Fixture Student" }, violationCount: 0, violations: [],
    aiVerdict: "clean", cheatingProbability: 0, analysisCurrent: true,
    aiAnalysis: { totalViolations: 0, aiExplanation: "No recorded events", analyzedAt: NOW.toISOString() }, ...overrides };
}
type Reply = { ok: boolean; status?: number; body?: any } | Error | Promise<{ ok: boolean; status?: number; body?: any }>;
export function reportsPage(role: "student" | "teacher", replies: Reply[]) {
  const hooks: any[] = [], effects: Array<() => void | (() => void)> = [], cleanups: Array<() => void> = [];
  const intervals = new Map<number, () => void>(), timeouts = new Map<number, () => void>();
  const listeners = new Map<string, Set<() => void>>();
  let index = 0, collect = true, nextTimer = 1, requestCount = 0;
  const requests: { url: string; signal?: AbortSignal; cache?: string }[] = [];
  const react = {
    createContext: (value: any) => ({ value }),
    useContext: (context: any) => context.value,
    useState: (initial: any) => { const i = index++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], (next: any) => { hooks[i] = typeof next === "function" ? next(hooks[i]) : next; }]; },
    useRef: (initial: any) => { const i = index++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]; },
    useCallback: (callback: any) => { index++; return callback; },
    useEffect: (callback: any) => { index++; if (collect) effects.push(callback); },
  };
  const lifecycle = loadUserLifecycleModule(react);
  const channel = lifecycle.createUserSessionLifecycle();
  lifecycle.UserSessionLifecycleContext.value = channel;
  const window = {
    setTimeout: (callback: () => void) => { const id = nextTimer++; timeouts.set(id, callback); return id; },
    clearTimeout: (id: number) => { timeouts.delete(id); },
    setInterval: (callback: () => void) => { const id = nextTimer++; intervals.set(id, callback); return id; },
    clearInterval: (id: number) => { intervals.delete(id); },
    addEventListener: (name: string, callback: () => void) => { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); },
    removeEventListener: (name: string, callback: () => void) => { listeners.get(name)?.delete(callback); },
  };
  const document = { visibilityState: "visible", addEventListener: window.addEventListener, removeEventListener: window.removeEventListener };
  const modules = new Map<string, any>();
  const jsx = (type: any, props: any) => typeof type === "function" ? type(props) : ({ type, props });
  const load = (file: string): any => {
    if (modules.has(file)) return modules.get(file);
    const output = {}; modules.set(file, output);
    vm.runInNewContext(compiled(file), {
      exports: output, Date, URL, URLSearchParams, AbortController, window, document, console,
      require: (name: string): any => {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "lucide-react") return {};
        if (name === "@/components/user-session-lifecycle") return lifecycle;
        if (name === "@/components/ai-reports") return load("src/components/ai-reports.tsx");
        throw new Error("Unexpected UI import " + name);
      },
      fetch: async (url: string, init: any) => {
        requestCount++; requests.push({ url, signal: init.signal, cache: init.cache });
        const next = replies.shift();
        if (!next) throw new Error("Unexpected request " + url);
        const reply = await next; if (reply instanceof Error) throw reply;
        return { ok: reply.ok, status: reply.status ?? (reply.ok ? 200 : 500), json: async () => reply.body ?? {} };
      },
    });
    return output;
  };
  const component = load("src/app/dashboard/" + role + "/reports/content.tsx");
  const render = () => { index = 0; return component.default(); };
  const settle = async () => { await new Promise(setImmediate); };
  const click = async (label: string) => {
    const button = nodesOf(render(), (node) => node.type === "button" && textOf(node) === label)[0];
    if (!button) throw new Error("Missing button " + label);
    button.props.onClick(); await settle();
  };
  return {
    render, requests, settle, click, document, channel,
    requestsCount: () => requestCount, subscriptions: () => 0, intervals: () => intervals.size,
    mount: async () => { render(); collect = false; for (const effect of effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } await settle(); },
    retry: () => click("Retry"),
    poll: async () => { [...intervals.values()].forEach((callback) => callback()); await settle(); },
    focus: async () => { [...(listeners.get("focus") ?? [])].forEach((callback) => callback()); await settle(); },
    timeout: async () => { [...timeouts.values()].forEach((callback) => callback()); await settle(); },
    changeType: async (value: string) => { nodesOf(render(), (node) => node.type === "select")[0].props.onChange({ target: { value } }); await settle(); },
    setSearch: (value: string) => { nodesOf(render(), (node) => node.type === "input")[0].props.onChange({ target: { value } }); },
    search: async () => { nodesOf(render(), (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); await settle(); },
    unmount: () => { cleanups.forEach((cleanup) => cleanup()); },
  };
}
