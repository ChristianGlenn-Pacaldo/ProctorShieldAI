import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type StudentQuizResponse = {
  quizzes: Array<{
    quizStatus: string;
    attemptNumber: number;
    aiAnalysis: { finalVerdict: string };
    quiz: {
      id: number;
      title: string;
      accessCode: string;
      quizMode: string;
      quizStatus: string;
      teacherId: string;
      teacher: Record<string, unknown>;
      subject: { subjectName: string };
    };
  }>;
};

test("Student quiz list serializes only the teacher name", async () => {
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
  let studentQuizQuery: {
    where: { studentId: string; quiz: { quizStatus: { notIn: string[] } } };
    include: {
      quiz: { include: { subject: boolean; teacher: { select: Record<string, boolean> } | true } };
      aiAnalysis: boolean;
    };
    orderBy: { createdAt: string };
  } | undefined;
  const prisma = {
    studentQuiz: {
      findMany: async (query: NonNullable<typeof studentQuizQuery>) => {
        studentQuizQuery = query;
        const teacherSelection = query.include.quiz.include.teacher;
        const selectedTeacher = teacherSelection === true
          ? teacher
          : Object.fromEntries(
              Object.keys(teacherSelection.select).map((field) => [field, teacher[field as keyof typeof teacher]]),
            );
        return [{
          quizStatus: "pending_retake",
          attemptNumber: 2,
          aiAnalysis: { finalVerdict: "clean" },
          quiz: {
            id: 42,
            title: "Power Arena Match",
            accessCode: "PS-1234567890",
            quizMode: "arena",
            quizStatus: "in_progress",
            teacherId: "teacher-1",
            teacher: selectedTeacher,
            subject: { subjectName: "Science" },
          },
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
    "@/lib/auth": { getSession: async () => ({ role: "student", userId: "student-1" }) },
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
  const body = JSON.parse(serialized) as StudentQuizResponse;
  const teacherSelection = studentQuizQuery?.include.quiz.include.teacher;

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(studentQuizQuery?.where.studentId, "student-1");
  assert.deepEqual(Array.from(studentQuizQuery?.where.quiz.quizStatus.notIn ?? []), ["deleted"]);
  assert.equal(studentQuizQuery?.include.quiz.include.subject, true);
  assert.equal(studentQuizQuery?.include.aiAnalysis, true);
  assert.equal(studentQuizQuery?.orderBy.createdAt, "desc");
  assert.equal(teacherSelection === true, false);
  assert.deepEqual(Object.keys((teacherSelection as { select: Record<string, boolean> }).select), ["fullName"]);
  assert.deepEqual(body.quizzes[0].quiz.teacher, { fullName: "Teacher Name" });
  assert.equal(body.quizzes[0].quiz.teacherId, "teacher-1");
  assert.equal(body.quizzes[0].quiz.title, "Power Arena Match");
  assert.equal(body.quizzes[0].quiz.accessCode, "PS-1234567890");
  assert.equal(body.quizzes[0].quiz.quizMode, "arena");
  assert.equal(body.quizzes[0].quiz.quizStatus, "in_progress");
  assert.equal(body.quizzes[0].quiz.subject.subjectName, "Science");
  assert.equal(body.quizzes[0].quizStatus, "pending_retake");
  assert.equal(body.quizzes[0].attemptNumber, 2);
  assert.equal(body.quizzes[0].aiAnalysis.finalVerdict, "clean");
  for (const sensitiveValue of [teacher.email, teacher.password, teacher.googleId]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});
