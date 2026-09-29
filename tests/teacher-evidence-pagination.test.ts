import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

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

function apiFixture(teacherCount: number) {
  const { absolutePath, code } = compile("src/app/api/dashboard/teacher/evidence/route.ts");
  const timestamp = new Date("2026-09-26T12:00:00.000Z");
  const records = Array.from({ length: teacherCount + 4 }, (_, index) => ({
    id: BigInt(index + 1),
    owner: index < teacherCount ? "teacher-a" : "teacher-b",
    timestamp,
    violationType: "tab_switch",
    screenshotPath: index === 1 ? "data:image/png;base64,QA" : null,
    durationSeconds: index === 0 ? 4 : null,
    evidenceFiles: index === 0 ? [{ fileType: "video/webm" }] : [],
    studentQuiz: { student: { fullName: `Student ${index + 1}` }, quiz: { title: "Test Quiz" } },
  }));
  const queries: Array<{ where: { studentQuiz: { quiz: { teacherId: string } } }; skip: number; take: number; orderBy: unknown }> = [];
  const countFilters: string[] = [];
  const prisma = {
    violation: {
      count: async (query: { where: { studentQuiz: { quiz: { teacherId: string } } } }) => {
        const teacherId = query.where.studentQuiz.quiz.teacherId;
        countFilters.push(teacherId);
        return records.filter((record) => record.owner === teacherId).length;
      },
      findMany: async (query: { where: { studentQuiz: { quiz: { teacherId: string } } }; skip: number; take: number; orderBy: unknown }) => {
        queries.push(query);
        return records.filter((record) => record.owner === query.where.studentQuiz.quiz.teacherId)
          .sort((left, right) => Number(right.id - left.id))
          .slice(query.skip, query.skip + query.take);
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
      if (name === "@/lib/auth") return { getSession: async () => ({ role: "teacher", userId: "teacher-a" }) };
      if (name === "@/lib/maintenance") return { expireSubscriptions: async () => {} };
      if (name === "@/lib/evidence-retention") return { EvidenceWithinRetentionError: class extends Error {}, requestTeacherEvidencePurge: async () => ({}) };
      if (name === "@/lib/teacher-entitlements") return { hasActiveProSubscription: async () => true };
      if (name === "@/lib/proctoring-detection") return { getViolationLabel: () => "Tab switch" };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console,
    URL,
  }, { filename: absolutePath });
  return { get: route.GET!, queries, countFilters };
}

test("Teacher Evidence API reaches records beyond 200 with accurate teacher-scoped totals and stable pages", async () => {
  const setup = apiFixture(230);
  const responses = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
    const response = await setup.get(new Request(`http://localhost/api/dashboard/teacher/evidence?page=${index + 1}`));
    assert.equal(response.status, 200);
    return response.json();
  }));
  assert.deepEqual(responses.map((body) => [body.total, body.page, body.pageSize, body.evidence.length]), [
    ...Array.from({ length: 9 }, (_, index) => [230, index + 1, 25, 25]),
    [230, 10, 25, 5],
  ]);
  assert.deepEqual(responses.flatMap((body) => body.evidence.map((item: { id: string }) => item.id)),
    Array.from({ length: 230 }, (_, index) => String(230 - index)));
  const oldestEvidence = responses[9].evidence.at(-1);
  assert.equal(oldestEvidence.name, "Student 1");
  assert.equal(oldestEvidence.quizTitle, "Test Quiz");
  assert.equal(oldestEvidence.timestamp, "2026-09-26T12:00:00.000Z");
  assert.equal(oldestEvidence.screenshotPath, "/api/evidence/1");
  assert.equal(oldestEvidence.evidenceType, "video/webm");
  assert.equal(oldestEvidence.durationSeconds, 4);
  assert.equal(responses[9].evidence.at(-2).screenshotPath, "data:image/png;base64,QA");
  assert.ok(setup.countFilters.every((teacherId) => teacherId === "teacher-a"));
  for (const query of setup.queries) {
    assert.equal(query.where.studentQuiz.quiz.teacherId, "teacher-a");
    assert.equal(query.take, 25);
    assert.deepEqual(JSON.parse(JSON.stringify(query.orderBy)), [{ timestamp: "desc" }, { id: "desc" }]);
  }
  assert.deepEqual(setup.queries.map((query) => query.skip), Array.from({ length: 10 }, (_, index) => index * 25));
});

test("Teacher Evidence API validates and clamps pages while retaining the empty state", async () => {
  const setup = apiFixture(2);
  const invalid = await setup.get(new Request("http://localhost/api/dashboard/teacher/evidence?page=0"));
  assert.equal(invalid.status, 400);
  assert.equal(setup.queries.length, 0);
  const last = await (await setup.get(new Request("http://localhost/api/dashboard/teacher/evidence?page=999"))).json();
  assert.deepEqual([last.total, last.page, last.pageSize, last.evidence.length], [2, 1, 25, 2]);
  const empty = apiFixture(0);
  const emptyBody = await (await empty.get(new Request("http://localhost/api/dashboard/teacher/evidence?page=8"))).json();
  assert.deepEqual([emptyBody.total, emptyBody.page, emptyBody.pageSize, emptyBody.evidence.length], [0, 1, 25, 0]);
});

function uiFixture(total: number, initialUrl = "http://localhost/dashboard/teacher/evidence") {
  const { absolutePath, code } = compile("src/app/dashboard/teacher/evidence/content.tsx", true);
  const records = Array.from({ length: total }, (_, index) => ({
    id: String(index + 1),
    name: `Student ${index + 1}`,
    quizTitle: "Test Quiz",
    event: "Tab switch",
    violationType: "tab_switch",
    timestamp: "2026-09-26T12:00:00.000Z",
    bg: "",
    btnClass: "",
    screenshotPath: null,
    evidenceType: null,
    durationSeconds: null,
  }));
  const hooks: unknown[] = [];
  const effects: Array<() => void> = [];
  const timers: Array<() => void> = [];
  const requestedPages: number[] = [];
  let hookIndex = 0;
  let collectingEffects = true;
  let failingPage: number | null = null;
  const location = { href: initialUrl };
  const react = {
    useState: (initial: unknown) => {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (next: unknown) => {
        hooks[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(hooks[index]) : next;
      }];
    },
    useRef: (initial: unknown) => {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useCallback: (callback: unknown) => { hookIndex++; return callback; },
    useEffect: (callback: () => void) => {
      hookIndex++;
      if (collectingEffects) effects.push(callback);
    },
  };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const component: { default?: (props: { teacherId: string }) => ElementNode } = {};
  vm.runInNewContext(code, {
    exports: component,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react-dom") return { createPortal: jsx };
      if (name === "lucide-react") return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url: string) => {
      const requestedPage = Number(new URL(url, "http://localhost").searchParams.get("page"));
      requestedPages.push(requestedPage);
      if (requestedPage === failingPage) return { ok: false, status: 500 };
      return { ok: true, json: async () => ({
        success: true,
        evidence: records.slice((requestedPage - 1) * 25, requestedPage * 25),
        total: records.length,
        page: requestedPage,
        pageSize: 25,
      }) };
    },
    window: {
      location,
      history: { replaceState: (_state: unknown, _unused: string, path: string) => { location.href = new URL(path, location.href).href; } },
      setInterval: (callback: () => void) => { timers.push(callback); return timers.length; },
      clearInterval() {},
    },
    document: { body: { style: {} }, addEventListener() {}, removeEventListener() {} },
    console: { error() {} },
    URL,
  }, { filename: absolutePath });
  const render = () => { hookIndex = 0; return component.default!({ teacherId: "teacher-a" }); };
  const button = (label: string) => {
    const found = nodesOf(render(), (node) => node.type === "button" && textOf(node) === label)[0];
    assert.ok(found, `${label} button exists`);
    return found;
  };
  const click = async (label: string) => {
    (button(label).props.onClick as () => void)();
    await new Promise(setImmediate);
  };
  return {
    render,
    button,
    click,
    mount: async () => {
      render();
      collectingEffects = false;
      effects.forEach((effect) => effect());
      await new Promise(setImmediate);
    },
    poll: async () => { timers[0](); await new Promise(setImmediate); },
    setFailingPage: (value: number | null) => { failingPage = value; },
    requestedPages,
    timers,
    location,
  };
}

test("Evidence Replay navigates distinct pages, retains its current page on polling, and retries failed navigation", async () => {
  const setup = uiFixture(58);
  await setup.mount();
  assert.match(textOf(setup.render()), /Showing 1–25 of 58/);
  assert.equal(setup.button("Previous").props.disabled, true);
  await setup.click("Next");
  assert.match(textOf(setup.render()), /Showing 26–50 of 58/);
  assert.match(textOf(setup.render()), /Student 26/);
  assert.doesNotMatch(textOf(setup.render()), /Student 1\b/);
  await setup.poll();
  assert.deepEqual(setup.requestedPages, [1, 2, 2]);
  assert.equal(setup.timers.length, 1);
  setup.setFailingPage(3);
  await setup.click("Next");
  assert.match(textOf(setup.render()), /Could not load Evidence Logs/);
  assert.match(textOf(setup.render()), /Showing 26–50 of 58/);
  setup.setFailingPage(null);
  await setup.click("Retry");
  assert.match(textOf(setup.render()), /Showing 51–58 of 58/);
  assert.equal(setup.button("Next").props.disabled, true);
  assert.deepEqual(setup.requestedPages, [1, 2, 2, 3, 3]);
  await setup.click("Previous");
  assert.match(textOf(setup.render()), /Showing 26–50 of 58/);
});

test("Evidence Replay keeps the normal empty state after a successful empty response", async () => {
  const setup = uiFixture(0);
  await setup.mount();
  assert.match(textOf(setup.render()), /No proctoring violations recorded/);
  assert.match(textOf(setup.render()), /Showing 0–0 of 0/);
  assert.equal(setup.button("Previous").props.disabled, true);
  assert.equal(setup.button("Next").props.disabled, true);
});

test("Evidence Replay restores the selected page after reload", async () => {
  const first = uiFixture(58);
  await first.mount();
  await first.click("Next");
  assert.match(first.location.href, /\?page=2$/);
  const reloaded = uiFixture(58, first.location.href);
  await reloaded.mount();
  assert.deepEqual(reloaded.requestedPages, [2]);
  assert.match(textOf(reloaded.render()), /Showing 26–50 of 58/);
  await reloaded.poll();
  assert.deepEqual(reloaded.requestedPages, [2, 2]);
});
