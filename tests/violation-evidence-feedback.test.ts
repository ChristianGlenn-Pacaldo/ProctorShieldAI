import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("confirmed violation is shown immediately while its video finishes and uploads", async () => {
  const text = fs.readFileSync("src/app/quiz/[id]/page.tsx", "utf8");
  const ast = ts.createSourceFile("page.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "reportViolation" && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(callback);
  let finishClip!: (clip: object) => void;
  const clip = new Promise(resolve => { finishClip = resolve; });
  const warnings: unknown[] = [], counts: number[] = [], uploaded: Array<[string, unknown]> = [];
  const barrier: { current: Promise<void> | null } = { current: null };
  const context: Record<string, any> = {
    examActiveRef: { current: true }, submissionInFlightRef: { current: false }, violationCountRef: { current: 0 },
    isReportingRef: { current: false }, lastViolationAtRef: { current: 0 }, pendingIncidentIdsRef: { current: new Map() },
    pendingEvidenceUploadRef: barrier, crypto: { randomUUID: () => "incident" }, captureEvidenceClip: () => clip,
    captureSnapshot: () => "snapshot", quizId: "1", studentQuizIdRef: { current: "attempt" }, AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ success: true, violation: { id: "1" }, violationCount: 1 }) }),
    setViolationCount: (count: number) => counts.push(count), playTone() {}, getViolationLabel: () => "Possible phone",
    setWarningModal: (warning: unknown) => warnings.push(warning), isAlertingRef: { current: false },
    setTimeout, setPreWarning() {}, console,
    uploadEvidenceClip: async (id: string, value: unknown) => { uploaded.push([id, value]); return true; },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpile("globalThis.report = " + callback), context);
  const pending = context.report("device_detected", 85);
  await new Promise(setImmediate);
  assert.deepEqual(counts, [1]);
  assert.equal(warnings.length, 1);
  assert.deepEqual(uploaded, []);
  assert.ok(barrier.current, "submission must still wait for pending evidence");
  const originalClip = { blob: new Blob(["video"]), durationMs: 3_500, extension: "webm" };
  finishClip(originalClip);
  assert.equal(await pending, true);
  assert.equal(uploaded[0][1], originalClip);
  assert.equal(barrier.current, null);
  assert.equal(context.isReportingRef.current, false);
});
