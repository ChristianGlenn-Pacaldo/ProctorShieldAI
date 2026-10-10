import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { studentThemeFixture } from "./helpers/student-theme-fixture.ts";
import { sidebarFixture, sidebarNodes, sidebarText } from "./helpers/sidebar-theme-fixture.ts";
const require = createRequire(import.meta.url);
const postcss = require("postcss") as typeof import("postcss");

test("Student CSS stays scoped when App Router retains route styles across navigation", () => {
  const css = fs.readFileSync("src/app/dashboard/student/student.css", "utf8");
  postcss.parse(css).walkRules(rule => assert.ok(postcss.list.comma(rule.selector).every(selector => selector.includes('[data-portal="student"]')), rule.selector));
  assert.ok(css.includes("--surface: var(--ps-surface)"));
  assert.ok(css.includes("--ink: var(--ps-text)"));
  assert.ok(css.includes("--surface2: var(--ps-surface-inset)"));
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /@keyframes|animation: (?!none)/);
  postcss.parse(css).walkRules(rule => assert.doesNotMatch(rule.selector, /canvas|video|iframe/));
});
for (const role of ["student", "teacher", "admin"] as const) {
  test(role + " shell keeps navigation, theme persistence and notifications in its own scope", async () => {
    const page = sidebarFixture(role); await page.mount();
    try {
      assert.equal(sidebarNodes(page.render(), node => node.props["data-portal"] === role).length, 1);
      if (role === "student") assert.match(sidebarText(page.render()), /ProctorShieldAI/);
      const links = () => sidebarNodes(page.render(), node => node.type === "a").map(node => node.props.href);
      const before = links(); await page.click("Switch to dark theme");
      assert.equal(page.storage.get("theme"), "dark"); assert.deepEqual(links(), before);
      assert.equal(sidebarNodes(page.render(), node => node.props["aria-label"] === "Open notifications").length, 1);
    } finally { page.unmount(); }
  });
}
test("Student dashboard retains correct exam average, Arena points, and unavailable join controls", () => {
  const html = studentThemeFixture("dashboard");
  assert.match(html, /ps-student-hero/); assert.match(html, /80%/); assert.match(html, /213 pts/);
  assert.doesNotMatch(html, /213%|EXP Earned|STUDENT PROGRESSION/);
  assert.match(html, /aria-label="Quiz access code"/);
  assert.match(html, /disabled="true"/);
});
test("Student settings has associated existing-policy help without altering password controls", () => {
  const html = studentThemeFixture("settings");
  assert.match(html, /aria-describedby="student-new-password-help"/);
  assert.match(html, /id="student-new-password-help"/);
  assert.match(html, /10–128 characters, including letters and numbers/);
  assert.match(html, /placeholder="New password"/);
  assert.match(html, /Show current password/); assert.match(html, /Show new password/);
});
test("Results preserve score units and a keyboard-accessible bounded table", () => {
  const html = studentThemeFixture("results");
  assert.match(html, /213 pts/); assert.match(html, /80%/); assert.match(html, /Invalidated/);
  assert.match(html, /role="region"/); assert.match(html, /aria-label="Quiz attempt history"/);
  assert.match(html, /overflow-x-auto/);
});
test("Quiz search has an accessible name and stacks at mobile widths", () => {
  const source = fs.readFileSync("src/app/dashboard/student/quizzes/content.tsx", "utf8");
  assert.match(source, /aria-label="Search enrolled quizzes"/);
  assert.match(source, /flex-col items-stretch/); assert.match(source, /sm:flex-row sm:items-center/);
  assert.match(source, /w-full sm:w-56/); assert.match(source, /aria-label="Enrolled quizzes"/);
});

test("Empty Results message is outside the scrolling table on mobile while desktop retains its table", () => {
  const html = studentThemeFixture("results", "empty");
  const status = '<p role="status"';
  const region = '<div role="region"';
  assert.ok(html.indexOf(status) >= 0);
  assert.ok(html.indexOf(status) < html.indexOf(region));
  assert.match(html, /<p role="status" class="[^"]*text-\[var\(--muted\)\][^"]*sm:hidden">\s*No quiz history found\./);
  assert.match(html, /aria-label="Quiz attempt history" tabIndex="0" class="overflow-x-auto hidden sm:block"/);
  assert.match(html, /<td colSpan="6"[^>]*>No quiz history found\.<\/td>/);
});

test("Populated Results keeps its scroll region, columns, score units, and review controls", () => {
  const html = studentThemeFixture("results");
  assert.doesNotMatch(html, /No quiz history found|role="status"|hidden sm:block/);
  assert.match(html, /aria-label="Quiz attempt history" tabIndex="0" class="overflow-x-auto"/);
  for (const heading of ["Quiz", "Mode", "Record Date", "Score", "Status / Verdict", "Details"]) {
    assert.ok(html.includes(heading));
  }
  assert.match(html, /213 pts/); assert.match(html, /80%/); assert.match(html, /Invalidated/);
  assert.match(html, /Review/);
});

test("Loading and failed Results requests never display a successful empty-history state", () => {
  const loading = studentThemeFixture("results", "loading");
  const failed = studentThemeFixture("results", "load-error");
  assert.match(loading, /Loading results/);
  assert.match(failed, /Could not load your results/); assert.match(failed, /Retry/);
  for (const html of [loading, failed]) assert.doesNotMatch(html, /No quiz history found|hidden sm:block/);
});
