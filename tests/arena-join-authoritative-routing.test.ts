import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { getQuizJoinDestination, getQuizJoinEligibility } from "../src/lib/quiz-join.ts";

const read = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
const joinPageSource = read("src/app/join/page.tsx");
const joinRouteSource = read("src/app/api/quizzes/join/route.ts");
const playgroundPageSource = read("src/app/dashboard/teacher/playground/page.tsx");
const playgroundContentSource = read("src/app/dashboard/teacher/playground/content.tsx");
const teacherArenaPageSource = read("src/app/dashboard/teacher/playground/arena/[id]/page.tsx");
const arenaPageSource = read("src/app/arena/[id]/page.tsx");

test("Arena code resolves to the Arena route and never the proctored runner", () => {
  assert.equal(getQuizJoinDestination(35, "arena"), "/arena/35");
  assert.notEqual(getQuizJoinDestination(35, "arena"), "/quiz/35");
});

test("normal quiz code resolves to the existing proctored route", () => {
  assert.equal(getQuizJoinDestination(37, "proctored"), "/quiz/37");
});

test("join lookup returns authoritative identity, mode, lifecycle, and destination", () => {
  assert.match(joinRouteSource, /export async function GET\(req: NextRequest\)/);
  assert.match(joinRouteSource, /const quizMode = parseQuizMode\(quiz\.quizMode\)/);
  assert.match(joinRouteSource, /teacher:\s*quiz\.teacher\.fullName/);
  assert.match(joinRouteSource, /quizStatus:\s*quiz\.quizStatus/);
  assert.match(joinRouteSource, /isArena:\s*quizMode === "arena"/);
  assert.match(joinRouteSource, /destination:\s*getQuizJoinDestination\(quiz\.id, quizMode\)/);
  assert.match(joinRouteSource, /arenaSession:\s*await getArenaSessionSummary/);
});

test("Arena join wording is lookup-driven and excludes proctoring claims", () => {
  assert.match(joinPageSource, /Enter \{destinationName\} Code/);
  assert.match(joinPageSource, /`Join \$\{destinationName\}`/);
  assert.match(joinPageSource, /codeLookup\?\.quiz\.isArena/);
  assert.match(joinPageSource, /No Exam Proctoring/);
});

test("join navigation accepts only the server-returned destination", () => {
  assert.match(joinPageSource, /typeof data\.destination === "string"/);
  assert.match(joinPageSource, /router\.push\(targetRoute\)/);
  assert.equal(joinPageSource.includes("data.quiz.quizMode === \"arena\""), false);
});

test("Arena entry never initializes the proctored runner", () => {
  assert.match(arenaPageSource, /if \(quiz\.quizMode !== "arena"\)/);
  assert.match(arenaPageSource, /redirect\(`\/quiz\/\$\{quizId\}`\)/);
  assert.equal(arenaPageSource.includes("getUserMedia"), false);
  assert.equal(arenaPageSource.includes("Live Monitoring"), false);
});

test("invalid code is rejected by both lookup and join mutation", () => {
  const invalidResponses = joinRouteSource.match(/Invalid access code\. Quiz not found\./g) || [];
  assert.ok(invalidResponses.length >= 4);
});

test("ended Arena is review-only for an enrolled student and closed to new joins", () => {
  assert.deepEqual(
    getQuizJoinEligibility({ quizMode: "arena", quizStatus: "ended", hasEnrollment: true }),
    {
      eligible: true,
      reviewOnly: true,
      state: "review",
      message: "This Power Arena has ended. Your final results are available for review.",
    },
  );
  const closed = getQuizJoinEligibility({ quizMode: "arena", quizStatus: "ended", hasEnrollment: false });
  assert.equal(closed.eligible, false);
  assert.equal(closed.state, "closed");
});

test("client-supplied mode cannot override PostgreSQL quizMode", () => {
  assert.match(joinRouteSource, /const \{ accessCode \} = body as \{ accessCode\?: unknown \}/);
  assert.match(joinRouteSource, /parseQuizMode\(quiz\.quizMode\)/);
  assert.equal(joinRouteSource.includes("body.quizMode"), false);
  assert.equal(joinRouteSource.includes("record.quizMode"), false);
});

test("Playground cannot masquerade a proctored quiz as Arena", () => {
  assert.match(playgroundPageSource, /quizMode:\s*"arena"/);
  assert.match(playgroundPageSource, /quizStatus:\s*\{ not:\s*"ended" \}/);
  assert.match(playgroundContentSource, /if \(!response\.ok \|\| !data\?\.success\)/);
  const rejectionIndex = playgroundContentSource.indexOf("if (!response.ok || !data?.success)");
  const navigationIndex = playgroundContentSource.indexOf("router.push(`/dashboard/teacher/playground/arena/");
  assert.ok(rejectionIndex >= 0 && navigationIndex > rejectionIndex);
  assert.match(teacherArenaPageSource, /if \(quiz\.quizMode !== "arena"\)/);
  assert.match(teacherArenaPageSource, /redirect\("\/dashboard\/teacher\/playground"\)/);
});
