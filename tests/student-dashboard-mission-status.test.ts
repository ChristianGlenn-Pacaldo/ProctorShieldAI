import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type ElementNode = { type: string; props: Record<string, unknown> };

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) return textOf((value as ElementNode).props.children);
  return value == null || typeof value === "boolean" ? "" : String(value);
}

function nodesOf(value: unknown, predicate: (node: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(value)) return value.flatMap((child) => nodesOf(child, predicate));
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as ElementNode;
  return [...(predicate(node) ? [node] : []), ...nodesOf(node.props.children, predicate)];
}

function enrollment(id: string, status: string, quizStatus = "in_progress", extra: Record<string, unknown> = {}) {
  return {
    id,
    quizStatus: status,
    startTime: status === "in_progress" ? "2026-09-01T12:00:00.000Z" : null,
    endTime: status === "completed" || status === "pending_retake" ? "2026-09-01T13:00:00.000Z" : null,
    score: status === "completed" ? 80 : null,
    aiVerdict: status === "completed" ? "clean" : null,
    cheatingProbability: null,
    quiz: { id: Number(id), title: `Quiz ${id}`, quizStatus, duration: 30, quizMode: "proctored" },
    ...extra,
  };
}

async function renderDashboard(quizzes: ReturnType<typeof enrollment>[]) {
  const code = ts.transpileModule(fs.readFileSync(path.resolve("src/app/dashboard/student/content.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const state: unknown[] = [];
  const effects: Array<() => void> = [];
  let hookIndex = 0;
  const react = {
    useState: (initial: unknown) => {
      const index = hookIndex++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(state[index]) : next; }];
    },
    useEffect: (callback: () => void) => { hookIndex++; effects.push(callback); },
    useTransition: () => { hookIndex++; return [false, (callback: () => void) => callback()]; },
  };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const component: { default?: () => ElementNode } = {};
  vm.runInNewContext(code, {
    exports: component,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "lucide-react") return {};
      if (name === "next/link") return "link";
      if (name === "next/navigation") return { useRouter: () => ({ push() {} }) };
      if (name === "@/lib/student-gamify") return { playBloop() {}, playSuccessFanfare() {}, playErrorBuzz() {}, isSoundEnabled: () => true, toggleSoundEnabled: () => false };
      if (name === "@/lib/quiz-access-code") return { normalizeQuizAccessCode: (value: string) => value, QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH: 20 };
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url: string) => ({ ok: true, json: async () => url === "/api/quizzes" ? { success: true, quizzes } : { success: true, totalExp: 0, level: 1, currentLevelExp: 0, expToNextLevel: 500, progressPercent: 0, title: "Rookie" } }),
    console: { error() {} },
  });
  const render = () => { hookIndex = 0; return component.default!(); };
  render();
  effects.forEach((effect) => effect());
  await new Promise(setImmediate);
  return render();
}

function mission(tree: ElementNode, id: string) {
  const cards = nodesOf(tree, (node) => node.type === "div" && String(node.props.className).includes("rounded-2xl border-2 border-indigo-500/20"));
  const card = cards.find((node) => nodesOf(node, (child) => child.type === "h3" && textOf(child) === `Quiz ${id}`).length > 0);
  assert.ok(card, `Mission ${id} remains visible`);
  return card;
}

function actionLinks(card: ElementNode) {
  return nodesOf(card, (node) => node.type === "link" && /^\/(quiz|arena)\//.test(String(node.props.href)));
}

test("eligible enrolled and active attempts retain the correct dashboard actions", async () => {
  const tree = await renderDashboard([
    enrollment("1", "enrolled", "active"),
    enrollment("2", "enrolled"),
    enrollment("3", "in_progress"),
    enrollment("4", "enrolled", "ended", { attemptNumber: 2 }),
  ]);
  assert.match(textOf(mission(tree, "1")), /Waiting for Teacher.*Open Lobby/);
  assert.match(textOf(mission(tree, "2")), /Room Open.*Take Quiz/);
  assert.match(textOf(mission(tree, "3")), /In Progress.*Resume Quiz/);
  assert.match(textOf(mission(tree, "4")), /Room Open.*Take Quiz/);
  for (const id of ["1", "2", "3", "4"]) assert.equal(actionLinks(mission(tree, id)).length, 1);
});

test("pending, rejected, completed, and unsupported attempts never claim an open room", async () => {
  const tree = await renderDashboard([
    enrollment("5", "pending_approval"),
    enrollment("6", "rejected"),
    enrollment("7", "pending_retake"),
    enrollment("8", "completed"),
    enrollment("9", "unexpected"),
    enrollment("10", "enrolled", "ended"),
    enrollment("11", "in_progress", "in_progress", { startTime: null }),
    enrollment("12", "submitting"),
  ]);
  const labels: Record<string, string> = {
    "5": "Awaiting Approval", "6": "Entry Rejected", "7": "Retake Pending", "9": "Unavailable",
    "10": "Quiz Ended", "11": "Unavailable", "12": "Submitting",
  };
  for (const [id, label] of Object.entries(labels)) {
    const card = mission(tree, id);
    assert.match(textOf(card), new RegExp(label));
    assert.doesNotMatch(textOf(card), /Room Open|Take Quiz|Enter Arena/);
    assert.equal(actionLinks(card).length, 0);
  }
  assert.equal(nodesOf(tree, (node) => node.type === "div" && String(node.props.className).includes("rounded-2xl border-2 border-indigo-500/20") && textOf(node).includes("Quiz 8")).length, 0);
  assert.match(textOf(tree), /Recent Exam Results.*Quiz 8/);
});
