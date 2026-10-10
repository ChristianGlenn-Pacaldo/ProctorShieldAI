import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { studentThemeFixture } from "./helpers/student-theme-fixture.ts";
import { sidebarFixture, sidebarNodes } from "./helpers/sidebar-theme-fixture.ts";

const require = createRequire(import.meta.url);
const postcss = require("postcss") as typeof import("postcss");
const css = fs.readFileSync("src/app/dashboard/student/student-glass.css", "utf8");

test("Cached Student glass CSS requires both the Student role and an explicit material opt-in", () => {
  const ast = postcss.parse(css);
  ast.walkRules(rule => {
    for (const selector of postcss.list.comma(rule.selector)) {
      assert.ok(selector.includes('[data-portal="student"].ps-student-glass-shell'), selector);
      assert.doesNotMatch(selector, /teacher|admin|canvas|video|iframe|input|textarea|table/);
    }
  });
  ast.walkDecls(declaration => assert.ok(declaration.prop.startsWith("--ps-glass-") ||
    ["background", "border-color", "box-shadow", "backdrop-filter", "-webkit-backdrop-filter"].includes(declaration.prop),
    `Material must not change layout, typography, focus, or interactions: ${declaration.prop}`));
  assert.doesNotMatch(css, /@keyframes|animation\s*:|transition\s*:/);
});

test("Glass retains dense readable fields, a shallow nested frame, and a bounded mobile blur", () => {
  const rules = new Map<string, string>();
  postcss.parse(css).walkRules(rule => { rules.set(rule.selector, rule.toString()); });
  assert.match(rules.get('[data-portal="student"].ps-student-glass-shell .ps-glass-dense')!, /backdrop-filter:none/);
  assert.match(rules.get('[data-portal="student"].ps-student-glass-shell .ps-glass-frame')!, /backdrop-filter:none/);
  assert.match(css, /--ps-glass-dense-fill:color-mix\(in srgb,var\(--ps-surface\) 95%,transparent\)/);
  const mobile: string[] = [];
  postcss.parse(css).walkAtRules("media", rule => { if (rule.params === "(max-width:767px)") mobile.push(rule.toString()); });
  assert.match(mobile.join("\n"), /--ps-glass-blur:4px/);
  assert.match(css, /@supports not \(backdrop-filter:blur\(1px\)\)/);
  assert.match(css, /background:var\(--ps-surface\) !important/);
});

test("Student overview opts in without changing academic percentages or Arena point units", () => {
  const html = studentThemeFixture("dashboard");
  assert.match(html, /ps-student-page ps-glass-overview/);
  assert.equal((html.match(/ps-glass-card/g) ?? []).length, 5);
  assert.match(html, /class="ps-glass-dense[^"\n]*"[^>]*aria-label="Quiz access code"|aria-label="Quiz access code"[^>]*class="ps-glass-dense/);
  assert.match(html, /80%/); assert.match(html, /213 pts/);
  assert.doesNotMatch(html, /213%|EXP Earned|STUDENT PROGRESSION/);
});

for (const scene of ["settings", "results"] as const) {
  test(`${scene} panels remain outside the overview glass pilot`, () => {
    const html = studentThemeFixture(scene);
    assert.doesNotMatch(html, /ps-glass-card|ps-glass-overview|ps-glass-frame/);
    if (scene === "results") {
      assert.match(html, /213 pts/); assert.match(html, /80%/);
      assert.match(html, /overflow-x-auto/); assert.match(html, /Invalidated/);
    }
  });
}

for (const role of ["student", "teacher", "admin"] as const) {
  test(`${role} navigation only receives glass for Student, preserving theme and destinations`, async () => {
    const page = sidebarFixture(role); await page.mount();
    try {
      const classes = () => sidebarNodes(page.render(), node => typeof node.props.className === "string")
        .map(node => node.props.className as string);
      const links = () => sidebarNodes(page.render(), node => node.type === "a").map(node => node.props.href);
      const before = links();
      assert.equal(classes().some(value => value.includes("ps-student-glass-shell")), role === "student");
      assert.equal(classes().filter(value => value.includes("ps-glass-chrome")).length, role === "student" ? 2 : 0);
      await page.click("Switch to dark theme");
      assert.equal(page.storage.get("theme"), "dark"); assert.deepEqual(links(), before);
      await page.click("Switch to light theme");
      assert.equal(page.storage.get("theme"), "light"); assert.deepEqual(links(), before);
    } finally { page.unmount(); }
  });
}
