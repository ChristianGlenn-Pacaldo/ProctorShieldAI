import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { transform } from "lightningcss";
import postcss from "postcss";
import * as jsx from "react/jsx-runtime";
import * as motion from "motion/react";
import { renderToStaticMarkup } from "react-dom/server";

const load = (file: string, dependencies: Record<string, unknown>) => {
  const exports: { default?: React.ComponentType } = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { exports, require(name: string) {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "motion/react") return motion;
    assert.ok(name in dependencies, `Unexpected import: ${name}`); return dependencies[name];
  } });
  return exports;
};
const css = { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
const installed = load("src/components/how-it-works.tsx", { "./how-it-works.module.css": css });
const wrapper = load("src/components/landing-how-it-works.tsx", { "./how-it-works": installed, "./how-it-works.module.css": css });
const html = renderToStaticMarkup(React.createElement(wrapper.default!));
const source = fs.readFileSync("src/components/how-it-works.tsx", "utf8");
const page = fs.readFileSync("src/app/page.tsx", "utf8");
const flowCss = fs.readFileSync("src/components/how-it-works.module.css", "utf8");

test("actual installed component and real Motion SSR render five semantic steps in the correct order", () => {
  assert.match(html, /<ol[^>]*aria-label="ProctorShieldAI assessment workflow"/);
  assert.equal((html.match(/<li\b/g) ?? []).length, 5);
  const titles = [...html.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map(match => match[1]);
  assert.deepEqual(titles, ["Create Your Account", "Create &amp; Configure Quizzes", "Join &amp; Take Assessments", "AI-Assisted Monitoring", "Review Results"]);
  assert.doesNotMatch(html, /investments?|portfolio|financial goals|Verify Identity|Track Growth/i);
});

test("workflow accurately qualifies monitoring and retains the unproctored Arena boundary", () => {
  assert.match(html, /When enabled for a proctored quiz/);
  assert.match(html, /Power Arena does not use proctoring/);
  assert.match(html, /flags recorded events for teacher review/);
  assert.doesNotMatch(html, /guaranteed|prevent.*cheating|automatically.*punish/i);
});

test("decorative pins, step numbers and connector are hidden from assistive technology", () => {
  assert.equal((html.match(/<svg[^>]*aria-hidden="true"/g) ?? []).length, 6);
  assert.equal((html.match(/<span[^>]*aria-hidden="true"/g) ?? []).length, 5);
  assert.doesNotMatch(html, /tabindex="/);
});

test("flow pause is a native non-submit button with a clear initial state and visible focus", () => {
  assert.match(html, /<button[^>]*type="button"[^>]*aria-pressed="false"[^>]*>Pause flow animation<\/button>/);
  assert.match(flowCss, /\.motionButton:focus-visible[^}]*outline: 3px solid/);
  assert.match(flowCss, /\.motionButton[^}]*min-height: 44px/);
});

test("registry animation remains three seconds and pausable; reduced motion stops the infinite path", () => {
  assert.match(source, /animate\(dashOffset, \[0, -140\], \{ duration: 3, repeat: Infinity, ease: "linear" \}\)/);
  assert.match(source, /if \(reducedMotion \|\| readReducedMotion\(\)\) \{ dashOffset\.set\(0\); return; \}/);
  assert.match(source, /animation\.current\?\.pause\(\)/);
  assert.match(source, /playback\.stop\(\)/);
  assert.match(flowCss, /prefers-reduced-motion: reduce/);
});

test("How It Works replaces the old presentation once and preserves landing navigation targets", () => {
  assert.equal((page.match(/<LandingHowItWorks\s*\/>/g) ?? []).length, 1);
  assert.equal((page.match(/id="how"/g) ?? []).length, 1);
  assert.match(page, /Five steps\. One place to make it happen\./);
  assert.doesNotMatch(page, /steps\.map|Three steps\./);
  assert.match(page, /<Velaris bg="#012620" speed=\{2\}/);
  assert.match(page, /<HeroLogoIntro/);
  assert.match(page, /ProctorShieldAI footer/);
});

test("small viewports and enlarged cards yield to natural flow without clipping text", () => {
  assert.match(flowCss, /max-width: 1100px/);
  assert.match(flowCss, /data-expanded="true"[^}]*height: auto/);
  assert.match(flowCss, /overflow-wrap: anywhere/);
  assert.match(flowCss, /\[data-how-body\][^}]*overflow: visible/);
  assert.doesNotMatch(flowCss, /white-space:\s*nowrap|text-overflow:\s*ellipsis/);
});

// Reproduce the CSS lowering that previously removed the individual rotate reset.
test("compiled mobile and enlarged-text rules still reset individual rotation and scale", () => {
  const compiled = transform({ filename: "how-it-works.module.css", code: Buffer.from(flowCss),
    cssModules: true, minify: true, targets: { chrome: 80 << 16 } }).code.toString();
  const rules = postcss.parse(compiled);
  let stackResets = 0;
  rules.walkRules(rule => {
    if (!rule.selector.includes("[data-how-card]")) return;
    const expanded = rule.selector.includes('data-expanded="true"') || rule.selector.includes("data-expanded=true");
    const mobile = rule.parent?.type === "atrule" && /max-width:\s*1100px/.test(rule.parent.params);
    if (!expanded && !mobile) return;
    const values: Record<string, string> = {};
    rule.walkDecls(decl => { values[decl.prop] = decl.value; });
    assert.ok(values.rotate, "CSS compilation must not erase the individual rotate reset");
    assert.ok(values.scale, "CSS compilation must not erase the individual hover scale reset");
    assert.match(values.rotate, /0deg/);
    assert.match(values.scale, /1/);
    assert.equal(values.width, "100%");
    stackResets++;
  });
  assert.equal(stackResets, 2);
});
