import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { sidebarFixture, sidebarNodes } from "./helpers/sidebar-theme-fixture.ts";
const require = createRequire(import.meta.url);
const postcss = require("postcss") as typeof import("postcss");
const css = fs.readFileSync("src/app/dashboard/admin/admin-glass.css", "utf8");

test("Admin glass requires explicit role and material opt-ins without changing layout", () => {
  const ast = postcss.parse(css);
  ast.walkRules(rule => {
    for (const selector of postcss.list.comma(rule.selector)) {
      assert.ok(selector.includes('[data-portal="admin"].ps-admin-glass-shell'), selector);
      assert.doesNotMatch(selector, /student|teacher|\.ps-auth/);
      assert.doesNotMatch(selector, /(?:^|[\s>+~,(:])(?:video|canvas|iframe|input|table)\b/);
    }
  });
  ast.walkDecls(decl => assert.ok(decl.prop.startsWith("--ps-admin-glass-") ||
    ["background", "color", "border-color", "border-bottom-left-radius", "border-bottom-right-radius", "box-shadow", "backdrop-filter", "-webkit-backdrop-filter"].includes(decl.prop), decl.prop));
  assert.doesNotMatch(css, /@keyframes|animation\s*:|transition\s*:|position\s*:|pointer-events\s*:/);
});

test("Admin glass bounds blur, protects dense data and dialogs, and has an opaque fallback", () => {
  assert.match(css, /--ps-admin-glass-blur:10px/);
  assert.match(css, /@media\(max-width:767px\)/);
  assert.match(css, /--ps-admin-glass-blur:4px/);
  assert.match(css, /--ps-admin-glass-dense-fill:color-mix\(in srgb,var\(--ps-surface\) 95%,transparent\)/);
  assert.match(css, /\.ps-admin-glass-dense\s*\{[^}]*backdrop-filter:none/);
  assert.match(css, /\.ps-admin-glass-dialog \{--ps-admin-glass-card-fill:color-mix\(in srgb,var\(--ps-surface\) 92%,transparent\)/);
  assert.match(css, /@supports not \(backdrop-filter:blur\(1px\)\)/);
});

test("Admin directories keep keyboard-accessible, dense locally scrolling tables", () => {
  for (const file of ["content.tsx", "users/content.tsx", "quizzes/content.tsx", "logs/content.tsx"]) {
    const source = fs.readFileSync("src/app/dashboard/admin/" + file, "utf8");
    assert.match(source, /ps-admin-glass-canvas/);
    assert.match(source, /ps-admin-glass-card/);
    assert.match(source, /ps-admin-table-scroll ps-admin-glass-dense overflow-x-auto/);
    assert.match(source, /role="region" aria-label="Admin [^"]+" tabIndex=\{0\}/);
    assert.match(source, /<table className="w-full">/);
  }
});

test("Admin analytics and settings preserve readable bodies and existing controls", () => {
  const analytics = fs.readFileSync("src/app/dashboard/admin/analytics/content.tsx", "utf8");
  assert.equal((analytics.match(/ps-admin-glass-dense p-5 space-y-4/g) ?? []).length, 4);
  const settings = fs.readFileSync("src/app/dashboard/admin/settings/content.tsx", "utf8");
  assert.equal((settings.match(/ps-admin-glass-card/g) ?? []).length, 2);
  assert.match(settings, /ps-admin-glass-dense text-left space-y-3/);
  assert.match(settings, /value="ProctorShieldAI" disabled/);
  for (const file of ["content.tsx", "users/content.tsx"]) {
    const source = fs.readFileSync("src/app/dashboard/admin/" + file, "utf8");
    assert.match(source, /ps-admin-glass-card ps-admin-glass-dialog app-modal-panel/);
    assert.match(source, /Suspend/); assert.match(source, /Restore/);
  }
});

for (const role of ["admin", "student", "teacher"] as const) {
  test(`${role} shell keeps isolated materials, links, theme preference and session scope`, async () => {
    const page = sidebarFixture(role); await page.mount();
    try {
      const classes = () => sidebarNodes(page.render(), node => typeof node.props.className === "string").map(node => node.props.className as string);
      const links = () => sidebarNodes(page.render(), node => node.type === "a").map(node => node.props.href);
      const before = links();
      assert.equal(classes().some(value => value.includes("ps-admin-glass-shell")), role === "admin");
      assert.equal(classes().filter(value => value.includes("ps-admin-glass-chrome")).length, role === "admin" ? 2 : 0);
      assert.equal(classes().some(value => value.includes("ps-student-glass-shell")), role === "student");
      assert.equal(classes().some(value => value.includes("ps-teacher-glass-shell")), role === "teacher");
      if (role === "admin") assert.ok(page.requests.every(request => request.url.includes("scope=admin")));
      await page.click("Switch to dark theme"); assert.equal(page.storage.get("theme"), "dark"); assert.deepEqual(links(), before);
      await page.click("Switch to light theme"); assert.equal(page.storage.get("theme"), "light"); assert.deepEqual(links(), before);
    } finally { page.unmount(); }
  });
}


test("Small count captions retain a strong semantic foreground over glass, and dense bodies preserve rounded frames", () => {
  for (const scene of ["users", "logs"]) {
    const source = fs.readFileSync("src/app/dashboard/admin/" + scene + "/content.tsx", "utf8");
    assert.match(source, /ps-admin-glass-caption text-\[10px\] text-\[var\(--muted\)\] mt-0\.5/);
  }
  assert.match(css, /\.ps-admin-glass-caption \{color:var\(--ps-text\) !important;/);
  assert.match(css, /\.ps-admin-glass-card > \.ps-admin-glass-dense:last-child/);
  assert.match(css, /border-bottom-left-radius:inherit/);
  assert.match(css, /border-bottom-right-radius:inherit/);
});
