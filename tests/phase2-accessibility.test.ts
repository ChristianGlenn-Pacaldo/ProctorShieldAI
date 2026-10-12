import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { authPresentationMarkup } from "./helpers/auth-presentation-fixture.ts";

for (const activePanel of ["login", "register"]) for (const pending of [false, true]) test(`Student ${activePanel} / OTP ${pending}: both labels wrap independently of nonshrinking icons`, () => {
  const html = authPresentationMarkup("src/app/login/student/page.tsx", { activePanel, mfaState: { isPending: pending, userId: "fixture", email: "qa@example.test", role: "student" } });
  assert.match(html, /ps-auth-student-tabs/);
  assert.match(html, /<span>Sign In<\/span>/); assert.match(html, /<span>Create Account<\/span>/);
  const css = fs.readFileSync("src/app/login/auth.css", "utf8");
  assert.match(css, /ps-auth-student-tabs > button > svg \{ flex-shrink: 0;/);
  assert.match(css, /ps-auth-student-tabs > button > span \{ min-width: 0; overflow-wrap: anywhere;/);
  assert.match(css, /repeat\(auto-fit, minmax\(min\(100%, calc\(4ch \+ 3rem\)\), 1fr\)\)/);
  assert.doesNotMatch(css.split("/* Flexible labels")[1], /nowrap|overflow:\s*hidden|font-size:/);
});
test("all five password hints match the byte policy and no longer advertise 128 characters", () => {
  for (const file of ["src/app/login/student/page.tsx", "src/app/login/teacher/page.tsx", "src/app/login/forgot-password/page.tsx", "src/app/dashboard/student/settings/content.tsx", "src/app/dashboard/teacher/settings/content.tsx"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /At least 10 characters with letters and numbers\. Maximum 72 UTF-8 bytes; some characters use more than one byte\./);
    assert.doesNotMatch(source, /10–128/);
  }
});
test("Teacher Create/Upload group can wrap within its container and keeps icon/touch dimensions", () => {
  const source = fs.readFileSync("src/components/teacher/proctorshield-create-hub.tsx", "utf8");
  assert.match(source, /inline-flex max-w-full flex-wrap justify-center/);
  assert.equal((source.match(/max-w-full min-h-\[44px\] flex-wrap/g) || []).length, 2);
  assert.match(source, /<Upload className="w-4 h-4 shrink-0"/); assert.match(source, /<Plus className="w-4 h-4 shrink-0"/);
});
