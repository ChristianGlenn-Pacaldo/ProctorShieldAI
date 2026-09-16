import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const teacherHostSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/teacher/playground/arena/[id]/content.tsx"),
  "utf-8"
);
const arenaRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/arena/[id]/route.ts"),
  "utf-8"
);
const arenaStationSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/arena/[id]/content.tsx"),
  "utf-8"
);
const proctoredRunnerSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/quiz/[id]/page.tsx"),
  "utf-8"
);

test("Bug 1 Test A: Teacher Start Arena button calls correct Arena API action 'start'", () => {
  // Verifies handleStartMatch dispatches action: "start" via broadcastArenaAction
  assert.match(
    teacherHostSrc,
    /broadcastArenaAction\(\s*["']start["'],\s*\{[\s\S]*?mode,[\s\S]*?waveDuration,[\s\S]*?coinBounty,[\s\S]*?enabledPowers/
  );

  // Verifies broadcastArenaAction performs POST to /api/arena/${quiz.id}
  assert.match(
    teacherHostSrc,
    /fetch\(`\/api\/arena\/\${quiz\.id}`,\s*\{[\s\S]*?method:\s*["']POST["']/
  );
});

test("Bug 1 Test B: /api/arena/[id] allows starting quizzes in draft, active, and in_progress states", () => {
  // Verifies status guard allows draft quizzes (waiting room)
  assert.match(
    arenaRouteSrc,
    /!\[["']draft["'],\s*["']active["'],\s*["']in_progress["']\]\.includes\(quiz\.quizStatus\)/
  );

  // Verifies claiming transitions draft and active quizzes into in_progress
  assert.match(
    arenaRouteSrc,
    /where:\s*\{[\s\S]*?quizStatus:\s*\{\s*in:\s*\[["']draft["'],\s*["']active["']\]\s*\}\s*\},[\s\S]*?data:\s*\{\s*quizStatus:\s*["']in_progress["']\s*\}/
  );

  // Verifies enrolled student attempts are transitioned to in_progress
  assert.match(
    arenaRouteSrc,
    /where:\s*\{[\s\S]*?quizStatus:\s*\{\s*in:\s*\[["']enrolled["'],\s*["']pending_approval["']\]\s*\}\s*\},[\s\S]*?data:\s*\{\s*quizStatus:\s*["']in_progress["'],\s*startTime:\s*startedAt\s*\}/
  );
});

test("Bug 1 Test C: arena-start is broadcast on private-arena-${quizId} with state and duration", () => {
  // Broadcasts arena-start on private-arena-${quizId}
  assert.match(
    arenaRouteSrc,
    /pusherServer\.trigger\(`private-arena-\${quizId}`,\s*event,\s*eventData\)/
  );
  assert.match(arenaRouteSrc, /const event = `arena-\${action}`/);

  // Realtime channel is dedicated private-arena- and not proctored channel
  assert.equal(arenaRouteSrc.includes("private-quiz-"), false);
});

test("Bug 1 Test D: Student /arena/[id] listens to arena-start and transitions to active wave", () => {
  // Student binds to arena-start on arenaChannel
  assert.match(arenaStationSrc, /arenaChannel\.bind\("arena-start"/);

  // Transitions phase to in_wave and sets question index to 0
  assert.match(arenaStationSrc, /setPhase\("in_wave"\)/);
  assert.match(arenaStationSrc, /setCurrentQuestionIndex\(0\)/);

  // Student does not listen to quiz-started
  assert.equal(arenaStationSrc.includes('"quiz-started"'), false);
});

test("Bug 1 Test E: Teacher host visibly displays API error and shows pending state instead of silently failing", () => {
  // Verifies error banner is rendered in lobby actions near the Start button
  assert.match(
    teacherHostSrc,
    /arenaError[\s\S]*?role="alert"[\s\S]*?\{arenaError\}/
  );

  // Verifies button displays loading spinner or text while isActionPending
  assert.match(
    teacherHostSrc,
    /isActionPending\s*\?[\s\S]*?Starting Arena\.\.\.[\s\S]*?:[\s\S]*?Start Arena Match/
  );
});

test("Bug 2 Test A: Copy Code copies only quiz.accessCode (no URL, host, or query)", () => {
  // Verifies handleCopyCode writes strictly quiz.accessCode to clipboard
  assert.match(
    teacherHostSrc,
    /const handleCopyCode\s*=\s*\(\)\s*=>\s*\{[\s\S]*?navigator\.clipboard\.writeText\(quiz\.accessCode\);/
  );

  // Verifies button titled "Copy Code" triggers handleCopyCode
  assert.match(
    teacherHostSrc,
    /<button[\s\S]*?onClick=\{handleCopyCode\}[\s\S]*?title="Copy Code"/
  );
});

test("Bug 2 Test B: Copy Link is separate and copies full join URL", () => {
  // Verifies handleCopyLink writes full /join?code= URL
  assert.match(
    teacherHostSrc,
    /const handleCopyLink\s*=\s*\(\)\s*=>\s*\{[\s\S]*?navigator\.clipboard\.writeText\(url\);/
  );

  // Verifies separate "Copy Link" button exists
  assert.match(
    teacherHostSrc,
    /<button[\s\S]*?onClick=\{handleCopyLink\}[\s\S]*?title="Copy Link"/
  );
});

test("Safety: Proctored live monitoring quiz runner is completely unaffected", () => {
  // Proctored runner retains proctoring preflight and does not listen to arena-start
  assert.match(proctoredRunnerSrc, /quizChannel\.bind\("quiz-started"/);
  assert.equal(proctoredRunnerSrc.includes('"arena-start"'), false);
  assert.equal(proctoredRunnerSrc.includes('"private-arena-'), false);
});
