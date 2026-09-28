import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as retakeEligibility from "../src/lib/retake-eligibility.ts";

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

function transpile(relativePath: string) {
  return ts.transpileModule(fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
}

const completedAt = new Date("2026-09-01T12:00:00.000Z");
const attempts = [
  { id: "proctored-complete", attemptMode: "proctored", quizStatus: "completed", endTime: completedAt, score: 84, aiVerdict: "clean", cheatingProbability: 5, quiz: { title: "Completed Exam", allowRetake: true }, _count: { violations: 0 } },
  { id: "proctored-active", attemptMode: "proctored", quizStatus: "in_progress", endTime: null, score: null, aiVerdict: null, cheatingProbability: null, quiz: { title: "Active Exam" }, _count: { violations: 0 } },
  { id: "proctored-retake", attemptMode: "proctored", quizStatus: "pending_retake", endTime: completedAt, score: 70, aiVerdict: "suspicious", cheatingProbability: 30, quiz: { title: "Retake Pending Exam", allowRetake: true }, _count: { violations: 1 } },
  { id: "arena-complete", attemptMode: "arena", quizStatus: "completed", endTime: completedAt, score: 250, aiVerdict: null, cheatingProbability: null, quiz: { title: "Completed Arena" }, _count: { violations: 0 } },
  { id: "arena-active", attemptMode: "arena", quizStatus: "in_progress", endTime: null, score: 120, aiVerdict: null, cheatingProbability: null, quiz: { title: "Active Arena" }, _count: { violations: 0 } },
  { id: "arena-waiting", attemptMode: "arena", quizStatus: "enrolled", endTime: null, score: null, aiVerdict: null, cheatingProbability: null, quiz: { title: "Waiting Arena" }, _count: { violations: 0 } },
  { id: "proctored-rejected", attemptMode: "proctored", quizStatus: "rejected", endTime: completedAt, score: null, aiVerdict: null, cheatingProbability: null, quiz: { title: "Rejected Entry" }, _count: { violations: 0 } },
  { id: "inconsistent-complete", attemptMode: "proctored", quizStatus: "completed", endTime: null, score: null, aiVerdict: null, cheatingProbability: null, quiz: { title: "Unconfirmed Completion" }, _count: { violations: 0 } },
].map((attempt) => ({ ...attempt, createdAt: completedAt, aiAnalysis: null, remarks: null }));

async function loadResultsApi(role: string | null = "student") {
  const loadedModule: { GET?: () => Promise<{ status: number; body: { results?: Array<Record<string, unknown>> } }> } = {};
  let queried = false;
  vm.runInNewContext(transpile("src/app/api/dashboard/student/results/route.ts"), {
    exports: loadedModule,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: unknown, options?: { status?: number }) => ({ body, status: options?.status ?? 200 }) } };
      if (name === "@/lib/prisma") return { __esModule: true, default: { studentQuiz: { findMany: async () => { queried = true; return attempts; } } } };
      if (name === "@/lib/auth") return { getSession: async () => role ? { role, userId: "student-1" } : null };
      if (name === "@/lib/retake-eligibility") return retakeEligibility;
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console,
  });
  const response = await loadedModule.GET!();
  return { ...response, queried };
}

function pageFixture(relativePath: string, results: Array<Record<string, unknown>>) {
  const state: unknown[] = [];
  const effects: Array<() => void> = [];
  let hookIndex = 0;
  let collectEffects = true;
  const react = {
    useState: (initial: unknown) => {
      const index = hookIndex++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (next: unknown) => {
        state[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(state[index]) : next;
      }];
    },
    useEffect: (callback: () => void) => { hookIndex++; if (collectEffects) effects.push(callback); },
  };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const loadedModule: { default?: () => ElementNode } = {};
  vm.runInNewContext(transpile(relativePath), {
    exports: loadedModule,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "lucide-react") return {};
      if (name === "@/components/student/ResultModal") return { __esModule: true, default: "result-modal" };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async () => ({ ok: true, json: async () => ({ success: true, results }) }),
    console,
  });
  const render = () => { hookIndex = 0; return loadedModule.default!(); };
  return {
    render,
    mount: async () => {
      render();
      collectEffects = false;
      effects.forEach((effect) => effect());
      await new Promise(setImmediate);
    },
  };
}

test("Results API preserves mixed attempt history and derives completion from status plus end time", async () => {
  const response = await loadResultsApi();
  assert.equal(response.status, 200);
  assert.equal(response.queried, true);
  const rows = response.body.results!;
  assert.equal(rows.length, attempts.length);
  assert.deepEqual(rows.filter((row) => row.isCompleted).map((row) => row.id), ["proctored-complete", "proctored-retake", "arena-complete"]);
  assert.equal(rows.find((row) => row.id === "arena-active")?.score, 120);
  assert.equal(rows.find((row) => row.id === "arena-active")?.effectiveMode, "arena");
  assert.equal(rows.find((row) => row.id === "proctored-retake")?.quizStatus, "pending_retake");
  assert.equal(rows.find((row) => row.id === "proctored-rejected")?.isCompleted, false);
  assert.equal(rows.find((row) => row.id === "inconsistent-complete")?.isCompleted, false);
});

test("Results API keeps Student-only authorization", async () => {
  for (const role of [null, "teacher"]) {
    const response = await loadResultsApi(role);
    assert.equal(response.status, 401);
    assert.equal(response.queried, false);
  }
});

test("Results counts completed attempts but keeps unfinished rows with honest status and no final review", async () => {
  const api = await loadResultsApi();
  const fixture = pageFixture("src/app/dashboard/student/results/content.tsx", api.body.results!);
  await fixture.mount();
  const tree = fixture.render();
  assert.equal(nodesOf(tree, (node) => node.type === "div" && textOf(node) === "3").length, 1);
  assert.match(textOf(tree), /Quiz Attempt History/);
  const row = (id: string) => nodesOf(tree, (node) => node.type === "tr" && textOf(node).includes(id))[0];
  assert.match(textOf(row("Completed Exam")), /84%.*CLEAN.*Review/);
  assert.match(textOf(row("Completed Arena")), /250 pts.*Match Completed.*Review/);
  assert.match(textOf(row("Retake Pending Exam")), /70%.*SUSPICIOUS.*Review/);
  assert.match(textOf(row("Active Exam")), /Pending.*In Progress.*Not available/);
  assert.match(textOf(row("Active Arena")), /Pending.*In Progress.*Not available/);
  assert.match(textOf(row("Waiting Arena")), /Pending.*Waiting to Start.*Not available/);
  assert.match(textOf(row("Rejected Entry")), /Pending.*Entry Rejected.*Not available/);
  assert.doesNotMatch(textOf(row("Active Arena")), /Match Completed|120 pts/);
  assert.equal(nodesOf(tree, (node) => node.type === "button" && textOf(node) === "Review").length, 3);
  assert.match(textOf(tree), /77%.*Average Exam Score/);
});

test("Reports renders only completed proctored integrity reports", async () => {
  const api = await loadResultsApi();
  const fixture = pageFixture("src/app/dashboard/student/reports/content.tsx", api.body.results!);
  await fixture.mount();
  const tree = fixture.render();
  const reports = nodesOf(tree, (node) => node.type === "article");
  assert.equal(reports.length, 2);
  assert.match(textOf(tree), /Completed Exam/);
  assert.match(textOf(tree), /Retake Pending Exam/);
  assert.doesNotMatch(textOf(tree), /Active Exam|Active Arena|Completed Arena|Rejected Entry/);
  assert.doesNotMatch(textOf(tree), /Cheating risk: 0%/);
});

test("Reports shows its normal empty state when history has no applicable completed proctored attempt", async () => {
  const api = await loadResultsApi();
  const incomplete = api.body.results!.filter((row) => !row.isCompleted || row.effectiveMode === "arena");
  const fixture = pageFixture("src/app/dashboard/student/reports/content.tsx", incomplete);
  await fixture.mount();
  assert.match(textOf(fixture.render()), /No completed quiz reports yet/);
});
