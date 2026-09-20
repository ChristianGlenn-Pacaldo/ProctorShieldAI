import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { parseQuizMode, isArenaQuiz, isProctoredQuiz } from "../src/lib/quiz-mode.ts";

const joinPageSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/join/page.tsx"),
  "utf-8"
);
const studentDashboardSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/student/content.tsx"),
  "utf-8"
);
const studentQuizzesSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/student/quizzes/content.tsx"),
  "utf-8"
);
const teacherQuizzesSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/teacher/quizzes/content.tsx"),
  "utf-8"
);
const teacherArenaHostSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/teacher/playground/arena/[id]/content.tsx"),
  "utf-8"
);
const arenaRouteSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/arena/[id]/route.ts"),
  "utf-8"
);
const arenaBattleActionSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/arena/battle-action/route.ts"),
  "utf-8"
);
const liveBattleActionSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/live/battle-action/route.ts"),
  "utf-8"
);
const joinApiSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/quizzes/join/route.ts"),
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
const proctoredStartApiSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/quizzes/[id]/start/route.ts"),
  "utf-8"
);
const pusherAuthSrc = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/pusher/auth/route.ts"),
  "utf-8"
);

test("Test A & B: Join page routes to /arena/[id] for arena and /quiz/[id] for proctored", () => {
  // Verifies join page routing based strictly on data.quiz.quizMode
  assert.match(
    joinPageSrc,
    /data\.quiz\.quizMode\s*===\s*["']arena["']\s*\?\s*`\/arena\/\${data\.quiz\.id}`\s*:\s*`\/quiz\/\${data\.quiz\.id}`/
  );
});

test("Test C: Missing quizMode falls back safely to proctored route", () => {
  assert.equal(parseQuizMode(undefined), "proctored");
  assert.equal(parseQuizMode(null), "proctored");

  // In join page, any falsy or undefined quizMode resolves to /quiz/${data.quiz.id}
  const simulateRoute = (quizMode?: string, id: number = 42) =>
    quizMode === "arena" ? `/arena/${id}` : `/quiz/${id}`;

  assert.equal(simulateRoute(undefined), "/quiz/42");
  assert.equal(simulateRoute(null as unknown as string), "/quiz/42");
  assert.equal(simulateRoute("proctored"), "/quiz/42");
  assert.equal(simulateRoute("arena"), "/arena/42");
});

test("Join wording follows a safely matched assigned quiz mode", () => {
  assert.match(joinPageSrc, /normalizeQuizAccessCode\(quiz\.accessCode\) === normalizedJoinCode/);
  assert.match(joinPageSrc, /matchedAssignment\?\.quizMode === "arena" \? "Arena" : "Quiz"/);
  assert.match(joinPageSrc, /Enter \{destinationName\} Code/);
  assert.match(joinPageSrc, /Join \{destinationName\}/);
  assert.match(joinPageSrc, /activeQuizzes\.slice\(0, 3\)\.map/);
});

test("Test D & E: Student dashboard cards and enrolled list link Arena to /arena/[id] and Proctored to /quiz/[id]", () => {
  // Student dashboard quick join routes by quizMode
  assert.match(
    studentDashboardSrc,
    /data\.quiz\.quizMode\s*===\s*["']arena["']\s*\?\s*`\/arena\/\${data\.quiz\.id}`\s*:\s*`\/quiz\/\${data\.quiz\.id}`/
  );

  // Student dashboard upcoming cards link by quizMode
  assert.match(
    studentDashboardSrc,
    /se\.quiz\.quizMode\s*===\s*["']arena["']\s*\?\s*`\/arena\/\${se\.quiz\.id}`\s*:\s*`\/quiz\/\${se\.quiz\.id}`/
  );

  // Student quizzes page retake redirect by quizMode
  assert.match(
    studentQuizzesSrc,
    /data\.quizMode\s*===\s*["']arena["']\s*\?\s*`\/arena\/\${data\.quizId}`\s*:\s*`\/quiz\/\${data\.quizId}`/
  );

  // Student quizzes table row links by quizMode
  assert.match(
    studentQuizzesSrc,
    /isArena\s*\?\s*`\/arena\/\${e\.id}`\s*:\s*`\/quiz\/\${e\.id}`/
  );
});

test("Test F & G: Teacher Arena Host subscribes to private-arena channel and has zero private-quiz dependencies", () => {
  // Subscribes to private-arena-${quiz.id}
  assert.match(teacherArenaHostSrc, /pusher\.subscribe\(`private-arena-\${quiz\.id}`\)/);

  // Subscribes to private-teacher-${teacherId}
  assert.match(teacherArenaHostSrc, /pusher\.subscribe\(`private-teacher-\${teacherId}`\)/);

  // Completely removed private-quiz-${quiz.id}
  assert.equal(teacherArenaHostSrc.includes("private-quiz-"), false);
});

test("Test H: Arena server endpoints no longer broadcast Arena events to private-quiz channel", () => {
  // /api/arena/[id] does not trigger private-quiz-
  assert.equal(arenaRouteSrc.includes("private-quiz-"), false);

  // /api/arena/battle-action does not trigger private-quiz-
  assert.equal(arenaBattleActionSrc.includes("private-quiz-"), false);

  // /api/live/battle-action does not trigger private-quiz-
  assert.equal(liveBattleActionSrc.includes("private-quiz-"), false);
});

test("Test I: Arena uses arena-start instead of quiz-started", () => {
  // /api/arena/[id] emits arena-start (via action: "start") to private-arena-${quizId}
  assert.match(arenaRouteSrc, /const event = `arena-\${action}`/);
  assert.match(arenaRouteSrc, /pusherServer\.trigger\(`private-arena-\${quizId}`, event, eventData\)/);

  // /api/arena/[id] does not emit quiz-started
  assert.equal(arenaRouteSrc.includes('"quiz-started"'), false);

  // /arena/[id] client binds to arena-start and NOT quiz-started
  assert.match(arenaStationSrc, /arenaChannel\.bind\("arena-start"/);
  assert.equal(arenaStationSrc.includes('"quiz-started"'), false);
});

test("Test J: Live Monitoring proctored quiz still uses quiz-started", () => {
  // Proctored quiz runner listens to quiz-started
  assert.match(proctoredRunnerSrc, /quizChannel\.bind\("quiz-started"/);

  // Proctored quiz start API emits quiz-started on private-quiz-${quizId}
  assert.match(proctoredStartApiSrc, /pusherServer\.trigger\(`private-quiz-\${quizId}`, "quiz-started"/);
});

test("Test K: Arena join event does not trigger proctored teacher monitoring notifications", () => {
  // Teacher monitoring notification is only created for non-arena quizzes
  assert.match(joinApiSrc, /if\s*\(\s*quiz\.quizMode\s*!==\s*["']arena["']\s*\)\s*\{[\s\S]*?title:\s*isLateJoin\s*\?\s*"Late Join Request"\s*:\s*"Student Joined Quiz"/);

  // Push notification is only triggered for non-arena quizzes
  assert.match(joinApiSrc, /if\s*\(\s*quiz\.quizMode\s*!==\s*["']arena["']\s*\)\s*\{[\s\S]*?pusherServer\.trigger\(`private-user-\${quiz\.teacherId}`,\s*"notification"/);

  // For arena quizzes, arena-student-joined is emitted only on private-arena- and private-teacher-
  assert.match(joinApiSrc, /pusherServer\.trigger\(`private-arena-\${quiz\.id}`,\s*"arena-student-joined"/);
  assert.equal(joinApiSrc.includes("private-quiz-"), false);
});

test("Test L: Pusher auth strictly enforces quizMode and attemptMode for Arena channel", () => {
  assert.match(pusherAuthSrc, /attemptMode:\s*["']arena["']/);
  assert.match(pusherAuthSrc, /quiz:\s*\{\s*quizMode:\s*["']arena["']\s*\}/);
  assert.match(pusherAuthSrc, /quizMode:\s*["']arena["']/);
});
