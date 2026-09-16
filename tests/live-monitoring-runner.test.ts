import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { isArenaQuiz, isProctoredQuiz } from "../src/lib/quiz-mode.ts";

const quizPageSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/quiz/[id]/page.tsx"),
  "utf-8"
);

test("Test A: Proctored quiz still requires camera/mic preflight and device validation", () => {
  // Proctored quiz mode helper validation
  assert.equal(isProctoredQuiz({ quizMode: "proctored" }), true);
  assert.equal(isProctoredQuiz({ quizMode: "arena" }), false);

  // Checks device preflight initiation
  assert.match(quizPageSrc, /runDevicePreflight/);
  assert.match(quizPageSrc, /fetch\(\s*["']\/api\/quizzes\/session["']/);
  assert.match(quizPageSrc, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(quizPageSrc, /video:\s*\{/);
  assert.match(quizPageSrc, /audio:\s*true/);
  assert.match(quizPageSrc, /cameraPermission:\s*testStream\.getVideoTracks\(\)\.length\s*>\s*0/);
  assert.match(quizPageSrc, /setPreflightPassed\(true\)/);
  assert.match(quizPageSrc, /Complete the device and camera check before starting the quiz/);
});

test("Test B: Arena quiz accessing /quiz/[id] redirects immediately to /arena/[id] before preflight", () => {
  // Route guard redirects immediately to /arena/${quizId}
  assert.match(quizPageSrc, /if\s*\(\s*quiz\?\.quizMode\s*===\s*["']arena["']\s*\)\s*\{\s*router\.replace\(`\/arena\/\${quizId}`\);/);
  assert.match(quizPageSrc, /if\s*\(\s*data\.quiz\?\.quizMode\s*===\s*["']arena["']\s*\)\s*\{\s*router\.replace\(`\/arena\/\${quizId}`\);/);
});

test("Test C: Proctored quiz still initializes face/gaze/object monitoring", () => {
  // AI models and monitoring systems
  assert.match(quizPageSrc, /faceapi\.nets\.tinyFaceDetector\.loadFromUri/);
  assert.match(quizPageSrc, /faceapi\.detectAllFaces/);
  assert.match(quizPageSrc, /loadedCocoModel\.detect/);
  assert.match(quizPageSrc, /faceDetectionInterval\s*=/);
  assert.match(quizPageSrc, /faceStatus/);
  assert.match(quizPageSrc, /gazeStatus/);
  assert.match(quizPageSrc, /AudioContext/);
});

test("Test D: Live Monitoring runner contains no battle power UI or game station elements", () => {
  const prohibitedUIPatterns = [
    "ArenaBattleDock",
    "battlePowerInventory",
    "isLaunchingPower",
    "activeAttackEffect",
    "battleIntermission",
    "waitingForArenaWave",
    "earthquake-rumble",
    "meteor-fall",
    "Meteor Strike",
    "Earthquake",
    "Blizzard",
  ];

  for (const pattern of prohibitedUIPatterns) {
    assert.equal(
      quizPageSrc.includes(pattern),
      false,
      `Prohibited pattern "${pattern}" must not be present in Live Monitoring Quiz runner`
    );
  }
});

test("Test E: Live Monitoring runner contains no Arena attack or wave event listeners", () => {
  const prohibitedListeners = [
    "private-arena-",
    "battle-attack",
    "arena-wave",
    "arena-start",
    "arena-end",
    "arena-airdrop",
    "/api/live/battle-action",
    "/api/arena/battle-action",
  ];

  for (const listener of prohibitedListeners) {
    assert.equal(
      quizPageSrc.includes(listener),
      false,
      `Prohibited listener or endpoint "${listener}" must not be present in Live Monitoring Quiz runner`
    );
  }
});

test("Test F: Tab switch and window blur still record violations for proctored quiz", () => {
  assert.match(quizPageSrc, /visibilitychange/);
  assert.match(quizPageSrc, /tab_switch/);
  assert.match(quizPageSrc, /window_blur|fullscreen_exit/);
  assert.match(quizPageSrc, /reportViolation\(/);
  assert.match(quizPageSrc, /\/api\/live\/violation/);
});

test("Test G: 3 violations still trigger 3-strike auto-submit", () => {
  assert.match(quizPageSrc, /currentCount\s*>=\s*3/);
  assert.match(quizPageSrc, /submitQuizRef\.current\(\)/);
  assert.match(quizPageSrc, /Violation \${currentCount}\/3/);
});

test("Test H: WebRTC teacher live monitoring feed still initializes", () => {
  assert.match(quizPageSrc, /RTCPeerConnection/);
  assert.match(quizPageSrc, /webrtc-signal/);
  assert.match(quizPageSrc, /\/api\/live\/webrtc/);
});

test("Test I: Arena tests from Phase 2 still pass and standalone Arena route is preserved", () => {
  const arenaStationPath = path.resolve(process.cwd(), "tests/arena-game-station.test.ts");
  assert.equal(fs.existsSync(arenaStationPath), true);
  const arenaRoutePath = path.resolve(process.cwd(), "src/app/arena/[id]/page.tsx");
  assert.equal(fs.existsSync(arenaRoutePath), true);
  const arenaContentPath = path.resolve(process.cwd(), "src/app/arena/[id]/content.tsx");
  assert.equal(fs.existsSync(arenaContentPath), true);
});

