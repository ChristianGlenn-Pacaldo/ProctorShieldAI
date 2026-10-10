import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { authPresentationMarkup } from "./helpers/auth-presentation-fixture.ts";
const require = createRequire(import.meta.url);
const postcss = require("postcss") as typeof import("postcss");

for (const role of ["student", "teacher"]) {
  for (const activePanel of ["login", "register"]) {
    test(role + " " + activePanel + " keeps associated labels and existing field constraints", () => {
      const html = authPresentationMarkup("src/app/login/" + role + "/page.tsx", { activePanel });
      const fields = activePanel === "login" ? ["login-email", "login-password"] : ["register-name", "register-email", "register-password", "register-confirm"];
      for (const field of fields) { assert.ok(html.includes('id="' + role + "-" + field + '"')); assert.ok(html.includes('for="' + role + "-" + field + '"')); }
      assert.match(html, /required=""/); assert.match(html, /ps-auth-primary/);
    });
  }
  test(role + " OTP has readable source-backed error, label and unchanged six-character limit", () => {
    const html = authPresentationMarkup("src/app/login/" + role + "/page.tsx", { mfaState: { isPending: true, userId: "qa", email: "qa@example.test", role }, error: "Please retry the latest code." });
    assert.ok(html.includes('for="' + role + '-otp"')); assert.match(html, /maxLength="6"/);
    assert.match(html, /role="alert"/); assert.match(html, /ps-auth-alert/); assert.match(html, /Verify &amp; Sign In/);
  });
}
for (const step of ["email", "reset", "done"]) {
  test("recovery " + step + " preserves current flow presentation", () => {
    const html = authPresentationMarkup("src/app/login/forgot-password/page.tsx", { step, email: "qa@example.test" });
    assert.match(html, /ps-auth-recovery/);
    assert.match(html, step === "email" ? /Send Verification Code/ : step === "reset" ? /Reset Password/ : /Password Reset!/);
    if (step === "reset") { assert.match(html, /for="recovery-code"/); assert.match(html, /maxLength="6"/); assert.match(html, /Hide password|Show password/); }
  });
}
test("loading and errors retain readable semantic classes and disable only the existing controls", () => {
  const html = authPresentationMarkup("src/app/login/content.tsx", { error: "Invalid email or password.", isLoading: true });
  assert.match(html, /role="alert"/); assert.match(html, /ps-auth-alert/); assert.match(html, /aria-busy="true"/); assert.match(html, /Signing in/); assert.match(html, /disabled=""/);
});
test("auth stylesheet cannot restyle unrelated routes and preserves contrast tokens and reduced motion", () => {
  const css = fs.readFileSync("src/app/login/auth.css", "utf8");
  postcss.parse(css).walkRules(rule => assert.ok(postcss.list.comma(rule.selector).every(selector => selector.includes(".ps-auth")), rule.selector));
  assert.ok(css.includes("var(--ps-error-soft)")); assert.ok(css.includes("var(--ps-border-control)")); assert.match(css, /prefers-reduced-motion/);
  postcss.parse(css).walkRules(rule => assert.doesNotMatch(rule.selector, /canvas|iframe|video|dashboard/));
});

test("visual reviews cannot ship as public HTML or alter the production login route", () => {
  assert.equal(fs.existsSync("public/design-phase-a-review.html"), false);
  assert.equal(fs.existsSync("src/app/login/design-review"), false);
  const login = fs.readFileSync("src/app/login/page.tsx", "utf8");
  assert.doesNotMatch(login, /_visualState|design-review/);
  assert.match(login, /getSession/);
});

for (const role of ["student", "teacher"]) {
  test(role + " authentication uses the official brand and factual face-detection copy", () => {
    for (const activePanel of ["login", "register"]) {
      const html = authPresentationMarkup("src/app/login/" + role + "/page.tsx", { activePanel });
      assert.match(html, /AI-Assisted Face Detection/);
      assert.doesNotMatch(html, /99%|Accurate Face Detection|ProctorShield AI|Proctor Shield/);
      assert.match(html, /ProctorShieldAI/);
    }
  });
  test(role + " registration exposes password requirements through associated helper text", () => {
    const html = authPresentationMarkup("src/app/login/" + role + "/page.tsx", { activePanel: "register" });
    const id = role + "-register-password-help";
    assert.ok(html.includes('aria-describedby="' + id + '"'));
    assert.ok(html.includes('id="' + id + '"'));
    assert.match(html, /placeholder="Create a password"/);
    assert.match(html, /10–128 characters, including letters and numbers./);
    assert.doesNotMatch(html, /placeholder="Min. 10/);
  });
}
test("reset password uses a concise placeholder and accessible existing-policy guidance", () => {
  const html = authPresentationMarkup("src/app/login/forgot-password/page.tsx", { step: "reset", email: "qa@example.test" });
  assert.match(html, /placeholder="New password"/);
  assert.match(html, /aria-describedby="new-password-help"/);
  assert.match(html, /id="new-password-help"/);
  assert.match(html, /10–128 characters, including letters and numbers./);
  assert.match(html, /ProctorShieldAI/);
  assert.doesNotMatch(html, /ProctorShield AI|placeholder="Min. 10/);
});
test("browser metadata uses the official product spelling", () => {
  assert.match(fs.readFileSync("src/app/layout.tsx", "utf8"), /title: "ProctorShieldAI — AI-Powered Online Proctoring"/);
});
