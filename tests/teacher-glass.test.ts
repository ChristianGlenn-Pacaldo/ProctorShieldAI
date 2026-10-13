import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { teacherThemeFixture } from "./helpers/teacher-theme-fixture.ts";
import { sidebarFixture, sidebarNodes } from "./helpers/sidebar-theme-fixture.ts";
const require = createRequire(import.meta.url);
const postcss = require("postcss") as typeof import("postcss");
const css = fs.readFileSync("src/app/dashboard/teacher/teacher-glass.css", "utf8");

test("Retained Teacher glass styles require an explicit Teacher shell or selected Teacher portal", () => {
  postcss.parse(css).walkRules(rule => {
    for (const selector of postcss.list.comma(rule.selector)) {
      assert.ok(selector.includes('[data-portal="teacher"].ps-teacher-glass-shell') || selector.includes(".teacher-content.ps-teacher-glass-dialog"), selector);
      assert.doesNotMatch(selector, /student|admin|\.ps-auth/);
      assert.doesNotMatch(selector, /(?:^|[\s>+~,(:])(?:video|canvas|iframe|input|table)\b/);
    }
  });
  postcss.parse(css).walkDecls(decl => assert.ok(decl.prop.startsWith("--ps-teacher-glass-") ||
    ["background", "border-color", "box-shadow", "backdrop-filter", "-webkit-backdrop-filter"].includes(decl.prop), decl.prop));
  assert.doesNotMatch(css, /@keyframes|animation\s*:|transition\s*:|position\s*:|pointer-events\s*:/);
});

test("Teacher glass preserves the approved blur budget and dense-content fallback", () => {
  assert.match(css, /--ps-teacher-glass-blur:10px/);
  assert.match(css, /@media\(max-width:767px\)/);
  assert.match(css, /--ps-teacher-glass-blur:4px/);
  assert.match(css, /--ps-teacher-glass-dense-fill:color-mix\(in srgb,var\(--ps-surface\) 95%,transparent\)/);
  assert.match(css, /\.ps-teacher-glass-dense\s*\{[^}]*backdrop-filter:none/);
  assert.match(css, /@supports not \(backdrop-filter:blur\(1px\)\)/);
});

test("Teacher overview opts in outer cards while verdict content keeps its historical score display", () => {
  const html = teacherThemeFixture("dashboard").content;
  assert.match(html, /ps-teacher-glass-canvas/); assert.match(html, /ps-teacher-hub ps-teacher-glass-card/);
  assert.match(html, /ps-teacher-glass-dense overflow-x-auto min-h-\[150px\]/);
  assert.match(html, /80%/); assert.match(html, /AI Verdict Summary/);
  assert.doesNotMatch(html, /Live Biometric Telemetry|RADAR ACTIVE|EXP Earned/);
});

test("Quiz library and Settings keep dense tables and controls inside their glass surrounds", () => {
  const library = teacherThemeFixture("quizzes").content;
  assert.match(library, /ps-teacher-glass-dense overflow-x-auto min-h-\[300px\]/);
  assert.match(library, /aria-label="Teacher quiz library"/);
  const settings = teacherThemeFixture("settings").content;
  assert.match(settings, /ps-teacher-settings ps-teacher-glass-canvas/);
  assert.equal((settings.match(/ps-teacher-glass-card/g) ?? []).length, 2);
  assert.equal((settings.match(/ps-teacher-glass-dense/g) ?? []).length, 5);
  assert.match(settings, /aria-describedby="teacher-new-password-help"/);
});

test("Editor, monitoring, evidence and Arena content stay outside the new glass opt-ins", () => {
  for (const scene of ["monitor", "evidence", "arena", "playground"] as const) {
    assert.doesNotMatch(teacherThemeFixture(scene).content, /ps-teacher-glass-card|ps-teacher-glass-canvas/);
  }
  for (const variant of ["dialog", "answers", "locked"]) {
    const editor = teacherThemeFixture("quizzes", variant).portals;
    assert.match(editor, /ps-teacher-editor/);
    assert.doesNotMatch(editor, /ps-teacher-glass-card|ps-teacher-glass-dialog/);
  }
});

for (const role of ["teacher", "student", "admin"] as const) {
  test(`${role} chrome keeps role-specific opt-ins, navigation and theme persistence`, async () => {
    const page = sidebarFixture(role); await page.mount();
    try {
      const classes = () => sidebarNodes(page.render(), node => typeof node.props.className === "string").map(node => node.props.className as string);
      const links = () => sidebarNodes(page.render(), node => node.type === "a").map(node => node.props.href);
      const before = links();
      assert.equal(classes().some(value => value.includes("ps-teacher-glass-shell")), role === "teacher");
      assert.equal(classes().filter(value => value.includes("ps-teacher-glass-chrome")).length, role === "teacher" ? 2 : 0);
      assert.equal(classes().some(value => value.includes("ps-student-glass-shell")), role === "student");
      await page.click("Switch to dark theme"); assert.equal(page.storage.get("theme"), "dark"); assert.deepEqual(links(), before);
      await page.click("Switch to light theme"); assert.equal(page.storage.get("theme"), "light"); assert.deepEqual(links(), before);
    } finally { page.unmount(); }
  });
}
