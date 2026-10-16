import { expect, test } from "@playwright/test";
import path from "node:path";

test("Free pricing advertises the enforced monthly allowance and reset", async ({ page, context, baseURL }, testInfo) => {
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Use the isolated loopback fixture");
  await context.route("https://fonts.googleapis.com/**", route => route.fulfill({ contentType: "text/css", body: "/* offline font fixture */" }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const pricing = page.locator("#pricing");
  await expect(pricing.getByText("5 manual quizzes per calendar month", { exact: true })).toBeVisible();
  await expect(pricing.getByText("Allowance resets on the 1st (UTC+8)", { exact: true })).toBeVisible();
  await expect(pricing.getByText(/lifetime manual quizzes/)).toHaveCount(0);
  await pricing.screenshot({ path: path.join(".tmp-mvp-e2e", `monthly-pricing-${testInfo.project.name}.png`) });
});
