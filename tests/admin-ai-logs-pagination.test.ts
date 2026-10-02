import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createAiLogsCsv } from "../src/app/dashboard/admin/logs/csv.ts";

type ElementNode = { type: string; props: Record<string, unknown> };

function compile(relativePath: string, jsx = false) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return {
    absolutePath,
    code: ts.transpileModule(fs.readFileSync(absolutePath, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: jsx ? ts.JsxEmit.ReactJSX : undefined,
        esModuleInterop: true,
      },
    }).outputText,
  };
}

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) return textOf((value as ElementNode).props.children);
  return value === null || value === undefined || typeof value === "boolean" ? "" : String(value);
}

function nodesOf(value: unknown, predicate: (node: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(value)) return value.flatMap((child) => nodesOf(child, predicate));
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as ElementNode;
  return [...(predicate(node) ? [node] : []), ...nodesOf(node.props.children, predicate)];
}

function apiFixture(count: number) {
  const { absolutePath, code } = compile("src/app/api/dashboard/admin/logs/route.ts");
  const timestamp = new Date("2026-09-26T12:00:00.000Z");
  const records = Array.from({ length: count }, (_, index) => ({
    id: BigInt(index + 1),
    timestamp,
    violationType: "tab_switch",
    confidenceScore: 90,
    studentQuiz: { student: { fullName: `Student ${index + 1}` }, quiz: { title: "Test Quiz" } },
  }));
  const queries: Array<{ skip: number; take: number; orderBy: unknown }> = [];
  const prisma = {
    violation: {
      count: async () => records.length,
      findMany: async (query: { skip: number; take: number; orderBy: unknown }) => {
        queries.push(query);
        return [...records].sort((left, right) => Number(right.id - left.id)).slice(query.skip, query.skip + query.take);
      },
    },
  };
  const route: { GET?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext(code, {
    exports: route,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: unknown, options: { status?: number } = {}) =>
        new Response(JSON.stringify(body), { status: options.status ?? 200 }) } };
      if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
      if (name === "@/lib/auth") return { getAdminSession: async () => ({ role: "admin" }) };
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console,
    URL,
  }, { filename: absolutePath });
  return { get: route.GET!, queries };
}

test("AI Logs API reports the full count and distinct stable pages", async () => {
  const setup = apiFixture(58);
  const responses = await Promise.all([1, 2, 3].map(async (page) => {
    const response = await setup.get(new Request(`http://localhost/api/dashboard/admin/logs?page=${page}`));
    assert.equal(response.status, 200);
    return response.json();
  }));

  assert.deepEqual(responses.map((body) => [body.total, body.page, body.pageSize, body.logs.length]), [
    [58, 1, 25, 25], [58, 2, 25, 25], [58, 3, 25, 8],
  ]);
  assert.deepEqual(responses.flatMap((body) => body.logs.map((log: { id: string }) => log.id)),
    Array.from({ length: 58 }, (_, index) => String(58 - index)));
  assert.deepEqual(setup.queries.map((query) => [query.skip, query.take]), [[0, 25], [25, 25], [50, 25]]);
  for (const query of setup.queries) {
    assert.deepEqual(JSON.parse(JSON.stringify(query.orderBy)), [{ timestamp: "desc" }, { id: "desc" }]);
  }
});

test("AI Logs API clamps out-of-range pages and handles empty and invalid requests", async () => {
  const setup = apiFixture(2);
  const outOfRange = await setup.get(new Request("http://localhost/api/dashboard/admin/logs?page=999"));
  const outOfRangeBody = await outOfRange.json();
  assert.equal(outOfRangeBody.page, 1);
  assert.equal(outOfRangeBody.total, 2);
  assert.equal(outOfRangeBody.logs.length, 2);
  assert.equal(setup.queries[0].skip, 0);

  const invalid = await setup.get(new Request("http://localhost/api/dashboard/admin/logs?page=0"));
  assert.equal(invalid.status, 400);
  assert.equal(setup.queries.length, 1);

  const empty = apiFixture(0);
  const emptyBody = await (await empty.get(new Request("http://localhost/api/dashboard/admin/logs?page=4"))).json();
  assert.deepEqual([emptyBody.total, emptyBody.page, emptyBody.pageSize, emptyBody.logs.length], [0, 1, 25, 0]);
});

function uiFixture() {
  const { absolutePath, code } = compile("src/app/dashboard/admin/logs/content.tsx", true);
  const allLogs = Array.from({ length: 58 }, (_, index) => ({
    id: String(index + 1),
    timestamp: "Today",
    event: `Event ${index + 1}`,
    severity: "Low",
    severityClass: "",
    rowBg: "",
    confidence: "90%",
    student: index === 25 ? "=1+2" : `Student ${index + 1}`,
    quiz: "Test Quiz",
  }));
  const requestedPages: number[] = [];
  const states: unknown[] = [];
  let stateIndex = 0;
  let effectStarted = false;
  let exportedBlob: Blob | undefined;
  let downloadName = "";
  const react = {
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next: unknown) => {
        states[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(states[index]) : next;
      }];
    },
    useEffect: (callback: () => void) => {
      if (!effectStarted) {
        effectStarted = true;
        callback();
      }
    },
  };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const component: { default?: () => ElementNode } = {};
  vm.runInNewContext(code, {
    exports: component,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "lucide-react") return {};
      if (name === "./csv") return { createAiLogsCsv };
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url: string) => {
      const page = Number(new URL(url, "http://localhost").searchParams.get("page"));
      requestedPages.push(page);
      return { ok: true, json: async () => ({
        success: true,
        logs: allLogs.slice((page - 1) * 25, page * 25),
        total: allLogs.length,
        page,
        pageSize: 25,
      }) };
    },
    URL: {
      createObjectURL: (blob: Blob) => { exportedBlob = blob; return "blob:qa"; },
      revokeObjectURL() {},
    },
    Blob,
    document: { createElement: () => ({ href: "", download: "", click() { downloadName = this.download; } }) },
    console,
  }, { filename: absolutePath });
  const render = () => { stateIndex = 0; return component.default!(); };
  const button = (label: string) => {
    const found = nodesOf(render(), (node) => node.type === "button" && textOf(node) === label)[0];
    assert.ok(found, `${label} button exists`);
    return found;
  };
  return { render, button, requestedPages, exported: () => ({ blob: exportedBlob, name: downloadName }) };
}

test("AI Logs UI pages through history and exports only its labeled current page safely", async () => {
  const setup = uiFixture();
  setup.render();
  await new Promise(setImmediate);
  assert.match(textOf(setup.render()), /58 violation events recorded/);
  assert.match(textOf(setup.render()), /Showing 1–25 of 58/);
  assert.equal(setup.button("Previous").props.disabled, true);

  await (setup.button("Next").props.onClick as () => Promise<void>)();
  assert.match(textOf(setup.render()), /Showing 26–50 of 58/);
  assert.match(textOf(setup.render()), /Page 2 of 3/);
  assert.equal(nodesOf(setup.render(), (node) => node.type === "tr").length, 26);
  assert.match(textOf(setup.render()), /Event 26/);
  assert.doesNotMatch(textOf(setup.render()), /Event 1\b/);

  (setup.button("Export This Page CSV").props.onClick as () => void)();
  const exported = setup.exported();
  assert.match(exported.name, /ai-violation-logs-page-2-/);
  assert.ok(exported.blob);
  const csv = await exported.blob.text();
  assert.equal(csv.split("\r\n").length, 26);
  assert.match(csv, /"Event 26"/);
  assert.doesNotMatch(csv, /"Event 1"/);
  assert.match(csv, /"\t=1\+2"/);

  await (setup.button("Next").props.onClick as () => Promise<void>)();
  assert.match(textOf(setup.render()), /Showing 51–58 of 58/);
  assert.equal(setup.button("Next").props.disabled, true);
  await (setup.button("Previous").props.onClick as () => Promise<void>)();
  assert.match(textOf(setup.render()), /Showing 26–50 of 58/);
  assert.deepEqual(setup.requestedPages, [1, 2, 3, 2]);
});
