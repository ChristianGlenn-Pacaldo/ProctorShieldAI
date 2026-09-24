import "dotenv/config";
import crypto from "node:crypto";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

type Role = "student" | "teacher";

interface TestUser {
  id: string;
  email: string;
  fullName: string;
  sessionVersion: number;
}

interface QuizFixture {
  quizId: number;
  accessCode: string;
  title: string;
  teacher: TestUser;
  students: TestUser[];
  firstQuestionId: number;
  firstCorrectChoiceId: number;
}

function e2eDatabaseUrl() {
  const value = process.env.E2E_DATABASE_URL?.trim();
  if (!value) throw new Error("E2E_DATABASE_URL is required");
  const url = new URL(value);
  const productionUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  const normalizeHost = (host: string) => host.toLowerCase().replace("-pooler.", ".");
  if (productionUrl && normalizeHost(url.hostname) === normalizeHost(productionUrl.hostname)) {
    throw new Error("Focused E2E fixtures cannot use the production database endpoint");
  }
  if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

function createPool() {
  return new Pool({ connectionString: e2eDatabaseUrl(), max: 2 });
}

async function createUser(pool: Pool, role: Role, label: string): Promise<TestUser> {
  const id = crypto.randomUUID();
  const unique = crypto.randomUUID().replaceAll("-", "");
  const email = `${label}-${unique}@e2e.proctorshield.test`;
  const fullName = role === "student"
    ? `E2E, STUDENT, ${unique.slice(0, 6).toUpperCase()}`
    : `E2E Teacher ${unique.slice(0, 6)}`;
  const result = await pool.query<TestUser>(
    `INSERT INTO users (id, full_name, email, password, role_id, status, session_version)
     SELECT $1, $2, $3, 'unused-e2e-password', r.id, 'active', 0
     FROM roles r
     WHERE r.role_name = $4
     RETURNING id, email, full_name AS "fullName", session_version AS "sessionVersion"`,
    [id, fullName, email, role],
  );
  const user = result.rows[0];
  if (!user) throw new Error(`Unable to create ${role} E2E identity`);
  return user;
}

async function createQuizFixture(options: {
  mode: "proctored" | "arena";
  studentCount: number;
  proTeacher?: boolean;
}): Promise<{ pool: Pool; fixture: QuizFixture }> {
  const pool = createPool();
  const teacher = await createUser(pool, "teacher", "E2E Teacher");
  const students = await Promise.all(
    Array.from({ length: options.studentCount }, (_, index) => createUser(pool, "student", `E2E Student ${index + 1}`)),
  );

  if (options.proTeacher) {
    const subscription = await pool.query(
      `INSERT INTO user_subscriptions
        (id, user_id, plan_id, start_date, end_date, payment_status, subscription_status)
       SELECT $1, $2, p.id, CURRENT_DATE, CURRENT_DATE + 7, 'paid', 'active'
       FROM subscription_plans p
       WHERE p.yearly_price > 0
       ORDER BY p.yearly_price ASC
       LIMIT 1
       RETURNING id`,
      [crypto.randomUUID(), teacher.id],
    );
    if (subscription.rowCount !== 1) throw new Error("No paid subscription plan exists for Arena E2E");
  }

  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const title = `E2E ${options.mode} ${suffix}`;
  const accessCode = `PS-${suffix}`;
  const subject = await pool.query<{ id: number }>(
    `INSERT INTO subjects (teacher_id, subject_name, subject_code)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [teacher.id, `E2E Subject ${suffix}`, `E2E-${suffix}`],
  );
  const quiz = await pool.query<{ id: number }>(
    `INSERT INTO quizzes
      (subject_id, teacher_id, title, access_code, quiz_mode, duration, total_questions, passing_score, quiz_status)
     VALUES ($1, $2, $3, $4, $5, 60, 2, 50, 'active')
     RETURNING id`,
    [subject.rows[0].id, teacher.id, title, accessCode, options.mode],
  );
  const quizId = quiz.rows[0].id;
  let firstQuestionId = 0;
  let firstCorrectChoiceId = 0;

  for (let index = 0; index < 2; index += 1) {
    const question = await pool.query<{ id: number }>(
      `INSERT INTO questions (quiz_id, question_text, question_type, points)
       VALUES ($1, $2, 'multiple_choice', 200)
       RETURNING id`,
      [quizId, `E2E question ${index + 1}`],
    );
    const questionId = question.rows[0].id;
    const choice = await pool.query<{ id: number }>(
      `INSERT INTO choices (question_id, choice_text, is_correct)
       VALUES ($1, 'Correct', true), ($1, 'Incorrect', false)
       RETURNING id, is_correct AS "isCorrect"`,
      [questionId],
    );
    if (index === 0) {
      firstQuestionId = questionId;
      firstCorrectChoiceId = choice.rows[0].id;
    }
  }

  for (const student of students) {
    await pool.query(
      `INSERT INTO student_quizzes
        (id, student_id, quiz_id, attempt_number, quiz_status, attempt_mode)
       VALUES ($1, $2, $3, 1, 'enrolled', $4)`,
      [crypto.randomUUID(), student.id, quizId, options.mode],
    );
  }

  return {
    pool,
    fixture: {
      quizId,
      accessCode,
      title,
      teacher,
      students,
      firstQuestionId,
      firstCorrectChoiceId,
    },
  };
}

async function authenticatedContext(browser: Browser, user: TestUser, role: Role) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("NEXTAUTH_SECRET must contain at least 32 characters");
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
  const context = await browser.newContext({ baseURL });
  const token = jwt.sign(
    { userId: user.id, email: user.email, role, fullName: user.fullName, sessionVersion: user.sessionVersion },
    secret,
    { algorithm: "HS256", expiresIn: "15m" },
  );
  await context.addCookies([{
    name: `ps_session_${role}`,
    value: token,
    url: baseURL,
    httpOnly: true,
    secure: baseURL.startsWith("https:"),
    sameSite: "Lax",
  }]);
  return context;
}

async function closeContexts(contexts: BrowserContext[]) {
  await Promise.allSettled(contexts.map((context) => context.close()));
}

test.describe("focused quiz deletion and sequential Arena attacks", () => {
  test.describe.configure({ timeout: 180_000 });

  test.skip(
    process.env.RUN_AUTHENTICATED_E2E !== "true",
    "Set RUN_AUTHENTICATED_E2E=true and use a disposable E2E_DATABASE_URL",
  );

  test("deleted proctored quiz disappears and rejects stale enrollment access", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Run isolated mutation fixture once");
    const { pool, fixture } = await createQuizFixture({ mode: "proctored", studentCount: 1 });
    const teacherContext = await authenticatedContext(browser, fixture.teacher, "teacher");
    const studentContext = await authenticatedContext(browser, fixture.students[0], "student");
    try {
      const studentPage = await studentContext.newPage();
      await studentPage.goto("/dashboard/student/quizzes");
      await expect(studentPage.getByText(fixture.title, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

      const deletion = await teacherContext.request.delete(`/api/quizzes/${fixture.quizId}`);
      expect(deletion.status()).toBe(200);

      await studentPage.reload();
      await expect(studentPage.getByText(fixture.title, { exact: true })).toHaveCount(0);

      const directQuiz = await studentContext.request.get(`/api/quizzes/${fixture.quizId}`);
      expect(directQuiz.status()).toBe(410);
      await expect(directQuiz.json()).resolves.toMatchObject({ code: "QUIZ_NOT_AVAILABLE" });

      const oldCodeLookup = await studentContext.request.get(`/api/quizzes/join?accessCode=${fixture.accessCode}`);
      expect(oldCodeLookup.status()).toBe(404);
      const staleJoin = await studentContext.request.post("/api/quizzes/join", {
        data: { accessCode: fixture.accessCode },
      });
      expect(staleJoin.status()).toBe(404);

      const databaseState = await pool.query(
        `SELECT q.quiz_status AS "quizStatus", q.access_code AS "accessCode",
                sq.quiz_status AS "studentStatus", sq.end_time AS "endTime"
         FROM quizzes q
         INNER JOIN student_quizzes sq ON sq.quiz_id = q.id
         WHERE q.id = $1 AND sq.student_id = $2`,
        [fixture.quizId, fixture.students[0].id],
      );
      expect(databaseState.rows[0]).toMatchObject({
        quizStatus: "deleted",
        accessCode: null,
        studentStatus: "rejected",
      });
      expect(databaseState.rows[0].endTime).toBeTruthy();
    } finally {
      await closeContexts([teacherContext, studentContext]);
      await pool.end();
    }
  });

  test("deleted Arena quiz cannot create a session or participant", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Run isolated mutation fixture once");
    const { pool, fixture } = await createQuizFixture({ mode: "arena", studentCount: 1 });
    const teacherContext = await authenticatedContext(browser, fixture.teacher, "teacher");
    const studentContext = await authenticatedContext(browser, fixture.students[0], "student");
    try {
      const deletion = await teacherContext.request.delete(`/api/quizzes/${fixture.quizId}`);
      expect(deletion.status()).toBe(200);

      const joinArena = await studentContext.request.post(`/api/arena/${fixture.quizId}`, {
        data: { action: "join", payload: {} },
      });
      expect(joinArena.status()).toBe(410);
      await expect(joinArena.json()).resolves.toMatchObject({ code: "QUIZ_NOT_AVAILABLE" });

      const arenaState = await studentContext.request.get(`/api/arena/${fixture.quizId}`);
      expect(arenaState.status()).toBe(410);
      const directPage = await studentContext.newPage();
      const directResponse = await directPage.goto(`/arena/${fixture.quizId}`);
      expect(directResponse?.status()).toBe(404);

      const storedState = await pool.query(
        `SELECT COUNT(*)::int AS count FROM settings WHERE setting_key = $1`,
        [`arena:state:${fixture.quizId}`],
      );
      expect(storedState.rows[0].count).toBe(0);
    } finally {
      await closeContexts([teacherContext, studentContext]);
      await pool.end();
    }
  });

  test("Shielded attack and reversed follow-up attacks remain independent", async ({ browser }, testInfo) => {
    test.skip(process.env.RUN_FOCUSED_ARENA_E2E !== "true", "Run separately to preserve the 2.5-second reaction window");
    test.skip(testInfo.project.name !== "desktop-chromium", "Run isolated mutation fixture once");
    const { pool, fixture } = await createQuizFixture({ mode: "arena", studentCount: 2, proTeacher: true });
    const teacherContext = await authenticatedContext(browser, fixture.teacher, "teacher");
    const playerAContext = await authenticatedContext(browser, fixture.students[0], "student");
    const playerBContext = await authenticatedContext(browser, fixture.students[1], "student");
    try {
      for (const context of [playerAContext, playerBContext]) {
        const join = await context.request.post(`/api/arena/${fixture.quizId}`, {
          data: { action: "join", payload: {} },
        });
        expect(join.status()).toBe(200);
      }

      const start = await teacherContext.request.post(`/api/arena/${fixture.quizId}`, {
        data: { action: "start", payload: { matchDuration: 1800 } },
      });
      expect(start.status()).toBe(200);
      const started = await start.json();
      const sessionId = started.sessionId as string;
      expect(sessionId).toBeTruthy();

      for (const context of [playerAContext, playerBContext]) {
        const answer = await context.request.post("/api/quizzes/answer", {
          data: {
            quizId: fixture.quizId,
            questionId: fixture.firstQuestionId,
            choiceId: fixture.firstCorrectChoiceId,
          },
        });
        expect(answer.status()).toBe(200);
        await expect(answer.json()).resolves.toMatchObject({ score: 200, isCorrect: true });
      }

      const attackAResponse = await playerAContext.request.post("/api/arena/battle-action", {
        data: {
          quizId: fixture.quizId,
          sessionId,
          powerType: "meteor",
          targetStudentId: fixture.students[1].id,
        },
      });
      expect(attackAResponse.status()).toBe(200);
      const attackA = await attackAResponse.json();
      expect(attackA).toMatchObject({ status: "pending", scorePenalty: 100, sessionId });

      const shieldResponse = await playerBContext.request.post("/api/arena/battle-action", {
        data: {
          quizId: fixture.quizId,
          sessionId,
          powerType: "shield",
          defendAttackId: attackA.attackId,
        },
      });
      expect(shieldResponse.status()).toBe(200);
      await expect(shieldResponse.json()).resolves.toMatchObject({
        code: "blocked",
        deflected: true,
        attackId: attackA.attackId,
        sessionId,
      });

      const attackBResponse = await playerBContext.request.post("/api/arena/battle-action", {
        data: {
          quizId: fixture.quizId,
          sessionId,
          powerType: "meteor",
          targetStudentId: fixture.students[0].id,
        },
      });
      expect(attackBResponse.status()).toBe(200);
      const attackB = await attackBResponse.json();
      expect(attackB).toMatchObject({ status: "pending", scorePenalty: 100, sessionId });
      expect(attackB.attackId).not.toBe(attackA.attackId);
      expect(attackB.code).not.toBe("already_resolved");

      await new Promise((resolve) => setTimeout(resolve, 2_700));
      const resolveB = await playerAContext.request.post("/api/arena/battle-action", {
        data: {
          quizId: fixture.quizId,
          sessionId,
          action: "resolve-attack",
          attackId: attackB.attackId,
          targetStudentId: fixture.students[0].id,
        },
      });
      expect(resolveB.status()).toBe(200);
      expect(["resolved", "already_resolved"]).toContain((await resolveB.json()).code);

      const attackCResponse = await playerAContext.request.post("/api/arena/battle-action", {
        data: {
          quizId: fixture.quizId,
          sessionId,
          powerType: "earthquake",
          targetStudentId: fixture.students[1].id,
        },
      });
      expect(attackCResponse.status()).toBe(200);
      const attackC = await attackCResponse.json();
      expect(attackC).toMatchObject({ status: "pending", scorePenalty: 60, sessionId });
      expect(new Set([attackA.attackId, attackB.attackId, attackC.attackId]).size).toBe(3);

      await new Promise((resolve) => setTimeout(resolve, 2_700));
      await playerBContext.request.post("/api/arena/battle-action", {
        data: {
          quizId: fixture.quizId,
          sessionId,
          action: "resolve-attack",
          attackId: attackC.attackId,
          targetStudentId: fixture.students[1].id,
        },
      });

      const stateResponse = await playerAContext.request.get(`/api/arena/${fixture.quizId}`);
      expect(stateResponse.status()).toBe(200);
      const state = await stateResponse.json();
      expect(state.arena.pendingAttacks[attackA.attackId].status).toBe("deflected");
      expect(state.arena.pendingAttacks[attackB.attackId].status).toBe("hit");
      expect(state.arena.pendingAttacks[attackC.attackId].status).toBe("hit");
      expect(state.arena.participants[fixture.students[0].id].score).toBe(100);
      expect(state.arena.participants[fixture.students[1].id].score).toBe(140);

      const duplicateResolve = await playerAContext.request.post("/api/arena/battle-action", {
        data: {
          quizId: fixture.quizId,
          sessionId,
          action: "resolve-attack",
          attackId: attackB.attackId,
          targetStudentId: fixture.students[0].id,
        },
      });
      expect(duplicateResolve.status()).toBe(200);
      await expect(duplicateResolve.json()).resolves.toMatchObject({
        code: "already_resolved",
        attackId: attackB.attackId,
        attackStatus: "hit",
      });
    } finally {
      await closeContexts([teacherContext, playerAContext, playerBContext]);
      await pool.end();
    }
  });
});
