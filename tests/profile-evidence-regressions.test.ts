import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { normalizeStudentName, requiresStudentNameSetup } from "../src/lib/student-name.ts";

test("student name setup rejects placeholders and informal registration names", () => {
  for (const value of ["", "Student", "Student User", "Google User", "QA Fresh Student", "Proctor"]) {
    assert.equal(requiresStudentNameSetup(value), true, value);
  }
  assert.equal(requiresStudentNameSetup("DELA CRUZ, JUAN, SANTOS"), false);
  assert.equal(requiresStudentNameSetup("REYES, MARIA"), false);
  assert.equal(normalizeStudentName("  Dela Cruz ,  Juan , Santos  "), "DELA CRUZ, JUAN, SANTOS");
});

test("evidence replay escapes dashboard stacking contexts and exposes honest media states", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/dashboard/teacher/evidence/content.tsx"),
    "utf8",
  );
  assert.match(source, /createPortal\(/);
  assert.match(source, /Loading evidence\.\.\./);
  assert.match(source, /Evidence could not be loaded/);
  assert.match(source, />\s*Retry/);
  assert.match(source, /No evidence available/);
  assert.match(source, /mediaStatus !== "ready"/);
});

test("evidence storage requests are bounded before database fallback", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/evidence-storage.ts"),
    "utf8",
  );
  assert.match(source, /maxAttempts: 1/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), storageRequestTimeoutMs\)/);
  assert.match(source, /send\(controller\.signal\)/);
});
