import "dotenv/config";
import { expect, test } from "@playwright/test";
import { authenticateAsExistingRole } from "./helpers/auth";

test.describe("authenticated entitlement and quiz flows", () => {
  test.skip(
    process.env.RUN_AUTHENTICATED_E2E !== "true",
    "Set RUN_AUTHENTICATED_E2E=true and use a disposable E2E_DATABASE_URL to run authenticated flows",
  );

  test("student join input retains a complete current-format access code", async ({ context, page }) => {
    await authenticateAsExistingRole(context, "student");
    await page.goto("/join");
    const input = page.getByPlaceholder("Enter join code");
    await input.fill("PS-1CD0309D3B");
    await expect(input).toHaveValue("PS-1CD0309D3B");
    await expect(input).toHaveAttribute("maxlength", "64");
  });

  test("free teacher sees AI and sixth-manual-quiz paywalls", async ({ context, page }) => {
    await authenticateAsExistingRole(context, "teacher");
    await page.route("**/api/billing/status", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        isSubscribed: false,
        planName: "Free Tier",
        subscriptionEndsAt: null,
        manualQuizCount: 5,
        manualQuizLimit: 5,
        manualQuizzesRemaining: 0,
      }),
    }));
    await page.route("**/api/quizzes", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        quizzes: [],
        pendingRetakes: [],
        pendingApprovals: [],
        entitlements: {
          isSubscribed: false,
          manualQuizCount: 5,
          manualQuizLimit: 5,
          manualQuizzesRemaining: 0,
        },
      }),
    }));

    await page.goto("/dashboard/teacher/quizzes");
    await expect(page.getByText("5/5 free quizzes")).toBeVisible();

    await page.getByRole("button", { name: /AI Create/i }).click();
    await expect(page.getByRole("heading", { name: "Premium Feature" })).toBeVisible();
    await page.getByRole("button", { name: "Maybe Later" }).click();

    await page.getByRole("button", { name: "Manual Quiz" }).click();
    await expect(page.getByRole("heading", { name: "Free Quiz Limit Reached" })).toBeVisible();
  });

  test("Pro teacher can open manual and AI creation", async ({ context, page }) => {
    await authenticateAsExistingRole(context, "teacher");
    const proEntitlements = {
      isSubscribed: true,
      planName: "Premium Yearly",
      subscriptionEndsAt: "2030-01-01T00:00:00.000Z",
      manualQuizCount: 25,
      manualQuizLimit: null,
      manualQuizzesRemaining: null,
    };
    await page.route("**/api/billing/status", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(proEntitlements),
    }));
    await page.route("**/api/quizzes", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        quizzes: [],
        pendingRetakes: [],
        pendingApprovals: [],
        entitlements: proEntitlements,
      }),
    }));

    await page.goto("/dashboard/teacher/quizzes");
    await expect(page.getByRole("button", { name: "New Quiz" })).toBeVisible();
    await page.getByRole("button", { name: /AI Create/i }).click();
    await expect(page.getByRole("heading", { name: /Auto-Generate with AI/i })).toBeVisible();
  });

  test("student stays in the lobby until the teacher starts the quiz", async ({ context, page }) => {
    await authenticateAsExistingRole(context, "student");
    let teacherStarted = false;
    await page.route("**/api/quizzes/901", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        userId: "e2e-student",
        studentQuizId: "e2e-attempt",
        studentQuizStatus: teacherStarted ? "in_progress" : "enrolled",
        canEnterQuiz: teacherStarted,
        remainingSeconds: teacherStarted ? 3600 : undefined,
        savedAnswers: [],
        quiz: {
          id: 901,
          title: "E2E Waiting Room Quiz",
          description: "Authenticated waiting-room contract test",
          duration: 60,
          totalQuestions: 1,
          passingScore: 50,
          shuffleQuestions: false,
          quizStatus: teacherStarted ? "in_progress" : "active",
          teacherId: "e2e-teacher",
          subject: { subjectName: "System Testing" },
        },
        questions: teacherStarted
          ? [{
              id: 1,
              questionText: "The teacher started the quiz.",
              questionType: "multiple_choice",
              points: 1,
              choices: [
                { id: 11, choiceText: "True" },
                { id: 12, choiceText: "False" },
              ],
            }]
          : [],
      }),
    }));
    await page.route("**/api/pusher/auth", (route) => route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "Disabled during contract test" }),
    }));

    await page.goto("/quiz/901");
    await expect(page.getByText("Waiting for Teacher to Start the Quiz...")).toBeVisible();
    await expect(page.getByRole("button", { name: "Waiting for Teacher to Start..." })).toBeDisabled();

    teacherStarted = true;
    await expect(page.getByRole("button", { name: /Start Quiz/i })).toBeEnabled({ timeout: 5_000 });
    await expect(page.getByText("The teacher started the quiz.")).toHaveCount(0);
  });
});
