import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { isArenaQuiz, isProctoredQuiz } from "../src/lib/quiz-mode.ts";

const arenaPageSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/arena/[id]/page.tsx"),
  "utf-8"
);
const arenaContentSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/arena/[id]/content.tsx"),
  "utf-8"
);
const arenaDockSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/arena/arena-battle-dock.tsx"),
  "utf-8"
);
const arenaPodiumSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/arena/arena-podium.tsx"),
  "utf-8"
);
const arenaBattleActionSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/arena/battle-action/route.ts"),
  "utf-8"
);
const pusherAuthSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/pusher/auth/route.ts"),
  "utf-8"
);
const quizzesSessionSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/quizzes/session/route.ts"),
  "utf-8"
);

test("Test A & B: Arena route only accepts quizMode 'arena' and safely redirects proctored quizzes", () => {
  // Mode helpers enforce single source of truth
  assert.equal(isArenaQuiz({ quizMode: "arena" }), true);
  assert.equal(isArenaQuiz({ quizMode: "proctored" }), false);
  assert.equal(isProctoredQuiz({ quizMode: "proctored" }), true);
  assert.equal(isProctoredQuiz({ quizMode: "arena" }), false);

  // Server page checks quiz.quizMode and redirects to /quiz/[id] if not arena
  assert.match(arenaPageSrc, /if\s*\(\s*quiz\.quizMode\s*!==\s*["']arena["']\s*\)/);
  assert.match(arenaPageSrc, /redirect\(\s*`\/quiz\/\${quizId}`\s*\)/);
});

test("Test C: Arena gameplay does not call device preflight (/api/quizzes/session rejects arena quizzes)", () => {
  // Arena client never invokes device preflight
  assert.equal(arenaContentSrc.includes("/api/quizzes/session"), false);
  assert.equal(arenaPageSrc.includes("/api/quizzes/session"), false);

  // Backend session route explicitly rejects arena quizzes
  assert.match(quizzesSessionSrc, /if\s*\(\s*quiz\.quizMode\s*===\s*["']arena["']\s*\)/);
  assert.match(quizzesSessionSrc, /PREFLIGHT_NOT_APPLICABLE/);
});

test("Test D: Arena gameplay contains no webcam/microphone initialization or AI proctoring", () => {
  const allArenaSources = [arenaPageSrc, arenaContentSrc, arenaDockSrc, arenaPodiumSrc].join("\n");

  const prohibitedPatterns = [
    "getUserMedia",
    "navigator.mediaDevices",
    "RTCPeerConnection",
    "face-api",
    "tensorflow",
    "coco-ssd",
    "COCO_MODEL",
    "audioAnomaly",
    "gazeStatus",
    "faceStatus",
  ];

  for (const pattern of prohibitedPatterns) {
    assert.equal(
      allArenaSources.includes(pattern),
      false,
      `Prohibited pattern "${pattern}" was found in Arena client code`
    );
  }
});

test("Test E: Arena actions reject proctored attempts with INVALID_QUIZ_MODE", () => {
  // Verify battle-action route enforces quizMode === 'arena' and attemptMode === 'arena'
  assert.match(arenaBattleActionSrc, /attempt\.quiz\.quizMode\s*!==\s*["']arena["']/);
  assert.match(arenaBattleActionSrc, /attempt\.attemptMode\s*!==\s*["']arena["']/);
  assert.match(arenaBattleActionSrc, /INVALID_QUIZ_MODE/);
});

test("Test F: Arena realtime events strictly use Arena channel/event namespace", () => {
  // Arena client subscribes to private-arena-${quizId}
  assert.match(arenaContentSrc, /subscribe\(`private-arena-\${quizId}`\)/);

  // Arena client does NOT subscribe to teacher warning channel
  assert.equal(arenaContentSrc.includes("private-student-"), false);
  assert.equal(arenaContentSrc.includes("teacher-warning"), false);

  // Pusher auth authorizes private-arena channels specifically
  assert.match(pusherAuthSrc, /private-\(quiz\|arena\)-\(\\d\+\)/);
  assert.match(pusherAuthSrc, /attemptMode:\s*["']arena["']/);
});

test("Test G: Tab switching/blur does not generate violations for Arena", () => {
  const allArenaSources = [arenaPageSrc, arenaContentSrc, arenaDockSrc, arenaPodiumSrc].join("\n");

  const violationPatterns = [
    "visibilitychange",
    "window.onblur",
    "window.blur",
    "fullscreenchange",
    "PrintScreen",
    "reportViolation",
    "/api/live/violation",
  ];

  for (const pattern of violationPatterns) {
    assert.equal(
      allArenaSources.includes(pattern),
      false,
      `Violation pattern "${pattern}" must not be present in Arena Game Station`
    );
  }
});
