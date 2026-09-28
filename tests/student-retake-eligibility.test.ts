import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as eligibility from "../src/lib/retake-eligibility.ts";

function compile(file: string) {
  return ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
}

function attempt(id: string, quizId: number, attemptNumber: number, quizStatus = "completed", endTime: string | null = "2026-09-01T12:00:00Z", allowRetake = true) {
  return { id, studentId: "student-1", quizId, attemptNumber, quizStatus, endTime, attemptMode: "proctored", createdAt: "2026-09-01T10:00:00Z",
    quiz: { id: quizId, allowRetake, title: id, teacherId: "teacher-1" }, student: { fullName: "Student" }, _count: { violations: 0 } };
}

// Deliberately not ordered by attempt number or completion: latest means highest attemptNumber.
const attempts = [
  attempt("latest-completed", 1, 2),
  attempt("older-completed", 1, 1),
  attempt("unfinished", 2, 1, "in_progress", null),
  attempt("pending", 3, 1, "pending_retake"),
  attempt("approved-history", 4, 1),
  attempt("reopened", 4, 2, "enrolled", null),
  attempt("disabled", 5, 1, "completed", "2026-09-01T12:00:00Z", false),
  attempt("missing-end", 6, 1, "completed", null),
  attempt("older-before-unfinished", 2, 0),
  { ...attempt("arena", 7, 1), attemptMode: "arena" },
];
type Attempt = typeof attempts[number];
type Result = Attempt & { canRequestRetake: boolean };

function loadApi(file: string, options: { rows?: Attempt[]; target?: Attempt; role?: string | null; owner?: string; changed?: boolean } = {}) {
  const rows = options.rows ?? attempts;
  const writes: unknown[] = [];
  const queries: Array<{ where: { studentId: string } }> = [];
  const route: { GET: () => Promise<Response>; POST: (req: Request) => Promise<Response> } = {} as never;
  vm.runInNewContext(compile(file), {
    exports: route,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
      if (name === "@/lib/auth") return { getSession: async () => options.role === null ? null : ({ role: options.role ?? "student", userId: options.owner ?? "student-1" }) };
      if (name === "@/lib/retake-eligibility") return eligibility;
      if (name === "@/lib/quiz-availability") return { UNAVAILABLE_QUIZ_STATUSES: ["deleted"] };
      if (name === "@/lib/pusher") return { pusherServer: { trigger: async () => {} } };
      if (name === "@/lib/prisma") return { __esModule: true, default: {
        studentQuiz: {
          findMany: async (query: typeof queries[number]) => { queries.push(query); return rows; },
          findUnique: async () => options.target,
          findFirst: async (query: { where: { studentId: string; quizId: number }; orderBy: { attemptNumber: string } }) => {
            assert.equal(query.where.studentId, "student-1");
            assert.equal(query.orderBy.attemptNumber, "desc");
            return rows.filter((row) => row.quizId === query.where.quizId).sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
          },
          updateMany: async (query: unknown) => { writes.push(query); return { count: options.changed ? 0 : 1 }; },
        }, notification: { create: async () => {} },
      } };
      return {};
    }, console,
  });
  return { route, writes, queries };
}

type Node = { type: string | ((props: Record<string, unknown>) => Node); props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "props" in value) return text((value as Node).props.children);
  return value == null || typeof value === "boolean" ? "" : String(value);
}
function modal(initial: Record<string, unknown>, respond: () => Promise<Response> = async () => Response.json({ success: true })) {
  let state: unknown[] = [];
  let index = 0;
  let previousKey: unknown;
  const requests: Array<{ url: string; body: string }> = [];
  const timers: Array<() => void> = [];
  let reloads = 0;
  const component: { default: (props: Record<string, unknown>) => Node | null } = {} as never;
  const jsx = (type: Node["type"], props: Node["props"], key: unknown) => ({ type, props: { ...props, key } });
  vm.runInNewContext(compile("src/components/student/ResultModal.tsx"), {
    exports: component,
    require: (name: string) => {
      if (name === "react") return { useState: (initialValue: unknown) => {
        const slot = index++;
        if (!(slot in state)) state[slot] = initialValue;
        return [state[slot], (value: unknown) => { state[slot] = value; }];
      } };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      return {};
    },
    fetch: async (url: string, request: { body: string }) => { requests.push({ url, body: request.body }); return respond(); },
    setTimeout: (callback: () => void) => { timers.push(callback); },
    window: { location: { reload: () => { reloads++; } } },
  });
  let result = initial;
  const render = (open = true) => {
    const wrapper = component.default({ isOpen: open, result, onClose() {} });
    if (!wrapper) { state = []; previousKey = undefined; return null; }
    if (wrapper.props.key !== previousKey) state = [];
    previousKey = wrapper.props.key;
    index = 0;
    return (wrapper.type as (props: Record<string, unknown>) => Node)(wrapper.props);
  };
  return { render, requests, timers, reloads: () => reloads, select: (next: Record<string, unknown>) => { result = next; } };
}
function requestButton(tree: unknown) { return nodes(tree).find((node) => node.type === "button" && text(node) === "Request Retake"); }

for (const [label, file, field] of [
  ["Results", "src/app/api/dashboard/student/results/route.ts", "results"],
  ["My Quizzes", "src/app/api/quizzes/route.ts", "quizzes"],
]) {
  test(`${label} payload and modal expose retake only for the eligible latest completed attempt`, async () => {
    const api = loadApi(file);
    const response = await api.route.GET();
    assert.equal(response.status, 200);
    assert.equal(api.queries[0].where.studentId, "student-1");
    const rows: Result[] = (await response.json())[field];
    assert.equal(rows.length, attempts.length);
    for (const row of rows) {
      assert.equal(row.canRequestRetake, ["latest-completed", "arena"].includes(row.id), row.id);
      const tree = modal(row).render();
      assert.equal(!!requestButton(tree), row.id === "latest-completed", row.id);
      assert.equal(text(tree).includes("Retake Pending..."), row.id === "pending", row.id);
    }
  });
}

test("missing server eligibility fails closed even when allowRetake is enabled", () => {
  assert.equal(requestButton(modal(attempts[0]).render()), undefined);
});

test("retake POST retains every eligibility rejection, ownership, and conditional update guard", async () => {
  const expected: Record<string, [number, string]> = {
    "older-completed": [409, "Only the latest attempt can be retaken"],
    "unfinished": [409, "Only a completed attempt can be retaken"],
    "pending": [400, "Retake already requested"],
    "approved-history": [409, "Only the latest attempt can be retaken"],
    "reopened": [409, "Only a completed attempt can be retaken"],
    "disabled": [403, "Retakes are not enabled for this quiz"],
    "missing-end": [409, "Only a completed attempt can be retaken"],
    "older-before-unfinished": [409, "Only the latest attempt can be retaken"],
  };
  const request = () => new Request("http://localhost/api/quizzes/retake", { method: "POST", body: JSON.stringify({ studentQuizId: "target" }) });
  for (const target of attempts) {
    const api = loadApi("src/app/api/quizzes/retake/route.ts", { target });
    const response = await api.route.POST(request());
    assert.equal(response.status, expected[target.id]?.[0] ?? 200, target.id);
    if (expected[target.id]) {
      assert.equal((await response.json()).error, expected[target.id][1]);
      assert.equal(api.writes.length, 0);
    } else {
      assert.equal(api.writes.length, 1);
      assert.deepEqual(JSON.parse(JSON.stringify(api.writes[0])), { where: { id: "target", quizStatus: "completed", endTime: { not: null } }, data: { quizStatus: "pending_retake" } });
    }
  }
  for (const options of [{ role: null }, { role: "teacher" }, { owner: "someone-else" }]) {
    const api = loadApi("src/app/api/quizzes/retake/route.ts", { target: attempts[0], ...options });
    assert.equal((await api.route.POST(request())).status, "owner" in options ? 404 : 401);
    assert.equal(api.writes.length, 0);
  }
  const changed = loadApi("src/app/api/quizzes/retake/route.ts", { target: attempts[0], changed: true });
  const response = await changed.route.POST(request());
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "Retake request state changed; refresh and try again");
});

test("modal shows returned API errors, permits retry, and clears feedback across attempts and reopening", async () => {
  for (const [status, error] of [[409, "Only the latest attempt can be retaken"], [403, "Retakes are not enabled for this quiz"], [400, "Retake already requested"]] as const) {
    const fixture = modal({ ...attempts[0], canRequestRetake: true }, async () => Response.json({ error }, { status }));
    await (requestButton(fixture.render())!.props.onClick as () => Promise<void>)();
    const tree = fixture.render();
    assert.equal(text(nodes(tree).find((node) => node.props.role === "alert")), error);
    assert.equal(requestButton(tree)!.props.disabled, false);
    assert.equal(fixture.requests[0].url, "/api/quizzes/retake");
    assert.deepEqual(JSON.parse(fixture.requests[0].body), { studentQuizId: "latest-completed" });
    fixture.render(false);
    assert.equal(nodes(fixture.render()).some((node) => node.props.role === "alert"), false);
    fixture.select({ ...attempts[1], canRequestRetake: false });
    assert.equal(requestButton(fixture.render()), undefined);
    assert.equal(nodes(fixture.render()).some((node) => node.props.role === "alert"), false);
  }
});

test("modal gives readable feedback for network and non-JSON failures", async () => {
  for (const respond of [async () => { throw new Error("offline"); }, async () => new Response("unavailable", { status: 502 })]) {
    const fixture = modal({ ...attempts[0], canRequestRetake: true }, respond);
    await (requestButton(fixture.render())!.props.onClick as () => Promise<void>)();
    const tree = fixture.render();
    assert.match(text(nodes(tree).find((node) => node.props.role === "alert")), /Could not request a retake/);
    assert.equal(requestButton(tree)!.props.disabled, false);
  }
});

test("successful retake shows requesting and requested states and retains reload behavior", async () => {
  let resolve!: (response: Response) => void;
  const fixture = modal({ ...attempts[0], canRequestRetake: true }, () => new Promise((done) => { resolve = done; }));
  const pending = (requestButton(fixture.render())!.props.onClick as () => Promise<void>)();
  assert.equal(nodes(fixture.render()).find((node) => text(node) === "Requesting...")?.props.disabled, true);
  resolve(Response.json({ success: true }));
  await pending;
  assert.equal(nodes(fixture.render()).find((node) => text(node) === "Requested ✓")?.props.disabled, true);
  assert.equal(fixture.timers.length, 1);
  fixture.timers[0]();
  assert.equal(fixture.reloads(), 1);
});
