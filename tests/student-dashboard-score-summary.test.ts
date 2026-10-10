import assert from "node:assert/strict";
import test from "node:test";
import { find, fixture, textOf } from "./helpers/dashboard-lifecycle-fixture.ts";

function row(id: string, score: number, extra: Record<string, unknown> = {}) {
  return {
    id, score, quizStatus: "completed", attemptMode: "proctored", aiVerdict: "clean",
    endTime: "2026-10-08T10:00:00Z", _count: { violations: 0 },
    quiz: { id: 42, title: id, quizStatus: "ended", quizMode: "proctored", duration: 30 },
    ...extra,
  };
}

test("Dashboard renders exam averages and Arena points in separate units without altering retake actions", async () => {
  const setup = fixture("student");
  const reply = { body: { success: true, quizzes: [
    row("QA Arena", 213, { attemptMode: "arena", aiVerdict: null }),
    row("QA Exam", 80),
    row("QA Invalidated", 100, { _count: { violations: 3 }, aiVerdict: "suspicious" }),
    row("QA Retake", 60, { quizStatus: "pending_retake" }),
  ] } };
  // Both the persistent retake consumer and Dashboard read this owned fixture.
  setup.queue("/api/quizzes", reply);
  setup.queue("/api/quizzes", reply);
  try {
    setup.render(); await setup.ready();
    const tree = setup.render();
    const scoreCard = find(tree, node => node.type === "div" &&
      String(node.props.className).includes("rounded-2xl") &&
      textOf(node).includes("Average Exam Score"))!;
    assert.ok(scoreCard);
    assert.match(textOf(scoreCard), /70%/);
    const arena = find(tree, node => node.type === "div" &&
      String(node.props.className).includes("p-3.5") && textOf(node).includes("QA Arena"))!;
    assert.match(textOf(arena), /213 pts/);
    assert.match(textOf(arena), /Match Completed/);
    assert.doesNotMatch(textOf(arena), /213%|Cheated/);
    const invalidated = find(tree, node => node.type === "div" &&
      String(node.props.className).includes("p-3.5") && textOf(node).includes("QA Invalidated"))!;
    const invalidatedBadge = find(invalidated, node => node.type === "span" && textOf(node) === "Invalidated")!;
    assert.ok(invalidatedBadge);
    assert.ok(String(invalidatedBadge.props.className).includes("text-[var(--ps-error)]"));
    assert.match(textOf(invalidated), /Voided/);
    assert.doesNotMatch(textOf(invalidated), /100%/);
    assert.match(textOf(tree), /Retake Pending/);
    assert.equal(setup.requests.filter(request => request.method !== "GET").length, 0);
  } finally {
    setup.unmount(); setup.assertDisposed();
  }
});

test("Dashboard hero and Quick Join use theme tokens with dark overrides and a narrow-screen form", async () => {
  const setup = fixture("student");
  try {
    setup.render(); await setup.ready();
    const tree = setup.render();
    const hero = find(tree, node => node.type === "div" &&
      String(node.props.className).includes("ps-student-hero"))!;
    assert.ok(hero);
    const heroClass = String(hero.props.className);
    for (const token of ["ps-student-hero", "border", "text-[var(--ink)]"]) {
      assert.ok(heroClass.split(" ").includes(token));
    }
    const input = find(tree, node => node.props["aria-label"] === "Quiz access code")!;
    for (const token of ["min-w-0", "bg-[var(--surface2)]", "text-[var(--ink)]", "placeholder:text-[var(--ink3)]"]) {
      assert.ok(String(input.props.className).split(" ").includes(token));
    }
    const form = find(tree, node => node.type === "form")!;
    assert.ok(String(form.props.className).includes("flex-col sm:flex-row"));
    assert.equal(find(form, node => node.type === "button" && node.props.type === "submit")!.props.disabled, true);
    assert.doesNotMatch(textOf(tree), /EXP Earned|Student Progression|Level Progression/i);
  } finally {
    setup.unmount(); setup.assertDisposed();
  }
});
