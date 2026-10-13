import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { sidebarFixture, sidebarText } from "./helpers/sidebar-theme-fixture.ts";
const require = createRequire(import.meta.url);
const postcss = require("postcss") as typeof import("postcss");
const css = fs.readFileSync("src/app/dashboard/admin/admin.css", "utf8");

test("Admin theme stays scoped when Next retains route CSS across navigation", () => {
  postcss.parse(css).walkRules(rule => {
    for (const selector of postcss.list.comma(rule.selector)) assert.ok(selector.includes('[data-portal="admin"]'), selector);
  });
  postcss.parse(css).walkAtRules(rule => assert.notEqual(rule.name, "keyframes"));
  assert.match(css, /prefers-reduced-motion/);
  postcss.parse(css).walkRules(rule => assert.doesNotMatch(rule.selector, /\b(canvas|video|iframe)\b/));
  for (const token of ["canvas", "surface", "text", "primary", "error", "warning", "focus"]) assert.ok(css.includes(`var(--ps-${token})`));
});

test("Admin theme switch uses existing preferences and survives a new shell mount", async () => {
  const storage = new Map<string, string>([["theme", "light"]]);
  const shell = sidebarFixture("admin", { storage });
  await shell.mount();
  assert.equal(shell.classes.has("dark"), false);
  await shell.click("Switch to dark theme");
  assert.equal(shell.classes.has("dark"), true);
  assert.equal(storage.get("theme"), "dark");
  const remount = sidebarFixture("admin", { storage });
  await remount.mount();
  assert.equal(remount.classes.has("dark"), true);
  assert.ok(sidebarText(remount.render()).includes("ProctorShieldAI"));
  assert.ok(remount.requests.every(request => request.url.includes("scope=admin")));
  shell.unmount(); remount.unmount();
});

test("Admin data tables retain keyboard-accessible local scrolling", () => {
  for (const [file, label] of [["content.tsx", "Admin platform users"], ["users/content.tsx", "Admin user management"], ["quizzes/content.tsx", "Admin quiz directory"], ["logs/content.tsx", "Admin AI event logs"]]) {
    const source = fs.readFileSync("src/app/dashboard/admin/" + file, "utf8");
    assert.ok(source.includes(`role="region" aria-label="${label}" tabIndex={0}`));
    assert.match(source, /<table className="w-full">/);
  }
  assert.match(css, /\.ps-admin-table-scroll table \{min-width:45rem/);
  assert.match(css, /\.ps-admin-table-scroll \{max-width:100%/);
  assert.match(css, /\.ps-admin-pagination/);
  assert.ok(css.includes('.ps-admin-table-scroll table:has(td[colspan]) {min-width:0;'));
  assert.ok(css.includes('.ps-admin-table-scroll table:has(td[colspan]) thead {display:none;'));
});

test("Destructive and warning statuses retain their own semantic colors", () => {
  const ast = postcss.parse(css);
  const danger: string[] = []; ast.walkRules(rule => { if (rule.selector.includes('text-red-')) danger.push(rule.toString()); });
  assert.equal(danger.length, 1);
  assert.ok(danger[0].toString().includes("var(--ps-error)"));
  assert.match(css, /text-amber-[\s\S]*?color:var\(--ps-warning\)/);
  for (const file of ["content.tsx", "users/content.tsx"]) {
    const source = fs.readFileSync("src/app/dashboard/admin/" + file, "utf8");
    assert.match(source, /Suspend/); assert.match(source, /Restore/);
  }
});

test("Admin search, dialogs and profile controls have accessible names", () => {
  const user = fs.readFileSync("src/app/dashboard/admin/users/content.tsx", "utf8");
  assert.ok(user.includes('aria-label="Search users"'));
  assert.ok(user.includes('role="dialog" aria-modal="true" aria-labelledby="admin-user-heading"'));
  assert.ok(user.includes('aria-label="Close user details"'));
  assert.ok(user.includes('aria-label="AI Pro Subscription"'));
  const dashboard = fs.readFileSync("src/app/dashboard/admin/content.tsx", "utf8");
  assert.ok(dashboard.includes('htmlFor="admin-subscription-plan"'));
  assert.ok(dashboard.includes('id="admin-subscription-plan"'));
  const settings = fs.readFileSync("src/app/dashboard/admin/settings/content.tsx", "utf8");
  assert.ok(settings.includes('value="ProctorShieldAI" disabled'));
  assert.match(settings, /<button disabled[\s\S]*?Save Configuration/);
});

test("Demographic label wrapping changes only mobile row layout", () => {
  const rules: import("postcss").Rule[] = [];
  postcss.parse(css).walkRules(rule => { if (rule.selector.includes(".ps-admin-demographic-row")) rules.push(rule); });
  assert.equal(rules.length, 4);
  for (const rule of rules) {
    assert.equal(rule.parent?.type, "atrule");
    assert.equal((rule.parent as import("postcss").AtRule).params, "(max-width:639px)");
  }
  assert.ok(rules[0].toString().includes("minmax(0,1fr) minmax(3rem,1fr) 2rem"));
  assert.ok(rules[0].toString().includes("min-height:2.75rem"));
  const source = fs.readFileSync("src/app/dashboard/admin/content.tsx", "utf8");
  assert.equal((source.match(/ps-admin-demographic-row flex items-center gap-3/g) || []).length, 2);
  assert.ok(source.includes('style={{ width: '));
});
