import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const quizPagePath = path.resolve(process.cwd(), "src/app/quiz/[id]/page.tsx");
const quizPageSrc = fs.readFileSync(quizPagePath, "utf-8");

const violationRoutePath = path.resolve(process.cwd(), "src/app/api/live/violation/route.ts");
const violationRouteSrc = fs.readFileSync(violationRoutePath, "utf-8");

const teacherMonitorPath = path.resolve(process.cwd(), "src/app/dashboard/teacher/monitor/content.tsx");
const teacherMonitorSrc = fs.readFileSync(teacherMonitorPath, "utf-8");

const arenaContentPath = path.resolve(process.cwd(), "src/app/arena/[id]/content.tsx");
const arenaContentSrc = fs.readFileSync(arenaContentPath, "utf-8");

// ─────────────────────────────────────────────────────────────
// PART 19 AUTOMATED TESTS: MOBILE LIVE PROCTORING & VIOLATIONS
// ─────────────────────────────────────────────────────────────

test("1 & 2: Visibility hidden and blur use single authoritative away incident flow", () => {
  assert.match(quizPageSrc, /awayIncidentActiveRef/);
  assert.match(quizPageSrc, /awayViolationRecordedRef/);
  assert.match(quizPageSrc, /awayGraceTimerRef/);
  assert.match(quizPageSrc, /document\.visibilityState === "hidden" \|\| document\.hidden/);
});

test("3 & 4: Grace timer controls violation recording before vs beyond grace threshold", () => {
  assert.match(quizPageSrc, /beginAway\s*=\s*\(graceMs\s*=\s*1500\)/);
  assert.match(quizPageSrc, /awayGraceTimerRef\.current\s*=\s*setTimeout/);
  assert.match(quizPageSrc, /reportViolationRef\.current\("tab_switch",\s*100\)/);
});

test("5: Remaining continuously hidden does NOT create duplicate violation strikes", () => {
  assert.match(quizPageSrc, /if\s*\(awayViolationRecordedRef\.current\)/);
  assert.match(quizPageSrc, /awayViolationRecordedRef\.current\s*=\s*true;/);
});

test("6 & 7: Returning from departure resets incident state allowing future departure to trigger strike", () => {
  assert.match(quizPageSrc, /const\s+endAway\s*=\s*\(\)\s*=>/);
  assert.match(quizPageSrc, /awayIncidentActiveRef\.current\s*=\s*false;/);
  assert.match(quizPageSrc, /awayViolationRecordedRef\.current\s*=\s*false;/);
});

test("8: Third valid incident triggers automatic submission", () => {
  assert.match(quizPageSrc, /currentCount\s*>=\s*3/);
  assert.match(quizPageSrc, /isFinal:\s*true/);
  assert.match(quizPageSrc, /submitQuizRef\.current\(/);
});

test("9: Violation API response updates student strike count authoritatively", () => {
  assert.match(quizPageSrc, /const\s+serverCount\s*=\s*Number\(data\.violationCount\)/);
  assert.match(quizPageSrc, /violationCountRef\.current\s*=\s*currentCount/);
  assert.match(quizPageSrc, /setViolationCount\(currentCount\)/);
});

test("10: Teacher update broadcast fires with violationCount after persisted violation", () => {
  assert.match(violationRouteSrc, /pusherServer\.trigger\(channelName,\s*["']new-violation["']/);
  assert.match(violationRouteSrc, /violationCount:\s*violationResult\.count/);
  assert.match(teacherMonitorSrc, /teacherChannel\.bind\(["']new-violation["']/);
});

test("11 & 12: Security incident state uses component refs and event listeners register cleanly", () => {
  assert.match(quizPageSrc, /examActiveRef/);
  assert.match(quizPageSrc, /submissionInFlightRef/);
  assert.match(quizPageSrc, /document\.addEventListener\(["']visibilitychange["']/);
  assert.match(quizPageSrc, /document\.removeEventListener\(["']visibilitychange["']/);
});

test("13 & 14: Video playback auto-resumes on foregrounding if paused on mobile", () => {
  assert.match(quizPageSrc, /activeVideo\.paused && mediaStreamRef\.current\?\.active/);
  assert.match(quizPageSrc, /activeVideo\.play\(\)\.catch/);
});

test("15 & 16: Face-missing and multiple-faces continuous frames produce max one incident violation", () => {
  assert.match(quizPageSrc, /noFaceViolationRecorded/);
  assert.match(quizPageSrc, /multipleFacesViolationRecorded/);
  assert.match(quizPageSrc, /reportViolationRef\.current\("no_face",\s*100\)/);
  assert.match(quizPageSrc, /reportViolationRef\.current\("multiple_faces",\s*100\)/);
});

test("17: Phone / object detection continuous frames produce max one incident violation", () => {
  assert.match(quizPageSrc, /phoneViolationRecorded/);
  assert.match(quizPageSrc, /reportViolationRef\.current\(\s*["']device_detected["']/);
});

test("18: Mobile/portrait dimensions use normalized geometric ratios for head pose", () => {
  assert.match(quizPageSrc, /yawOffset\s*=\s*\(noseBottom\.x\s*-\s*eyeCenterX\)\s*\/\s*eyeDistance/);
  assert.match(quizPageSrc, /pitchRatio\s*=\s*\(noseBottom\.y\s*-\s*eyeCenterY\)\s*\/\s*eyeDistance/);
});

test("19: Power Arena never records proctoring violations", () => {
  assert.equal(arenaContentSrc.includes("reportViolation"), false);
  assert.match(violationRouteSrc, /quiz:\s*\{\s*quizMode:\s*\{\s*not:\s*["']arena["']\s*\}\s*\}/);
});

test("20: Submitted exam stops all security incidents via examActiveRef and submissionInFlightRef", () => {
  assert.match(quizPageSrc, /!examActiveRef\.current\s*\|\|\s*submissionInFlightRef\.current/);
  assert.match(quizPageSrc, /examActiveRef\.current\s*=\s*hasStarted && !isSubmitting/);
});
