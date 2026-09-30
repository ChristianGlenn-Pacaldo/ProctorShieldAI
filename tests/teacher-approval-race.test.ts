import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const routePath = path.resolve(process.cwd(), "src/app/api/quizzes/approve/route.ts");
const routeCode = ts.transpileModule(fs.readFileSync(routePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function fixture(concurrent = false, owner = "teacher-1") {
  let status = "pending_approval";
  let reads = 0;
  let writes = 0;
  const events: Array<{ status: string; quizId: number }> = [];
  let releaseReads: () => void = () => {};
  const bothRead = new Promise<void>((resolve) => { releaseReads = resolve; });
  const prisma = {
    studentQuiz: {
      findUnique: async () => {
        if (concurrent && ++reads === 2) releaseReads();
        if (concurrent) await bothRead;
        return { id: "attempt-1", studentId: "student-1", quizId: 46, quizStatus: status, startTime: null,
          quiz: { teacherId: owner, quizMode: "proctored" } };
      },
      updateMany: async (query: { where: { id: string; quizStatus: string }; data: { quizStatus: string } }) => {
        assert.deepEqual({ ...query.where }, { id: "attempt-1", quizStatus: "pending_approval" });
        if (status !== query.where.quizStatus) return { count: 0 };
        status = query.data.quizStatus;
        writes++;
        return { count: 1 };
      },
    },
  };
  const route: { POST?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext(routeCode, {
    exports: route,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: unknown, options: { status?: number } = {}) =>
        new Response(JSON.stringify(body), { status: options.status ?? 200 }) } };
      if (name === "@/lib/prisma") return { __esModule: true, default: prisma };
      if (name === "@/lib/auth") return { getSession: async () => ({ userId: "teacher-1", role: "teacher" }) };
      if (name === "@/lib/pusher") return { pusherServer: { trigger: async (_channel: string, _event: string, payload: { status: string; quizId: number }) => { events.push(payload); } } };
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console: { error() {} },
  }, { filename: routePath });
  const decide = (action: "accept" | "reject") => route.POST!(new Request("http://localhost/api/quizzes/approve", {
    method: "POST", body: JSON.stringify({ studentQuizId: "attempt-1", action }),
  }));
  return { decide, events, status: () => status, writes: () => writes };
}

test("simultaneous late-join decisions have one winner and one conflict without overwrite", async () => {
  const setup = fixture(true);
  const responses = await Promise.all([setup.decide("accept"), setup.decide("reject")]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const winner = responses[0].status === 200 ? "enrolled" : "rejected";
  assert.equal(setup.status(), winner);
  assert.equal(setup.writes(), 1);
  assert.deepEqual(setup.events.map((event) => event.status), [winner]);
  assert.match((await responses.find((response) => response.status === 409)!.json()).error, /no longer pending/);
});

test("late-join decision rejects another Teacher before any write or event", async () => {
  const setup = fixture(false, "teacher-2");
  const response = await setup.decide("accept");
  assert.equal(response.status, 404);
  assert.equal(setup.status(), "pending_approval");
  assert.equal(setup.writes(), 0);
  assert.equal(setup.events.length, 0);
});

test("a later decision receives conflict without replacing the first decision", async () => {
  const setup = fixture();
  assert.equal((await setup.decide("accept")).status, 200);
  assert.equal((await setup.decide("reject")).status, 409);
  assert.equal(setup.status(), "enrolled");
  assert.equal(setup.writes(), 1);
  assert.equal(setup.events.length, 1);
});
