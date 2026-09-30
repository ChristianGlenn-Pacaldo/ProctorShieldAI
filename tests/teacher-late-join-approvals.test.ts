import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type ElementNode = { type: string; props: Record<string, unknown> };
type PendingApproval = { studentQuizId: string; studentName: string; quizTitle: string; quizId: number };

const componentPath = path.resolve(process.cwd(), "src/app/dashboard/teacher/quizzes/content.tsx");
const compiled = ts.transpileModule(fs.readFileSync(componentPath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;
const quizzesRoute = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/quizzes/route.ts"), "utf8");
const approvalRoute = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/quizzes/approve/route.ts"), "utf8");

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

function fixture(server: { pending: PendingApproval[] }, options: { failAction?: boolean; failRefresh?: boolean } = {}) {
  const states: unknown[] = [];
  const effects: Array<() => void> = [];
  const requests: Array<{ url: string; method: string; body?: { studentQuizId: string; action: string } }> = [];
  let stateIndex = 0;
  let collectEffects = true;
  let quizFetches = 0;
  const react = {
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next: unknown) => {
        states[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(states[index]) : next;
      }];
    },
    useEffect: (callback: () => void) => { if (collectEffects) effects.push(callback); },
    useRef: () => ({ current: null }),
  };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const component: { default?: (props: Record<string, unknown>) => ElementNode } = {};
  vm.runInNewContext(compiled, {
    exports: component,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "next/navigation") return { useRouter: () => ({ push() {} }) };
      if (name === "react-dom") return { createPortal: () => null };
      if (name === "@/lib/subscription-rules") return { FREE_STUDENT_LIMIT_PER_QUIZ: 5, PRO_STUDENT_LIMIT_PER_QUIZ: 100 };
      if (name === "next/link") return "link";
      if (name === "@/components/teacher/proctorshield-quiz-editor") return { __esModule: true, default: "editor" };
      if (name === "@/components/teacher/proctorshield-create-hub") return { __esModule: true, default: "hub" };
      if (name === "lucide-react") return {};
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url: string, request?: { method?: string; body?: string }) => {
      const method = request?.method || "GET";
      const body = request?.body ? JSON.parse(request.body) as { studentQuizId: string; action: string } : undefined;
      requests.push({ url, method, body });
      if (url === "/api/billing/status") {
        return { ok: true, json: async () => ({ isSubscribed: false, manualQuizCount: 0, manualQuizLimit: 5 }) };
      }
      if (url === "/api/quizzes" && method === "GET") {
        quizFetches++;
        if (options.failRefresh && quizFetches > 1) return { ok: false, json: async () => ({ error: "Refresh failed" }) };
        return { ok: true, json: async () => ({ success: true, quizzes: [], pendingRetakes: [], pendingApprovals: [...server.pending] }) };
      }
      assert.equal(url, "/api/quizzes/approve");
      assert.equal(method, "POST");
      if (options.failAction) return { ok: false, json: async () => ({ error: "Approval failed" }) };
      server.pending = server.pending.filter((entry) => entry.studentQuizId !== body?.studentQuizId);
      return { ok: true, json: async () => ({ success: true }) };
    },
    window: { location: { search: "" } },
    URLSearchParams,
    console: { error() {} },
  }, { filename: componentPath });

  const render = () => { stateIndex = 0; collectEffects = false; return component.default!({ isSubscribed: false }); };
  stateIndex = 0;
  component.default!({ isSubscribed: false });
  const mount = async () => {
    for (const effect of effects) effect();
    await new Promise(setImmediate);
  };
  const button = (label: string) => nodesOf(render(), (node) => node.type === "button" && textOf(node) === label)[0];
  return { render, mount, button, requests, quizFetches: () => quizFetches };
}

const pending = (): PendingApproval => ({
  studentQuizId: "attempt-1", studentName: "Late Student", quizTitle: "Current Exam", quizId: 46,
});

test("Teacher quiz API returns persisted, owner-scoped pending approvals", () => {
  assert.match(quizzesRoute, /quizStatus:\s*"pending_approval",\s*quiz:\s*\{ teacherId: session\.userId \}/);
  assert.match(quizzesRoute, /pendingApprovals:\s*pendingApprovals\.map/);
  assert.match(approvalRoute, /studentQuiz\.quiz\.teacherId !== session\.userId/);
});

test("fresh My Quizzes load shows a missed late-join request for a Free Teacher", async () => {
  const server = { pending: [pending()] };
  const setup = fixture(server);
  await setup.mount();
  assert.match(textOf(setup.render()), /Pending Late-Join Requests \(1\)/);
  assert.match(textOf(setup.render()), /Late Student/);
  assert.ok(setup.button("Approve"));
  assert.ok(setup.button("Reject"));
  assert.equal(setup.requests.filter((request) => request.url === "/api/quizzes/approve").length, 0);
  const afterReload = fixture(server);
  await afterReload.mount();
  assert.match(textOf(afterReload.render()), /Late Student/);
});

for (const [label, action] of [["Approve", "accept"], ["Reject", "reject"]] as const) {
  test(`${label} removes the pending request only after success and authoritative refetch`, async () => {
    const server = { pending: [pending()] };
    const setup = fixture(server);
    await setup.mount();
    await (setup.button(label).props.onClick as () => Promise<void>)();
    assert.equal(server.pending.length, 0);
    assert.equal(setup.quizFetches(), 2);
    assert.deepEqual(setup.requests.filter((request) => request.url === "/api/quizzes/approve").map((request) => ({ ...request.body })),
      [{ studentQuizId: "attempt-1", action }]);
    assert.doesNotMatch(textOf(setup.render()), /Pending Late-Join Requests/);
  });

  test(`${label} failure retains the request and shows an error`, async () => {
    const server = { pending: [pending()] };
    const setup = fixture(server, { failAction: true });
    await setup.mount();
    await (setup.button(label).props.onClick as () => Promise<void>)();
    assert.equal(server.pending.length, 1);
    assert.equal(setup.quizFetches(), 1);
    assert.match(textOf(setup.render()), /Late Student/);
    assert.match(textOf(nodesOf(setup.render(), (node) => node.props.role === "alert")[0]), /Approval failed/);
  });
}

test("successful decision is not removed locally when authoritative refetch fails", async () => {
  const setup = fixture({ pending: [pending()] }, { failRefresh: true });
  await setup.mount();
  await (setup.button("Approve").props.onClick as () => Promise<void>)();
  assert.match(textOf(setup.render()), /Late Student/);
  assert.match(textOf(nodesOf(setup.render(), (node) => node.props.role === "alert")[0]), /could not be refreshed/);
});
