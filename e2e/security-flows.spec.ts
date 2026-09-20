import "dotenv/config";
import { expect, test } from "@playwright/test";
import jwt from "jsonwebtoken";

test("public homepage and student login render", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Proctor Shield AI/i);
  await page.goto("/login/student");
  await expect(page.getByRole("button", { name: /sign in|log in/i }).first()).toBeVisible();
});

test("student authentication tabs remain interactive after hydration", async ({ page }) => {
  await page.goto("/login/student");

  await page.getByRole("button", { name: "Create Account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create Student Account" })).toBeVisible();

  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Student Sign In" })).toBeVisible();
});

test("student and teacher password recovery links preserve their portal", async ({ page }) => {
  await page.goto("/login/student");
  const studentRecovery = page.getByRole("link", { name: "Forgot password?" });
  await expect(studentRecovery).toHaveAttribute("href", "/login/forgot-password?role=student");

  await page.goto("/login/teacher");
  const teacherRecovery = page.getByRole("link", { name: "Forgot password?" });
  await expect(teacherRecovery).toHaveAttribute("href", "/login/forgot-password?role=teacher");
  await teacherRecovery.click();

  await expect(page.getByText("Teacher Password Recovery")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Teacher Login" })).toHaveAttribute(
    "href",
    "/login/teacher"
  );
});

test("password recovery completes the request and reset UI flow", async ({ page }) => {
  let codeRequestReceived = false;
  let resetRequestReceived = false;
  await page.route(/\/api\/auth\/forgot-password$/, async (route) => {
    codeRequestReceived = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, message: "Reset code sent." }),
    });
  });
  await page.route(/\/api\/auth\/reset-password$/, async (route) => {
    resetRequestReceived = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, message: "Password reset." }),
    });
  });

  await page.goto("/login/forgot-password?role=student");
  await page.getByLabel("Email Address").fill("student@example.test");
  await page.getByRole("button", { name: "Send Verification Code" }).click();
  await expect(page.getByLabel("Verification Code")).toBeVisible();
  expect(codeRequestReceived).toBe(true);
  await page.getByLabel("Verification Code").fill("123456");
  await page.getByLabel("New Password", { exact: true }).fill("NewPassword123");
  await page.getByLabel("Confirm New Password").fill("NewPassword123");
  await page.getByRole("button", { name: "Reset Password" }).click();

  await expect(page.getByRole("heading", { name: "Password Reset!" })).toBeVisible();
  expect(resetRequestReceived).toBe(true);
  await expect(page.getByRole("link", { name: "Go to Student Login" })).toHaveAttribute(
    "href",
    "/login/student"
  );
});

test("protected dashboards redirect an anonymous browser", async ({ page }) => {
  await page.goto("/dashboard/teacher");
  await expect(page).toHaveURL(/\/login$/);
});

test("security headers are present on browser pages", async ({ request }) => {
  const response = await request.get("/login/student");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["content-security-policy"]).toContain("object-src 'none'");
});

test("weak registrations are rejected before persistence", async ({ request }) => {
  const response = await request.post("/api/auth/register", {
    data: {
      fullName: "TEST USER",
      email: "weak-password@example.test",
      password: "weak",
      confirmPassword: "weak",
      role: "student",
    },
  });
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ success: false });
});

test("unsigned payment webhooks are rejected", async ({ request }) => {
  const response = await request.post("/api/billing/webhook", { data: {} });
  expect(response.status()).toBe(401);
});

test("mobile page hiding reports the exact tab-switch violation", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile visibility regression");
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("NEXTAUTH_SECRET is required for this regression test");

  const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
  const token = jwt.sign({
    userId: "e2e-mobile-student",
    email: "mobile-student@example.test",
    role: "student",
    fullName: "Mobile Student",
    sessionVersion: 0,
  }, secret, { algorithm: "HS256", expiresIn: "10m" });
  await context.addCookies([{
    name: "ps_session_student",
    value: token,
    url: baseURL,
    httpOnly: true,
    secure: baseURL.startsWith("https:"),
    sameSite: "Lax",
  }]);

  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => hidden ? "hidden" : "visible",
    });
    (window as typeof window & { setTestHidden?: (value: boolean) => void }).setTestHidden = (value) => {
      hidden = value;
      document.dispatchEvent(new Event("visibilitychange"));
    };

    const mediaDevices = navigator.mediaDevices;
    Object.defineProperty(mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 240;
        canvas.getContext("2d")?.fillRect(0, 0, 320, 240);
        const video = canvas.captureStream(5);
        const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return video;
        const audioContext = new AudioContextClass();
        const oscillator = audioContext.createOscillator();
        const destination = audioContext.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        return new MediaStream([...video.getVideoTracks(), ...destination.stream.getAudioTracks()]);
      },
    });
  });

  const quizResponse = {
    success: true,
    userId: "e2e-mobile-student",
    studentQuizId: "9001",
    studentQuizStatus: "in_progress",
    canEnterQuiz: true,
    remainingSeconds: 3600,
    savedAnswers: [],
    violationCount: 0,
    quiz: {
      id: 901,
      title: "Mobile Visibility Test",
      description: "Regression test",
      duration: 60,
      totalQuestions: 1,
      passingScore: 50,
      shuffleQuestions: false,
      quizStatus: "in_progress",
      teacherId: "e2e-teacher",
      subject: { subjectName: "System Testing" },
    },
    questions: [{
      id: 1,
      questionText: "Visibility regression question",
      questionType: "multiple_choice",
      points: 1,
      choices: [{ id: 11, choiceText: "True" }, { id: 12, choiceText: "False" }],
    }],
  };
  await page.route("**/api/quizzes/901", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(quizResponse),
  }));
  await page.route("**/api/quizzes/session", (route) => {
    const payload = route.request().postDataJSON() as { action?: string } | null;
    const body = payload?.action === "start"
      ? { success: true, startTime: new Date().toISOString(), remainingSeconds: 3600 }
      : { success: true, monitoringLevel: "reduced" };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/live/violation", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, violationCount: 1, violation: { id: "701" } }),
  }));
  await page.route("**/api/live/violation/701/evidence", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true }),
  }));
  await page.route(/\/api\/live\/(join|snapshot|warning).*/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true }),
  }));
  await page.route("**/api/pusher/auth", (route) => route.fulfill({ status: 403, body: "{}" }));

  await page.goto("/join");
  await expect(page.getByRole("link", { name: "Back to Student Dashboard" })).toHaveAttribute("href", "/dashboard/student");

  await page.goto("/quiz/901");
  await page.getByRole("button", { name: /Start Quiz/i }).click();
  await expect(page.getByText("Visibility regression question")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(5_200);
  await page.evaluate(() => {
    (window as typeof window & { setTestHidden?: (value: boolean) => void }).setTestHidden?.(true);
  });
  await page.waitForTimeout(1_700);
  await page.evaluate(() => {
    (window as typeof window & { setTestHidden?: (value: boolean) => void }).setTestHidden?.(false);
  });

  await expect(page.getByText(/Violation 1\/3: App\/tab switch or window minimized/)).toBeVisible({ timeout: 10_000 });
});
