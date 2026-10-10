import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { authPresentationMarkup } from "./helpers/auth-presentation-fixture.ts";
const require = createRequire(import.meta.url);
const postcss = require("postcss") as typeof import("postcss");
const css = fs.readFileSync("src/app/login/auth-glass.css", "utf8");

// Cached App Router CSS must not restyle another portal, media or assessment.
test("authentication glass is explicitly opted in and changes paint properties only", () => {
  const ast = postcss.parse(css);
  ast.walkRules(rule => {
    for (const selector of postcss.list.comma(rule.selector)) {
      assert.ok(selector.includes(".ps-auth.ps-auth-glass"), selector);
      assert.doesNotMatch(selector, /dashboard|student|teacher|admin|video|canvas|iframe|input|button|table/);
    }
  });
  ast.walkDecls(decl => assert.ok(decl.prop.startsWith("--ps-auth-glass-") ||
    ["background", "border-color", "box-shadow", "backdrop-filter", "-webkit-backdrop-filter"].includes(decl.prop), decl.prop));
  assert.doesNotMatch(css, /@keyframes|animation\s*:|transition\s*:|position\s*:|pointer-events\s*:|content\s*:/);
  const layout = fs.readFileSync("src/app/login/layout.tsx", "utf8");
  assert.match(layout, /import "\.\/auth-glass\.css"/);
  assert.match(layout, /className="ps-auth ps-auth-glass"/);
  assert.match(layout, /<AuthThemeControl \/>\{children\}/);
});

test("auth glass removes the opaque card backing while keeping form and status surfaces", () => {
  const ast = postcss.parse(css);
  const cards: string[] = [];
  ast.walkRules(rule => {
    if (rule.selector.includes(".auth-panel") && rule.selector.includes(".ps-auth-card") && !rule.selector.includes(".ps-auth-theme")) {
      rule.walkDecls("background", decl => cards.push(decl.value));
    }
  });
  assert.equal(cards.length, 1);
  assert.match(cards[0], /var\(--ps-auth-glass-fill\)$/);
  assert.doesNotMatch(cards[0], /,\s*var\(--ps-surface\)$/);
  const controls = fs.readFileSync("src/app/login/auth.css", "utf8");
  assert.match(controls, /:where\(input, select, textarea\)\s*\{[^}]*background: var\(--ps-surface\) !important/);
  assert.match(controls, /\.ps-auth-primary\s*\{[^}]*background: var\(--ps-primary\) !important/);
  assert.match(controls, /\.ps-auth-alert\s*\{[^}]*background: var\(--ps-error-soft\)/);
  assert.match(controls, /focus-visible\s*\{[^}]*outline:/);
});

test("auth glass uses shared theme tokens with mobile cost bounds and a readable no-blur fallback", () => {
  assert.match(css, /html\.dark \.ps-auth\.ps-auth-glass/);
  assert.match(css, /--ps-auth-glass-blur:10px/);
  assert.match(css, /@media\(max-width:767px\)/);
  assert.match(css, /--ps-auth-glass-blur:4px/);
  assert.match(css, /var\(--ps-surface\) 86%,transparent/);
  assert.match(css, /var\(--ps-surface\) 84%,transparent/);
  assert.match(css, /@supports not \(\(backdrop-filter:blur\(1px\)\) or \(-webkit-backdrop-filter:blur\(1px\)\)\)/);
  assert.match(css, /\.ps-auth-theme \{background:var\(--ps-surface\) !important;/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|localStorage|@import|url\(/i);
});

test("all role login, registration and OTP cards share the opt-in material without new flows", () => {
  for (const role of ["student", "teacher"]) {
    const file = `src/app/login/${role}/page.tsx`;
    for (const overrides of [
      { activePanel: "login" },
      { activePanel: "register" },
      { mfaState: { isPending: true, userId: "qa", email: "qa@example.test", role } },
    ]) {
      // Source-backed state fixtures do not run effects or submit requests.
      const html = authPresentationMarkup(file, overrides, role);
      assert.match(html, /class="[^"]*auth-shell/);
      assert.match(html, /class="[^"]*auth-panel/);
      assert.match(html, /ps-auth-primary/);
      assert.doesNotMatch(html, /style="[^"]*backdrop-filter/);
    }
  }
});

test("unified login and recovery state cards receive glass without replacing Google or recovery logic", () => {
  for (const overrides of [{}, { isLoading: true }, { error: "Please retry." }]) {
    const html = authPresentationMarkup("src/app/login/content.tsx", overrides);
    assert.match(html, /class="[^"]*ps-auth-card/);
  }
  for (const step of ["email", "reset", "done"]) {
    const html = authPresentationMarkup("src/app/login/forgot-password/page.tsx", { step, email: "qa@example.test" });
    assert.match(html, /class="[^"]*auth-panel/);
    assert.match(html, /ps-auth-recovery/);
  }
  const google = fs.readFileSync("src/app/login/unified-google-signin.tsx", "utf8");
  assert.match(google, /GoogleOAuthProvider/);
  assert.doesNotMatch(google, /ps-auth-glass/);
});
