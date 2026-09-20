import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { parseQuizMode, canChangeQuizMode, InvalidQuizModeError } from "../src/lib/quiz-mode.ts";

const createHubSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/teacher/proctorshield-create-hub.tsx"),
  "utf-8"
);
const quizEditorSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/teacher/proctorshield-quiz-editor.tsx"),
  "utf-8"
);
const teacherQuizzesSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/teacher/quizzes/content.tsx"),
  "utf-8"
);
const arenaRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/arena/[id]/page.tsx"),
  "utf-8"
);
const proctoredRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/quiz/[id]/page.tsx"),
  "utf-8"
);
const submitRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/quizzes/submit/route.ts"),
  "utf-8"
);
const teacherReportsRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/dashboard/teacher/reports/route.ts"),
  "utf-8"
);
const studentResultsRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/dashboard/student/results/route.ts"),
  "utf-8"
);
const joinRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/join/page.tsx"),
  "utf-8"
);
const studentDashboardSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/student/content.tsx"),
  "utf-8"
);

test("Test A: Teacher creation UI saves correct quizMode", () => {
  // Create Hub provides distinct mode triggers
  assert.match(createHubSrc, /onOpenCreateQuiz\("proctored"\)/);
  assert.match(createHubSrc, /onOpenCreateQuiz\("arena"\)/);

  // Quiz Editor accepts quizMode and passes it in the save payload
  assert.match(quizEditorSrc, /quizMode:\s*quizForm\.quizMode/);
  assert.match(quizEditorSrc, /handleToggleMode\("proctored"\)/);
  assert.match(quizEditorSrc, /handleToggleMode\("arena"\)/);

  // Verify parseQuizMode safely resolves both modes
  assert.equal(parseQuizMode("arena"), "arena");
  assert.equal(parseQuizMode("proctored"), "proctored");
  assert.equal(parseQuizMode(undefined), "proctored");
});

test("Test B: Arena creation never enables proctoring automatically", () => {
  // Check that Arena mode has zero proctoring controls in settings modal
  const arenaSettingsSection = quizEditorSrc.slice(
    quizEditorSrc.indexOf('{quizForm.quizMode === "arena" && (')
  );
  assert.equal(arenaSettingsSection.includes("WebRTC"), false);
  assert.equal(arenaSettingsSection.includes("cam monitor"), false);
  assert.equal(arenaSettingsSection.includes("face-api"), false);
  assert.match(arenaSettingsSection, /Camera, microphone, and AI cheating checks are completely disabled/i);
});

test("Test C: Live Exam creation never enables Arena mechanics", () => {
  // Proctored mode settings must NOT include battle powers or game mechanics
  const proctoredSettingsSection = quizEditorSrc.slice(
    quizEditorSrc.indexOf('{quizForm.quizMode === "proctored" && ('),
    quizEditorSrc.indexOf('{quizForm.quizMode === "arena" && (')
  );
  assert.equal(proctoredSettingsSection.includes("Battle Powers"), false);
  assert.equal(proctoredSettingsSection.includes("meteors, earthquakes"), false);
  assert.equal(proctoredSettingsSection.includes("Guardian Shield"), false);
  assert.match(proctoredSettingsSection, /No game boosters or score multipliers are permitted/i);
});

test("Test D: Mode switching is rejected after attempts exist", () => {
  // Backend validation: attemptsCount > 0 prevents mode change
  const attemptCheck = canChangeQuizMode({
    currentMode: "proctored",
    targetMode: "arena",
    attemptsCount: 3,
    quizStatus: "draft",
  });
  assert.equal(attemptCheck.allowed, false);
  assert.equal(attemptCheck.code, "QUIZ_MODE_CHANGE_NOT_ALLOWED");

  // Frontend safety lock
  assert.match(quizEditorSrc, /isModeLocked/);
  assert.match(quizEditorSrc, /Quiz mode cannot be changed after students have joined or attempted this quiz/);
});

test("Test E: Full Arena route lifecycle remains separated", () => {
  // Arena runner contains no camera, microphone, or AI proctoring APIs
  assert.equal(arenaContentSrc.includes("getUserMedia"), false);
  assert.equal(arenaContentSrc.includes("RTCPeerConnection"), false);
  assert.equal(arenaContentSrc.includes("face-api"), false);
  assert.equal(arenaContentSrc.includes("coco-ssd"), false);
  assert.equal(arenaContentSrc.includes("reportViolation"), false);
  assert.equal(arenaContentSrc.includes("teacher-warning"), false);

  // Subscribes strictly to Arena realtime namespace
  assert.match(arenaContentSrc, /private-arena-\$\{/);
  assert.equal(arenaContentSrc.includes("private-quiz-"), false);
});

test("Test F: Full Proctored route lifecycle remains separated", () => {
  // Proctored runner contains camera preflight, face tracking, and violation monitoring
  assert.match(proctoredRouteSrc, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(proctoredRouteSrc, /reportViolation/);
  assert.match(proctoredRouteSrc, /violationCount/);
  assert.match(proctoredRouteSrc, /warningModal/);

  // Proctored runner contains NO Arena mechanics
  assert.equal(proctoredRouteSrc.includes("arena-start"), false);
  assert.equal(proctoredRouteSrc.includes("arena-wave"), false);
  assert.equal(proctoredRouteSrc.includes("arena-airdrop"), false);
  assert.equal(proctoredRouteSrc.includes("Meteor"), false);
  assert.equal(proctoredRouteSrc.includes("Earthquake"), false);
  assert.equal(proctoredRouteSrc.includes("Blizzard"), false);
  assert.equal(proctoredRouteSrc.includes("Guardian Shield"), false);
});

test("Test G & H: Arena result excluded from integrity report and Proctored included", () => {
  // Teacher integrity report query filters exclusively by attemptMode: "proctored"
  assert.match(teacherReportsRouteSrc, /attemptMode:\s*["']proctored["']/);
  assert.equal(teacherReportsRouteSrc.includes('attemptMode: "arena"'), false);
});

test("Test I: Historical attemptMode precedence remains authoritative", () => {
  // When Quiz is changed or legacy, studentQuiz.attemptMode determines submission & results
  assert.match(
    submitRouteSrc,
    /const effectiveMode =\s*studentQuiz\.attemptMode === ["']arena["'] \? ["']arena["'] : ["']proctored["']/
  );
  assert.match(
    studentResultsRouteSrc,
    /attemptMode === ["']arena["']/
  );
});

const arenaContentSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/arena/[id]/content.tsx"),
  "utf-8"
);

test("Test J: No cross-mode realtime events", () => {
  // Arena host and student listen only to arena namespace
  assert.match(arenaContentSrc, /arena-wave/);
  assert.match(arenaContentSrc, /arena-start/);
  assert.match(arenaContentSrc, /arena-airdrop/);
  assert.match(arenaContentSrc, /battle-attack/);
  assert.match(arenaContentSrc, /arena-end/);

  // Proctored quiz listens only to quiz-started and private-student
  assert.match(proctoredRouteSrc, /quiz-started/);
  assert.match(proctoredRouteSrc, /teacher-warning/);
});

test("Test K: Wrong direct route redirects correctly", () => {
  // If proctored quiz is accessed via /arena/[id], server component redirects to /quiz/[id]
  assert.match(arenaRouteSrc, /redirect\(`\/quiz\/\$\{quizId\}`\)/);

  // If arena quiz is accessed via /quiz/[id], client runner redirects to /arena/[id]
  assert.match(proctoredRouteSrc, /router\.replace\(`\/arena\/\$\{/);
});

test("Test L: EXP remains the only active student progression reward", () => {
  assert.match(submitRouteSrc, /awardStudentExp/);
  assert.equal(submitRouteSrc.includes("studentCoinLedger"), false);
  assert.equal(submitRouteSrc.includes("coinsEarned"), false);
});
