import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { teacherScenes, teacherThemeFixture } from "./helpers/teacher-theme-fixture.ts";
import { sidebarFixture, sidebarText } from "./helpers/sidebar-theme-fixture.ts";
const require = createRequire(import.meta.url);
const postcss = require("postcss") as typeof import("postcss");
const css = fs.readFileSync("src/app/dashboard/teacher/teacher-theme.css", "utf8");
const phaseD = css.slice(css.indexOf("/* Phase D:"));

test("Teacher styles stay within Teacher layouts and portals after route navigation", () => {
  assert.ok(phaseD.length > 100);
  postcss.parse(css).walkRules(rule => {
    for (const selector of postcss.list.comma(rule.selector)) {
      assert.ok(selector.includes(".teacher-content") || selector.includes(".teacher-media") || selector.includes('[data-portal="teacher"]'), selector);
    }
  });
  for (const name of ["surface", "ink", "border", "font-display"]) {
    assert.match(phaseD, new RegExp("--" + name + ":var\\(--ps-"));
  }
  postcss.parse(phaseD).walkRules(rule => assert.doesNotMatch(rule.selector, /\b(canvas|video|iframe)\b/));
  postcss.parse(phaseD).walkDecls(decl => assert.ok(!["z-index", "pointer-events"].includes(decl.prop)));
  postcss.parse(phaseD).walkAtRules(rule => assert.notEqual(rule.name, "keyframes"));
  assert.match(phaseD, /prefers-reduced-motion/);
});

test("Media keeps dedicated dark aliases while operational panels use semantic surfaces", () => {
  const media = css.match(/\.teacher-media\s*\{([^}]+)\}/)?.[1];
  assert.ok(media);
  assert.match(media, /--surface: #0f172a/);
  assert.match(media, /--teacher-text: #ffffff/);
  assert.match(css, /Footage descendants keep their existing teacher-media alias overrides/);
  assert.match(phaseD, /--teacher-rose:var\(--ps-error\)/);
});

test("Teacher dashboard preserves verdict strings and excludes the removed telemetry card", () => {
  const html = teacherThemeFixture("dashboard").content;
  assert.match(html, /ps-teacher-hub/);
  assert.match(html, /80%/);
  assert.match(html, /AI Verdict Summary/);
  assert.doesNotMatch(html, /Live Biometric Telemetry|RADAR ACTIVE|EXP Earned/);
  assert.match(html, /aria-label="Search verdict summaries"/);
  const source = fs.readFileSync("src/app/dashboard/teacher/content.tsx", "utf8");
  assert.match(source, /\{v\.score\}/);
  assert.match(source, /w-full sm:w-48/);
});

test("Teacher studio portals retain quiz title, publication, settings and question controls", () => {
  const dialog = teacherThemeFixture("quizzes", "dialog").portals;
  assert.match(dialog, /teacher-content ps-teacher-editor/);
  assert.match(dialog, /ps-teacher-editor-header/);
  assert.match(dialog, /aria-label="Quiz title"/);
  assert.match(dialog, /Publish Quiz/);
  assert.match(dialog, /Quiz Settings/);
  const answers = teacherThemeFixture("quizzes", "answers").portals;
  assert.match(answers, /aria-label="Question type"/);
  assert.match(answers, /aria-label="Question points"/);
  assert.match(answers, /Save Question/);
  assert.match(phaseD, /max-width:1023px/);
  assert.match(phaseD, /ps-teacher-editor-header \{height:auto/);
});

test("Teacher settings labels, password help and visibility controls stay accessible", () => {
  const html = teacherThemeFixture("settings").content;
  for (const id of ["teacher-full-name", "teacher-email", "teacher-current-password", "teacher-new-password", "teacher-confirm-password"]) {
    assert.ok(html.includes('for="' + id + '"'));
    assert.ok(html.includes('id="' + id + '"'));
  }
  assert.match(html, /aria-describedby="teacher-new-password-help"/);
  assert.match(html, /10–128 characters, including letters and numbers/);
  assert.match(html, /Show current password/);
  assert.match(html, /Show new password/);
  assert.match(fs.readFileSync("src/app/api/auth/profile/route.ts", "utf8"), /10-128 characters and contain letters and numbers/);
});

test("All existing Teacher scenes and Free gates still render their actual components", () => {
  for (const scene of teacherScenes) {
    const result = teacherThemeFixture(scene);
    assert.ok(result.content.includes("teacher-content"), scene);
  }
  assert.match(teacherThemeFixture("monitor", "free").content, /Live Monitoring is a Pro Feature/);
  assert.match(teacherThemeFixture("playground", "free").content, /Unlock|Upgrade|Pro/);
});

test("Teacher official name and theme persistence leave Student and Admin navigation intact", async () => {
  for (const role of ["teacher", "student", "admin"] as const) {
    const page = sidebarFixture(role); await page.mount();
    try {
      const text = sidebarText(page.render());
      if (role !== "admin") assert.match(text, /ProctorShieldAI/);
      await page.click("Switch to dark theme");
      assert.equal(page.storage.get("theme"), "dark");
      await page.click("Switch to light theme");
      assert.equal(page.storage.get("theme"), "light");
    } finally { page.unmount(); }
  }
});
