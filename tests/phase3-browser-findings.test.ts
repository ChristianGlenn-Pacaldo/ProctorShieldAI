import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { authFixture } from "./helpers/auth-fixture.ts";
import { authPresentationMarkup } from "./helpers/auth-presentation-fixture.ts";

test("E2E weak-registration expectation matches the real route, without persistence or session creation", async () => {
  const spec = fs.readFileSync("e2e/security-flows.spec.ts", "utf8");
  const scenario = spec.split('test("weak registrations are rejected before persistence"')[1].split('\ntest(')[0];
  const expected = scenario.match(/success: false, message: "([^"]+)"/)![1];
  assert.match(scenario, /expect\(response.status\(\)\).toBe\(400\)/);
  const f = authFixture();
  const before = JSON.stringify([...f.users]);
  const response = await f.post("auth/register", { fullName: "TEST USER", email: "weak-password@example.test", password: "weak", confirmPassword: "weak", role: "student" });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, message: expected });
  assert.equal(JSON.stringify([...f.users]), before);
  assert.equal(f.cookies.size, 0);
  assert.equal(f.logs.length, 0);
});

test("Teacher password row permits wrapping while retaining its associated label and portal link", () => {
  const html = authPresentationMarkup("src/app/login/teacher/page.tsx");
  assert.match(html, /flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1\.5/);
  assert.match(html, /for="teacher-login-password"/);
  assert.match(html, /href="\/login\/forgot-password\?role=teacher"/);
  assert.match(html, /Forgot password\?/);
  assert.match(html, /id="teacher-login-password" type="password"/);
});

for (const role of ["student", "teacher"]) for (const step of ["email", "reset", "done"]) {
  test(`${role} recovery ${step}: exact branding, naturally wrappable content and preserved role destination`, () => {
    const html = authPresentationMarkup("src/app/login/forgot-password/page.tsx", { step, email: "qa@example.test" }, role);
    assert.match(html, /w-full max-w-md \[overflow-wrap:anywhere\]/);
    assert.match(html, />ProctorShieldAI<\/h1>/);
    assert.match(html, /\/images\/proctorshieldai-shield-transparent\.png/);
    if (step !== "reset") assert.ok(html.includes(`href="/login/${role}"`));
    if (step === "reset") {
      assert.match(html, />Enter verification code<\/h2>/);
      assert.match(html, /id="recovery-code"/);
      assert.match(html, /maxLength="6"/);
      assert.match(html, /aria-controls="new-password confirm-new-password"/);
      assert.match(html, /type="button" aria-label="Show password"/);
      assert.match(html, /absolute inset-y-0 right-0 px-4/);
      assert.match(html, /w-full pl-10 pr-12 py-3/);
    }
  });
}

test("Recovery visibility state still controls both fields, with existing keyboard focus and minimum target rules", () => {
  const html = authPresentationMarkup("src/app/login/forgot-password/page.tsx", { step: "reset", showPassword: true });
  assert.match(html, /id="new-password" type="text"/);
  assert.match(html, /id="confirm-new-password" type="text"/);
  assert.match(html, /aria-label="Hide password"/);
  const css = fs.readFileSync("src/app/login/auth.css", "utf8");
  assert.match(css, /\[class\*="inset-y-0"\]\[type="button"\] \{ min-width: 44px; min-height: 44px;/);
  assert.match(css, /:focus-visible \{[\s\S]*?outline:/);
});
