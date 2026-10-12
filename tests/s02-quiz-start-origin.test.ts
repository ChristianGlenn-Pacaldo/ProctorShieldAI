import assert from "node:assert/strict";
import test from "node:test";
import { quizSessionFixture } from "./helpers/quiz-session-fixture.ts";
import { loadArenaModule } from "./helpers/arena-fixture.ts";

const canonical = "https://app.example.test";
function fixture(role: string | null = "teacher", userId = "teacher") {
  const f = quizSessionFixture(); let authReads = 0, quizReads = 0, transactions = 0, pushes = 0;
  const read = f.db.quiz.findUnique, transaction = f.db.$transaction;
  f.db.quiz.findUnique = async (...args: unknown[]) => { quizReads++; return read(...args); };
  f.db.$transaction = async (...args: unknown[]) => { transactions++; return transaction(...args); };
  const route = loadArenaModule("src/app/api/quizzes/[id]/start/route.ts", { ...f.deps,
    "@/lib/auth": { getSession: async () => { authReads++; return role ? { userId, role } : null; } },
    "@/lib/pusher": { pusherServer: { trigger: async () => { pushes++; } } },
  });
  return { f, counts: () => ({ authReads, quizReads, transactions, pushes }),
    post: (origin: string | null = canonical, extra: Record<string, string> = {}) => route.POST(new Request(`${canonical}/api/quizzes/7/start`, {
      method: "POST", headers: { ...(origin === null ? {} : { Origin: origin }), ...extra },
    }), { params: Promise.resolve({ id: "7" }) }),
  };
}
for (const [label, origin] of [
  ["missing", null], ["null", "null"], ["cross-origin", "https://evil.test"],
  ["foreign same-site", "https://untrusted.example.test"], ["path", canonical + "/path"],
  ["trailing slash", canonical + "/"], ["credentials", "https://user@app.example.test"],
  ["noncanonical case", "https://APP.example.test"], ["default port", "https://app.example.test:443"],
  ["invalid", "not-a-url"], ["multiple", canonical + " https://evil.test"],
] as const) test(`quiz start rejects ${label} Origin before auth, reads or mutations`, async () => {
  const setup = fixture(); const before = structuredClone(setup.f.state);
  const result = await setup.post(origin); assert.equal(result.status, 403); assert.equal(result.body.error, "Forbidden origin");
  assert.deepEqual(setup.counts(), { authReads: 0, quizReads: 0, transactions: 0, pushes: 0 });
  assert.deepEqual(setup.f.state, before);
});
test("canonical Origin with cross-site fetch context is rejected without writes", async () => {
  const s = fixture(); assert.equal((await s.post(canonical, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal(s.counts().transactions, 0); assert.equal(s.counts().authReads, 0);
});
test("forged forwarded host does not allow a foreign same-site Origin", async () => {
  const s = fixture(); assert.equal((await s.post("https://untrusted.example.test", { "x-forwarded-host": "untrusted.example.test" })).status, 403);
  assert.equal(s.counts().transactions, 0);
});
test("URL-encoded foreign same-site POST cannot start the quiz", async () => {
  const s = fixture(); assert.equal((await s.post("https://untrusted.example.test", { "Content-Type": "application/x-www-form-urlencoded" })).status, 403);
  assert.equal(s.f.state.quizzes.get(7).quizStatus, "active"); assert.equal(s.counts().transactions, 0);
});
test("valid same-origin Teacher starts a quiz, persists timing and notifies once", async () => {
  const s = fixture(); assert.equal((await s.post(canonical, { "sec-fetch-site": "same-origin" })).status, 200);
  assert.equal(s.f.state.quizzes.get(7).quizStatus, "in_progress"); assert.equal(s.f.state.settings.size, 1);
  assert.deepEqual(s.counts(), { authReads: 1, quizReads: 2, transactions: 1, pushes: 1 });
});
for (const role of ["student", "admin", null]) test(`same-origin ${role ?? "anonymous"} cannot start`, async () => {
  const s = fixture(role); assert.equal((await s.post()).status, 401);
  assert.equal(s.counts().quizReads, 0); assert.equal(s.counts().transactions, 0);
});
test("same-origin Teacher cannot start an unowned quiz", async () => {
  const s = fixture("teacher", "other-teacher"); assert.equal((await s.post()).status, 404);
  assert.equal(s.counts().transactions, 0); assert.equal(s.f.state.quizzes.get(7).quizStatus, "active");
});
test("existing quiz status and question guards remain intact", async () => {
  for (const scenario of ["ended", "empty", "invalid-answer"]) {
    const s = fixture(); const quiz = s.f.state.quizzes.get(7);
    if (scenario === "ended") quiz.quizStatus = "ended";
    if (scenario === "empty") quiz.questions = [];
    if (scenario === "invalid-answer") quiz.questions[0].choices.forEach((c: { isCorrect: boolean }) => { c.isCorrect = false; });
    const before = structuredClone(s.f.state); assert.equal((await s.post()).status, scenario === "ended" ? 400 : 409);
    assert.equal(s.counts().transactions, 0); assert.deepEqual(s.f.state, before);
  }
});
test("concurrent claim conflict still returns 409 and sends no notification", async () => {
  const s = fixture(); s.f.db.quiz.updateMany = async () => ({ count: 0 });
  assert.equal((await s.post()).status, 409); assert.equal(s.f.state.quizzes.get(7).quizStatus, "active");
  assert.equal(s.f.state.settings.size, 0); assert.equal(s.counts().pushes, 0);
});
