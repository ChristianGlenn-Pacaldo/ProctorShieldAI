import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type QuizResponse = {
  quizzes: Array<{
    id: number;
    title: string;
    quizMode: string;
    quizStatus: string;
    teacher: Record<string, unknown>;
  }>;
};

test("Admin quiz list serializes only the teacher name", async () => {
  const routePath = path.resolve(process.cwd(), "src/app/api/quizzes/route.ts");
  const compiled = ts.transpileModule(fs.readFileSync(routePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const teacher = {
    fullName: "Teacher Name",
    email: "teacher@example.com",
    password: "sensitive-password-hash",
    googleId: "private-google-id",
    sessionVersion: 7,
    isOnline: true,
  };
  let teacherSelection: { select: Record<string, boolean> } | true | undefined;
  const prisma = {
    quiz: {
      findMany: async (query: { include: { teacher: { select: Record<string, boolean> } | true } }) => {
        teacherSelection = query.include.teacher;
        const selectedTeacher = teacherSelection === true
          ? teacher
          : Object.fromEntries(
              Object.keys(teacherSelection.select ?? {}).map((field) => [field, teacher[field as keyof typeof teacher]]),
            );
        return [{
          id: 42,
          title: "Power Arena Match",
          quizMode: "arena",
          quizStatus: "in_progress",
          teacher: selectedTeacher,
        }];
      },
    },
  };
  const dependencies: Record<string, unknown> = {
    "next/server": {
      NextResponse: {
        json: (body: unknown, options: { status?: number; headers?: HeadersInit } = {}) =>
          new Response(JSON.stringify(body), { status: options.status ?? 200, headers: options.headers }),
      },
    },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/auth": { getSession: async () => ({ role: "admin", userId: "admin-1" }) },
    "node:crypto": {},
    "@/lib/teacher-entitlements": {},
    "@/lib/subscription-rules": {},
    "@/lib/quiz-mode": {},
    "@/lib/quiz-availability": { UNAVAILABLE_QUIZ_STATUSES: ["deleted"] },
  };
  const route: { GET?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext(compiled, {
    exports: route,
    require: (name: string) => dependencies[name],
    console,
  }, { filename: routePath });

  const response = await route.GET!(new Request("http://localhost/api/quizzes"));
  const serialized = await response.text();
  const body = JSON.parse(serialized) as QuizResponse;

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(teacherSelection === true, false);
  assert.equal((teacherSelection as { select: Record<string, boolean> }).select.fullName, true);
  assert.equal(Object.keys((teacherSelection as { select: Record<string, boolean> }).select).length, 1);
  assert.deepEqual(body.quizzes[0].teacher, { fullName: "Teacher Name" });
  assert.equal(body.quizzes[0].quizMode, "arena");
  assert.equal(body.quizzes[0].quizStatus, "in_progress");
  assert.equal(body.quizzes[0].title, "Power Arena Match");
  for (const sensitiveValue of [teacher.email, teacher.password, teacher.googleId, String(teacher.sessionVersion)]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});
