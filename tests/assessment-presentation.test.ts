import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { assessmentFixture } from "./helpers/assessment-presentation-fixture.ts";
const postcss = createRequire(import.meta.url)("postcss") as typeof import("postcss");
const css = fs.readFileSync("src/styles/assessment-theme.css", "utf8");
test("Assessment styles stay scoped and do not restack overlays or alter media/VFX motion", () => {
  postcss.parse(css).walkRules(rule => assert.ok(/\.ps-(assessment-theme|assessment-route|arena-theme|exam-theme)\b/.test(rule.selector), rule.selector));
  postcss.parse(css).walkDecls(decl => assert.ok(!["position", "z-index", "pointer-events", "transform", "animation", "object-fit", "visibility"].includes(decl.prop), decl.prop));
  postcss.parse(css).walkAtRules(rule => assert.notEqual(rule.name, "keyframes"));
  assert.match(css, /:not\(\[data-arena-vfx\] \*\)/);
  assert.match(css, /\.ps-assessment-route \{display:contents/);
  assert.match(css, /ps-proctor-media/);
});
test("Actual quiz JSX retains questions, monitoring labels, timer, strikes and warnings", () => {
  for (const mobile of [false, true]) {
    const view = assessmentFixture("exam", "active", mobile);
    for (const label of ["Which number is even?", "Two", "Three", "12:34", "0/3 Violations", "Submit Quiz"]) assert.ok(view.includes(label), label);
    assert.match(view, /<video/); assert.match(view, /ps-proctor-media/);
  }
  assert.match(assessmentFixture("exam", "warning"), /SECURITY PROCTORING ALERT/);
  assert.match(assessmentFixture("exam", "result"), /85%/);
});
test("Actual Arena JSX keeps points, power controls, Meteor VFX and armed shield", () => {
  const active = assessmentFixture("arena");
  assert.match(active, /213/); assert.match(active, /Meteor Strike/); assert.match(active, /Guardian Shield/);
  assert.match(assessmentFixture("arena", "meteor"), /data-arena-vfx="meteor"/);
  assert.match(assessmentFixture("arena", "shield"), /data-arena-vfx="armed"/);
});

test("Tall lobby scrolls without changing the active exam layout", () => {
  assert.match(css, /\.ps-assessment-theme \.ps-quiz-lobby \{height:100dvh;min-height:100dvh;overflow-y:auto/);
  assert.match(assessmentFixture("exam", "lobby"), /ps-quiz-lobby/);
  assert.doesNotMatch(assessmentFixture("exam", "active"), /ps-quiz-lobby/);
});

test("Assessment theme control reuses the approved preference mechanism and glass excludes media/VFX", () => {
  const control = fs.readFileSync("src/components/assessment-theme-control.tsx", "utf8");
  assert.match(control, /<AuthThemeControl \/>/);
  assert.doesNotMatch(control, /useState|useEffect|localStorage|fetch\(|Provider/);
  assert.match(css, /background:var\(--ps-glass\)/);
  assert.match(css, /:not\(\.min-h-screen,\.ps-proctor-media,\.ps-proctor-radar,\[data-arena-vfx\]/);
});
