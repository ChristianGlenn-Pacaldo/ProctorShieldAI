import { expect, test } from "@playwright/test";

test("public homepage and student login render", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Proctor Shield AI/i);
  await page.goto("/login/student");
  await expect(page.getByRole("button", { name: /sign in|log in/i }).first()).toBeVisible();
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
