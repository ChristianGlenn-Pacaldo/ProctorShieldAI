import { test, expect, type Browser, type BrowserContext, type Page, type APIResponse } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import Redis from "ioredis";
import fs from "node:fs";
import path from "node:path";
import { authenticateAsExistingRole, syntheticAccount, type TestRole } from "./helpers/auth";

const enabled = process.env.RUN_AUTHENTICATED_E2E === "true";
test.skip(!enabled, "Owned disposable database and synthetic accounts required");
let pool: Pool, cache: Redis;
test.beforeAll(async () => {
  if (!enabled) return;
  syntheticAccount("teacher");
  pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL, max: 3 });
  const redis = new URL(process.env.REDIS_URL || "");
  if (redis.hostname !== "127.0.0.1" || redis.port !== "26379") throw Error("Owned test cache required");
  cache = new Redis(redis.href);
});
test.afterAll(async () => { await pool?.end(); await cache?.quit(); });
test.beforeEach(async ({ context }) => {
  if (!enabled) return;
  // Reset only limiter keys in the exclusively owned fixture cache. Browser
  // generations stay intact; each security test starts with a fresh budget.
  const keys = await cache.keys("proctorshield:rate-limit:*");
  if (keys.length) await cache.del(...keys);
  await context.route("https://fonts.googleapis.com/**", route => route.fulfill({ contentType: "text/css", body: "/* offline provider */" }));
  // Reuse the actual downloaded COCO bytes. Cloud cold-delivery is assessed
  // separately; large proxy downloads must not distort database workflow tests.
  await context.route("**/api/models/coco/*", async route => {
    const file = new URL(route.request().url()).pathname.split("/").pop()!;
    if (!/^(model\.json|group1-shard[1-5]of5)$/.test(file)) return route.abort();
    return route.fulfill({ body: fs.readFileSync(path.join(".tmp-stabilization-model-cache", file)),
      contentType: file === "model.json" ? "application/json" : "application/octet-stream" });
  });
});
const origin = () => syntheticAccount("teacher").origin;
async function post(context: BrowserContext, url: string, data: unknown) {
  return context.request.post(url, { headers: { Origin: origin() }, data });
}
async function ok(response: APIResponse, status = 200) {
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(status); return body;
}
async function teacherContext(browser: Browser, email?: string) {
  const context = await browser.newContext({ baseURL: origin(), ignoreHTTPSErrors: true });
  await authenticateAsExistingRole(context, "teacher", email);
  return context;
}
async function createQuiz(teacher: BrowserContext, title = "SYNTHETIC MVP " + randomUUID().slice(0, 8)) {
  const created = await ok(await post(teacher, "/api/quizzes", {
    title, subjectName: "Synthetic MVP Biology", duration: 10, passingScore: 50, isGamified: false, quizMode: "proctored",
    questions: [
      { questionText: "MVP: Which number is even?", questionType: "multiple_choice", points: 1, choices: [{ choiceText: "Two", isCorrect: true }, { choiceText: "Three", isCorrect: false }] },
      { questionText: "MVP: Which shape has three sides?", questionType: "multiple_choice", points: 1, choices: [{ choiceText: "Triangle", isCorrect: true }, { choiceText: "Circle", isCorrect: false }] },
    ],
  }), 201);
  return created.quiz as { id: number; accessCode: string; title: string };
}
async function activate(teacher: BrowserContext, id: number) {
  await ok(await teacher.request.put(`/api/quizzes/${id}`, { headers: { Origin: origin() }, data: { quizStatus: "active" } }));
}
async function readyInput(page: Page, selector: string) {
  await page.locator(selector).waitFor();
  await page.waitForFunction(selector => Object.entries(document.querySelector(selector) || {}).some(([key, value]) => key.startsWith("__reactProps") && typeof (value as { onChange?: unknown }).onChange === "function"), selector);
}
async function loginForm(page: Page, role: TestRole, email?: string) {
  const account = syntheticAccount(role, email);
  await readyInput(page, "#login-email");
  await page.locator("#login-email").fill(account.email);
  await page.locator("#login-password").fill(account.password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
}
async function fakeDevices(page: Page) {
  await page.addInitScript(() => {
    (window as any).__mvpMediaCalls = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async (constraints: MediaStreamConstraints) => {
      (window as any).__mvpMediaCalls++;
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
      const draw = canvas.getContext("2d")!; draw.fillStyle = "#123c30"; draw.fillRect(0, 0, 320, 240);
      draw.fillStyle = "white"; draw.fillText("SYNTHETIC MVP TEST — NO PERSON", 5, 120);
      const stream = canvas.captureStream(5);
      if (constraints.audio) { const audio = new AudioContext(), oscillator = audio.createOscillator(), gain = audio.createGain(), sink = audio.createMediaStreamDestination(); gain.gain.value = 0; oscillator.connect(gain); gain.connect(sink); oscillator.start(); stream.addTrack(sink.stream.getAudioTracks()[0]); }
      return stream;
    } });
  });
}

test("real password sessions render all role dashboards and reject cross-role requests", async ({ browser }) => {
  for (const role of ["teacher", "student", "admin"] as const) {
    const context = await browser.newContext({ baseURL: origin(), ignoreHTTPSErrors: true });
    try {
      await authenticateAsExistingRole(context, role);
      const page = await context.newPage();
      const response = await page.goto(`/dashboard/${role}`, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      await expect(page.locator(".dashboard-sidebar")).toBeVisible();
      const other = role === "teacher" ? "student" : "teacher";
      const denied = await context.request.get(`/api/auth/session?scope=user&role=${other}`);
      expect(denied.status()).toBe(401);
      await expect(page.getByRole("link", { name: /Power Arena/i })).toHaveCount(0);
    } finally { await context.close(); }
  }
});

test("landing code survives real Student login, privacy, device check, teacher start, answers and persisted results", async ({ browser, page, context }) => {
  test.setTimeout(180000);
  const teacher = await teacherContext(browser);
  try {
    const quiz = await createQuiz(teacher); await activate(teacher, quiz.id);
    await fakeDevices(page);
    // A blank synthetic camera should trigger the real no-face warning. Follow
    // its normal acknowledgement instead of bypassing the modal or AI checks.
    await page.addLocatorHandler(page.getByRole("heading", { name: "SECURITY PROCTORING ALERT", exact: true }), async () => {
      await expect(page.getByText(/No face detected\. Please correct this before continuing\./)).toBeVisible();
      await page.getByRole("button", { name: "I Understand & Continue", exact: true }).click();
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await readyInput(page, "#quiz-code");
    await page.locator("#quiz-code").fill(quiz.accessCode);
    await page.getByRole("button", { name: "Join quiz", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/login\\?joinCode=${quiz.accessCode}$`));
    await loginForm(page, "student");
    await expect(page).toHaveURL(new RegExp(`/quiz/${quiz.id}$`));
    await expect(page.getByRole("heading", { name: "Your Privacy Matters" })).toBeVisible();
    await expect(page.getByText(/37 days/)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__mvpMediaCalls)).toBe(0);
    await expect(page.locator("#quiz-device-check")).toBeDisabled();
    const session = await ok(await context.request.get("/api/auth/session?scope=user&role=student"));
    const attempts = await pool.query("SELECT id FROM student_quizzes WHERE quiz_id=$1 AND student_id=$2", [quiz.id, session.user.userId]);
    expect(attempts.rows).toHaveLength(1);
    await ok(await post(context, "/api/quizzes/join", { accessCode: quiz.accessCode }));
    expect((await pool.query("SELECT id FROM student_quizzes WHERE quiz_id=$1 AND student_id=$2", [quiz.id, session.user.userId])).rows).toHaveLength(1);
    await page.getByRole("button", { name: "Continue to Device Check", exact: true }).click();
    await page.locator("#quiz-device-check").click();
    await expect(page.getByText(/Camera allowed/)).toBeVisible();
    await ok(await post(teacher, `/api/quizzes/${quiz.id}/start`, {}));
    const start = page.getByRole("button", { name: "I Understand, Start Quiz", exact: true });
    await expect(start).toBeEnabled();
    await start.click();
    // A store outage fails closed and leaves an explicit retry in the lobby.
    // Exercise that existing recovery if this local Docker run hits its bound.
    await expect.poll(async () => await page.getByRole("heading", { name: /MVP: Which/ }).count()
      || await page.getByRole("alert").filter({ hasText: /Internal server error|unavailable/i }).count(), { timeout: 60000 }).toBeGreaterThan(0);
    if (await page.getByRole("alert").filter({ hasText: /Internal server error|unavailable/i }).count()) await start.click();
    await expect(page.getByRole("heading", { name: /MVP: Which/ })).toBeVisible();
    const monitor = await ok(await teacher.request.get("/api/live/snapshot"));
    expect(monitor.snapshots.some((s: { studentQuizId: string }) => s.studentQuizId === attempts.rows[0].id)).toBe(true);
    const enrollment = await pool.query("SELECT start_time,monitoring_level FROM student_quizzes WHERE id=$1", [attempts.rows[0].id]);
    expect(enrollment.rows[0].start_time).toBeTruthy();
    expect(["strict", "reduced"]).toContain(enrollment.rows[0].monitoring_level);
    const answered = new Set<string>();
    for (let index = 0; index < 2; index++) {
      const heading = page.getByRole("heading", { name: /MVP: Which/ });
      const question = await heading.innerText(); expect(answered.has(question)).toBe(false); answered.add(question);
      await page.getByRole("button", { name: question.includes("number") ? /Two/ : /Triangle/ }).click();
      if (index === 0) await expect(heading).not.toHaveText(question);
    }
    await expect(page.getByRole("heading", { name: "Assessment Completed!" })).toBeVisible({ timeout: 30000 });
    const result = await pool.query("SELECT quiz_status,score,end_time FROM student_quizzes WHERE id=$1", [attempts.rows[0].id]);
    expect(result.rows[0].quiz_status).toBe("completed"); expect(Number(result.rows[0].score)).toBe(100); expect(result.rows[0].end_time).toBeTruthy();
    expect((await pool.query("SELECT id FROM answers WHERE student_quiz_id=$1", [attempts.rows[0].id])).rows).toHaveLength(2);
    const results = await ok(await context.request.get("/api/dashboard/student/results"));
    expect(results.results.some((r: { id: string }) => r.id === attempts.rows[0].id)).toBe(true);
  } finally { await teacher.close(); }
});

test("duplicate enrollment and ownership attacks preserve one owned attempt", async ({ browser, context }) => {
  const teacher = await teacherContext(browser), otherTeacher = await teacherContext(browser, "teacher-b@mvp.example.test");
  try {
    const quiz = await createQuiz(teacher); await activate(teacher, quiz.id);
    const student = await authenticateAsExistingRole(context, "student");
    const joined = await Promise.all([post(context, "/api/quizzes/join", { accessCode: quiz.accessCode }), post(context, "/api/quizzes/join", { accessCode: quiz.accessCode })]);
    expect(joined.every(r => [200, 201, 409].includes(r.status()))).toBe(true);
    const attempts = await pool.query("SELECT id FROM student_quizzes WHERE quiz_id=$1 AND student_id=$2", [quiz.id, student.userId]); expect(attempts.rows).toHaveLength(1);
    expect((await otherTeacher.request.get(`/api/quizzes/${quiz.id}`)).status()).toBe(403);
    expect((await post(otherTeacher, `/api/quizzes/${quiz.id}/start`, {})).status()).toBe(404);
    const outsider = await browser.newContext({ baseURL: origin(), ignoreHTTPSErrors: true });
    try {
      await authenticateAsExistingRole(outsider, "student", "student-outside@mvp.example.test");
      expect((await outsider.request.get(`/api/quizzes/${quiz.id}/privacy`)).status()).toBe(404);
      expect((await post(outsider, "/api/quizzes/session", { action: "start", quizId: quiz.id, studentQuizId: attempts.rows[0].id })).status()).toBe(409);
      expect((await post(outsider, "/api/quizzes/submit", { quizId: quiz.id, studentQuizId: attempts.rows[0].id, answers: [] })).status()).toBe(404);
    } finally { await outsider.close(); }
    expect((await pool.query("SELECT id FROM answers WHERE student_quiz_id=$1", [attempts.rows[0].id])).rows).toHaveLength(0);
  } finally { await teacher.close(); await otherTeacher.close(); }
});

test("logout revokes a copied session and a fresh Teacher login cannot act as Student", async ({ browser, context }) => {
  await authenticateAsExistingRole(context, "student");
  const copied = await browser.newContext({ baseURL: origin(), ignoreHTTPSErrors: true, storageState: await context.storageState() });
  try {
    await ok(await post(context, "/api/auth/logout", {}));
    expect((await copied.request.get("/api/auth/session?scope=user&role=student")).status()).toBe(401);
    await authenticateAsExistingRole(context, "teacher");
    expect((await context.request.get("/api/auth/session?scope=user&role=student")).status()).toBe(401);
    expect((await post(context, "/api/quizzes/join", { accessCode: "PS-ABC123" })).status()).toBe(401);
    const cookies = await context.cookies();
    expect(cookies.filter(c => ["ps_session_user", "ps_browser_auth"].includes(c.name)).every(c => c.httpOnly && c.secure)).toBe(true);
  } finally { await copied.close(); }
});

test("existing evidence access is enforced for synthetic legacy image, download and byte ranges", async ({ browser, context }) => {
  const teacher = await teacherContext(browser), other = await teacherContext(browser, "teacher-b@mvp.example.test");
  const admin = await browser.newContext({ baseURL: origin(), ignoreHTTPSErrors: true });
  try {
    const quiz = await createQuiz(teacher), student = await authenticateAsExistingRole(context, "student");
    const attempt = randomUUID();
    await pool.query("INSERT INTO student_quizzes(id,student_id,quiz_id,quiz_status) VALUES($1,$2,$3,'completed')", [attempt, student.userId, quiz.id]);
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=";
    const bytes = Buffer.from("SYNTHETIC-BYTE-RANGE-FIXTURE");
    const ids: string[] = [];
    for (const media of ["data:image/png;base64," + png, "data:video/webm;base64," + bytes.toString("base64")]) {
      const v = await pool.query("INSERT INTO violations(student_quiz_id,violation_type,timestamp,screenshot_path) VALUES($1,'tab_switch',now(),$2) RETURNING id", [attempt, media]); ids.push(v.rows[0].id);
    }
    expect((await context.request.get(`/api/evidence/${ids[0]}`)).status()).toBe(401);
    expect((await other.request.get(`/api/evidence/${ids[0]}`)).status()).toBe(403);
    const image = await teacher.request.get(`/api/evidence/${ids[0]}?download=1`);
    expect(image.status()).toBe(200); expect(image.headers()["cache-control"]).toContain("no-store"); expect(image.headers()["content-disposition"]).toContain("attachment"); expect((await image.body()).equals(Buffer.from(png, "base64"))).toBe(true);
    const range = await teacher.request.get(`/api/evidence/${ids[1]}`, { headers: { Range: "bytes=1-3" } });
    expect(range.status()).toBe(206); expect((await range.body()).equals(bytes.subarray(1, 4))).toBe(true);
    expect((await other.request.get(`/api/evidence/${ids[1]}?download=1`, { headers: { Range: "bytes=1-3" } })).status()).toBe(403);
    await authenticateAsExistingRole(admin, "admin"); expect((await admin.request.get(`/api/evidence/${ids[0]}`)).status()).toBe(200);
    const listing = await ok(await teacher.request.get("/api/dashboard/teacher/evidence"));
    expect(ids.every(id => listing.evidence.some((row: { id: string }) => row.id === id))).toBe(true);
    const otherListing = await ok(await other.request.get("/api/dashboard/teacher/evidence"));
    expect(otherListing.evidence.some((row: { id: string }) => ids.includes(row.id))).toBe(false);
  } finally { await teacher.close(); await other.close(); await admin.close(); }
});

test("Teacher Studio saves new questions and Manage activates the persisted quiz", async ({ context, page }) => {
  await authenticateAsExistingRole(context, "teacher");
  await page.goto("/dashboard/teacher/quizzes", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New Quiz", exact: true }).click();
  const title = "SYNTHETIC UI " + randomUUID().slice(0, 8);
  await page.getByRole("textbox", { name: "Quiz title", exact: true }).fill(title);
  await expect(page.getByRole("button", { name: "Power Arena", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add Question", exact: true }).click();
  await page.getByRole("combobox", { name: "Question type", exact: true }).selectOption("fill_in_blank");
  await page.getByPlaceholder("Type your question here", { exact: false }).fill("SYNTHETIC: Write the word Two.");
  await page.getByPlaceholder("Type the accepted answer", { exact: false }).fill("Two");
  await page.getByRole("button", { name: "Save Question", exact: true }).click();
  await page.getByRole("button", { name: "Publish Quiz", exact: true }).click();
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: new RegExp(title) }) });
  await expect(row).toBeVisible();
  const saved = await pool.query("SELECT id,quiz_status FROM quizzes WHERE title=$1", [title]);
  expect(saved.rows).toHaveLength(1); expect(saved.rows[0].quiz_status).toBe("draft");
  expect((await pool.query("SELECT id FROM questions WHERE quiz_id=$1 AND question_type='fill_in_blank'", [saved.rows[0].id])).rows).toHaveLength(1);
  await row.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByRole("button", { name: "Make Active", exact: true }).click();
  await expect.poll(async () => (await pool.query("SELECT quiz_status FROM quizzes WHERE id=$1", [saved.rows[0].id])).rows[0].quiz_status).toBe("active");
});

test("real Student registration preserves the pending quiz code and creates one enrollment", async ({ browser, page }) => {
  const teacher = await teacherContext(browser);
  try {
    const quiz = await createQuiz(teacher); await activate(teacher, quiz.id);
    await page.goto(`/join?code=${quiz.accessCode}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Create Student Account", exact: true }).click();
    const email = "registered-" + randomUUID().slice(0, 8) + "@mvp.example.test";
    await page.locator("#student-register-name").fill("SYNTHETIC Registered Student");
    await page.locator("#student-register-email").fill(email);
    await page.locator("#student-register-password").fill("LocalMvpFixture2026");
    await page.locator("#student-register-confirm").fill("LocalMvpFixture2026");
    await page.locator("form").filter({ has: page.locator("#student-register-name") }).locator("button[type=submit]").click();
    await expect(page).toHaveURL(new RegExp(`/quiz/${quiz.id}$`));
    const user = await pool.query("SELECT u.id,r.role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE email=$1", [email]);
    expect(user.rows).toHaveLength(1); expect(user.rows[0].role_name).toBe("student");
    expect((await pool.query("SELECT id FROM student_quizzes WHERE quiz_id=$1 AND student_id=$2", [quiz.id, user.rows[0].id])).rows).toHaveLength(1);
  } finally { await teacher.close(); }
});

test("concurrent manual creations cannot exceed the free Teacher quota", async ({ browser }) => {
  const email = "quota-" + randomUUID().slice(0, 8) + "@mvp.example.test", id = randomUUID();
  await pool.query("INSERT INTO users(id,full_name,email,password,role_id,updated_at) SELECT $1,'SYNTHETIC Quota Teacher',$2,password,role_id,now() FROM users WHERE email='teacher-free@mvp.example.test'", [id, email]);
  const teacher = await teacherContext(browser, email);
  try {
    for (let i = 0; i < 4; i++) await createQuiz(teacher);
    const data = { title: "SYNTHETIC Concurrent Quota", subjectName: "Synthetic MVP Quota", quizMode: "proctored", duration: 10, questions: [{ questionText: "Synthetic question", questionType: "true_false", points: 1, choices: [{ choiceText: "True", isCorrect: true }, { choiceText: "False", isCorrect: false }] }] };
    const responses = await Promise.all([post(teacher, "/api/quizzes", data), post(teacher, "/api/quizzes", data)]);
    expect(responses.map(r => r.status()).sort()).toEqual([201, 403]);
    expect((await pool.query("SELECT id FROM quizzes WHERE teacher_id=$1", [id])).rows).toHaveLength(5);
  } finally { await teacher.close(); }
});

test("late entry needs the owning Teacher approval and rejected entry stays blocked", async ({ browser, context }) => {
  const teacher = await teacherContext(browser), other = await teacherContext(browser, "teacher-b@mvp.example.test");
  try {
    const quiz = await createQuiz(teacher); await activate(teacher, quiz.id);
    await ok(await post(teacher, `/api/quizzes/${quiz.id}/start`, {}));
    const student = await authenticateAsExistingRole(context, "student");
    await ok(await post(context, "/api/quizzes/join", { accessCode: quiz.accessCode }), 201);
    const attempt = (await pool.query("SELECT id,quiz_status FROM student_quizzes WHERE quiz_id=$1 AND student_id=$2", [quiz.id, student.userId])).rows[0];
    expect(attempt.quiz_status).toBe("pending_approval");
    expect((await ok(await context.request.get(`/api/quizzes/${quiz.id}`))).questions).toHaveLength(0);
    expect((await post(other, "/api/quizzes/approve", { studentQuizId: attempt.id, action: "accept" })).status()).toBe(404);
    const pending = await ok(await teacher.request.get("/api/quizzes"));
    expect(pending.pendingApprovals.some((a: { studentQuizId: string }) => a.studentQuizId === attempt.id)).toBe(true);
    await ok(await post(teacher, "/api/quizzes/approve", { studentQuizId: attempt.id, action: "accept" }));
    expect((await pool.query("SELECT quiz_status FROM student_quizzes WHERE id=$1", [attempt.id])).rows[0].quiz_status).toBe("enrolled");
    expect((await post(teacher, "/api/quizzes/approve", { studentQuizId: attempt.id, action: "accept" })).status()).toBe(409);
    const second = await browser.newContext({ baseURL: origin(), ignoreHTTPSErrors: true });
    try {
      const next = await authenticateAsExistingRole(second, "student", "student-outside@mvp.example.test");
      await ok(await post(second, "/api/quizzes/join", { accessCode: quiz.accessCode }), 201);
      const reject = (await pool.query("SELECT id FROM student_quizzes WHERE quiz_id=$1 AND student_id=$2", [quiz.id, next.userId])).rows[0].id;
      await ok(await post(teacher, "/api/quizzes/approve", { studentQuizId: reject, action: "reject" }));
      expect((await post(second, "/api/quizzes/session", { action: "start", quizId: quiz.id, studentQuizId: reject })).status()).toBe(409);
    } finally { await second.close(); }
  } finally { await teacher.close(); await other.close(); }
});

test("Admin suspension revokes synthetic access and Teacher cannot perform Admin updates", async ({ browser, context }) => {
  const email = "suspend-" + randomUUID().slice(0, 8) + "@mvp.example.test", id = randomUUID();
  await pool.query("INSERT INTO users(id,full_name,email,password,role_id,updated_at) SELECT $1,'SYNTHETIC Suspension Teacher',$2,password,role_id,now() FROM users WHERE email='teacher-free@mvp.example.test'", [id, email]);
  const teacher = await teacherContext(browser, email);
  try {
    await authenticateAsExistingRole(context, "admin");
    const path = `/api/dashboard/admin/users/${id}`;
    expect((await teacher.request.put(path, { headers: { Origin: origin() }, data: { status: "suspended" } })).status()).toBe(401);
    await ok(await context.request.put(path, { headers: { Origin: origin() }, data: { status: "suspended" } }));
    expect((await teacher.request.get("/api/auth/session?scope=user&role=teacher")).status()).toBe(401);
    await ok(await context.request.put(path, { headers: { Origin: origin() }, data: { status: "active" } }));
    await authenticateAsExistingRole(teacher, "teacher", email);
    const audit = await pool.query("SELECT id FROM activity_logs WHERE activity LIKE $1", ["%SYNTHETIC Suspension Teacher%"]);
    expect(audit.rows.length).toBeGreaterThan(0);
  } finally { await teacher.close(); }
});

test("saved answers recover without extending the deadline and duplicate submission stays atomic", async ({ browser, context }) => {
  const teacher = await teacherContext(browser);
  try {
    const quiz = await createQuiz(teacher); await activate(teacher, quiz.id);
    await authenticateAsExistingRole(context, "student", "student-b@mvp.example.test");
    await ok(await post(context, "/api/quizzes/join", { accessCode: quiz.accessCode }), 201);
    const detail = await ok(await teacher.request.get(`/api/quizzes/${quiz.id}`));
    const own = await ok(await context.request.get(`/api/quizzes/${quiz.id}`));
    const attempt = own.studentQuizId;
    const capabilities = { deviceType: "desktop", secureContext: true, cameraSupported: true, cameraPermission: true, microphoneSupported: true, microphonePermission: true, mediaRecorderSupported: true, fullscreenSupported: true, visibilitySupported: true, viewportWidth: 1280, viewportHeight: 900 };
    await ok(await post(context, "/api/quizzes/session", { quizId: quiz.id, capabilities }));
    await ok(await post(teacher, `/api/quizzes/${quiz.id}/start`, {}));
    const start = { action: "start", quizId: quiz.id, studentQuizId: attempt };
    await ok(await post(context, "/api/quizzes/session", start));
    const timing = (await pool.query("SELECT setting_value FROM settings WHERE setting_key=$1", ["proctored:session:" + quiz.id])).rows;
    const firstStart = (await pool.query("SELECT start_time FROM student_quizzes WHERE id=$1", [attempt])).rows[0].start_time;
    const answers = detail.questions.map((q: { id: number; choices: { id: number; isCorrect: boolean }[] }) => ({ questionId: q.id, choiceId: q.choices.find(c => c.isCorrect)!.id }));
    await ok(await post(context, "/api/quizzes/answer", { quizId: quiz.id, studentQuizId: attempt, ...answers[0] }));
    const recovered = await ok(await context.request.get(`/api/quizzes/${quiz.id}`));
    expect(recovered.savedAnswers.some((a: { questionId: number }) => a.questionId === answers[0].questionId)).toBe(true);
    await ok(await post(context, "/api/quizzes/session", start));
    expect((await pool.query("SELECT start_time FROM student_quizzes WHERE id=$1", [attempt])).rows[0].start_time).toEqual(firstStart);
    expect((await pool.query("SELECT setting_value FROM settings WHERE setting_key=$1", ["proctored:session:" + quiz.id])).rows).toEqual(timing);
    const submit = { quizId: quiz.id, studentQuizId: attempt, answers, reason: "all_questions_completed" };
    const responses = await Promise.all([post(context, "/api/quizzes/submit", submit), post(context, "/api/quizzes/submit", submit)]);
    expect(responses.some(r => r.status() === 200)).toBe(true); expect(responses.every(r => [200, 409].includes(r.status()))).toBe(true);
    expect((await pool.query("SELECT id FROM answers WHERE student_quiz_id=$1", [attempt])).rows).toHaveLength(2);
    expect(Number((await pool.query("SELECT score FROM student_quizzes WHERE id=$1", [attempt])).rows[0].score)).toBe(100);
  } finally { await teacher.close(); }
});

test("Arena pages, creation and legacy pending requests stay disabled with real sessions", async ({ browser, context, page }) => {
  const teacher = await teacherContext(browser);
  try {
    const student = await authenticateAsExistingRole(context, "student"), quiz = await createQuiz(teacher);
    const owner = await ok(await teacher.request.get("/api/auth/session?scope=user&role=teacher"));
    const subject = await pool.query("SELECT subject_id FROM quizzes WHERE id=$1", [quiz.id]);
    const arena = await pool.query("INSERT INTO quizzes(subject_id,teacher_id,title,access_code,quiz_mode,quiz_status) VALUES($1,$2,$3,$4,'arena','active') RETURNING id", [subject.rows[0].subject_id, owner.user.userId, "SYNTHETIC DISABLED ARENA " + randomUUID(), "PS-" + randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()]);
    await pool.query("INSERT INTO student_quizzes(id,student_id,quiz_id,attempt_mode,quiz_status) VALUES($1,$2,$3,'arena','pending_approval')", [randomUUID(), student.userId, arena.rows[0].id]);
    for (const path of [`/arena/${arena.rows[0].id}`, "/dashboard/teacher/playground", `/api/arena/${arena.rows[0].id}`]) {
      const denied = await context.request.get(path); expect(denied.status()).toBe(403); expect((await denied.json()).code).toBe("FEATURE_DISABLED");
    }
    const denied = await post(teacher, "/api/quizzes", { quizMode: "arena", title: "Blocked", subjectName: "Synthetic" }); expect(denied.status()).toBe(403);
    const list = await ok(await teacher.request.get("/api/quizzes"));
    expect(list.quizzes.some((q: { id: number }) => q.id === arena.rows[0].id)).toBe(false);
    expect(list.pendingApprovals.some((r: { quizId: number }) => r.quizId === arena.rows[0].id)).toBe(false);
    await page.goto("/dashboard/student", { waitUntil: "domcontentloaded" });
    await expect(page.locator("a[href*='playground'],a[href*='/arena/']")).toHaveCount(0);
  } finally { await teacher.close(); }
});
