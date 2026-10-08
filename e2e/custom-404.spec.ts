import { expect, test } from "@playwright/test";

test("custom 404 retains Home and artwork without the retired Sign In action", async ({ page }) => {
  const response = await page.goto("/admin/login");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "Go to Sign In" })).toHaveCount(0);
  const artwork = page.locator('img[alt=""]');
  await expect(artwork).toBeVisible();
  await expect(artwork).toHaveAttribute("src", /proctorshield-404-robot/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
