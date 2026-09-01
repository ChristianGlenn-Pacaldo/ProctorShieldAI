import { expect, test } from "@playwright/test";

test("public homepage and student login render", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Proctor Shield AI/i);
  await page.goto("/login/student");
  await expect(page.getByRole("button", { name: /sign in|log in/i }).first()).toBeVisible();
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
