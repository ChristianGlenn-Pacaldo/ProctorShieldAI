import { expect, test } from "@playwright/test";
import path from "node:path";

test("Free pricing lists manual question entry and quiz-code access", async ({ page, context, baseURL }, testInfo) => {
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Use the isolated loopback fixture");
  await context.route("https://fonts.googleapis.com/**", route => route.fulfill({ contentType: "text/css", body: "/* offline font fixture */" }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const pricing = page.locator("#pricing");
  const freePlan = pricing.getByRole("article").filter({ hasText: "EDUCATOR STARTER" });
  await expect(freePlan.getByText("Manual quiz creation — add your own questions", { exact: true })).toBeVisible();
  await expect(freePlan.getByText("Up to 20 students per quiz", { exact: true })).toBeVisible();
  await expect(freePlan.getByText("Student access through quiz codes", { exact: true })).toBeVisible();
  await expect(freePlan.getByText(/calendar month|Allowance resets|face detection|unlimited/i)).toHaveCount(0);
  await expect(freePlan.getByRole("link", { name: "Start free", exact: true })).toHaveAttribute("href", "/login/teacher");
  await pricing.screenshot({ path: path.join(".tmp-mvp-e2e", `free-manual-pricing-${testInfo.project.name}.png`) });
});
