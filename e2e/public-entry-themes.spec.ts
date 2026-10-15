import { expect, test } from "@playwright/test";
import jwt from "jsonwebtoken";

test.beforeEach(async ({ context, baseURL }) => {
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Synthetic UI fixture requires loopback");
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Synthetic UI fixture requires an explicit local secret");
  const value = jwt.sign({
    userId: "synthetic-student", email: "synthetic@example.invalid", fullName: "Synthetic Student", role: "student", sessionClass: "user", sessionVersion: 0,
    browserId: "11111111-1111-4111-8111-111111111111", authGeneration: "22222222-2222-4222-8222-222222222222",
  }, secret, { algorithm: "HS256", audience: "proctorshield:user", expiresIn: "10m" });
  // Local proxy admission fixture only. No persisted account or live login.
  await context.addCookies([{ name: "ps_session_user", value, url: baseURL, httpOnly: true, sameSite: "Lax" }, {name:"ps_browser_auth",value:"11111111-1111-4111-8111-111111111111",url:baseURL,httpOnly:true,sameSite:"Lax"}]);
  await context.route("**/api/auth/session?*",route=>route.fulfill({json:{authenticated:true,user:{userId:"synthetic-student",role:"student",fullName:"Synthetic Student"}}}));
  // Keep offline visual tests deterministic. Verify the approved system-font
  // fallback; Google Fonts availability is a separate live-provider check.
  await context.route("https://fonts.googleapis.com/**", route => route.fulfill({ contentType: "text/css", body: "/* Offline font-provider fixture: system fallback. */" }));
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} public join and both 404 entries respect the saved theme`, async ({ page }, testInfo) => {
    await page.addInitScript(value => localStorage.setItem("theme", value), theme);
    await page.route("**/api/quizzes", route => route.fulfill({ json: { quizzes: [] } }));
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 900 });
    const canvas = theme === "light" ? "rgb(243, 248, 241)" : "rgb(1, 38, 32)";

    for (const path of ["/join", "/admin/login", "/public-entry-test-missing"]) {
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(path === "/join" ? 200 : 404);
      const title = path === "/join" ? "Enter Quiz Code" : "This page could not be found.";
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveCSS("--ps-canvas", theme === "light" ? "#f3f8f1" : "#012620");
      if (path === "/join") {
        const input = page.getByRole("textbox", { name: "Enter Quiz Code", exact: true });
        await expect(page.getByRole("button", { name: "Join Quiz", exact: true })).toBeDisabled();
        await input.focus();
        expect(await input.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
        expect(await page.getByRole("main").locator("..").evaluate(el => getComputedStyle(el).backgroundColor)).toBe(canvas);
      } else {
        await expect(page.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
        const artwork = page.getByRole("main").locator('img[src*="proctorshield-404-robot"]');
        await expect(artwork).toBeVisible();
        await expect(artwork).toHaveJSProperty("complete", true);
        expect(await artwork.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      if (testInfo.project.name === "mobile-chromium") {
        for (const width of [375, 390]) {
          await page.setViewportSize({ width, height: 900 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        }
        await page.setViewportSize({ width: 320, height: 900 });
      }
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${path === "/join" ? "join" : path === "/admin/login" ? "custom-404" : "generic-404"}.png`), fullPage: true });

      // Enlarge each computed text size once, including fixed-pixel text. This is
      // a text-enlargement simulation, not a claim of browser-zoom verification.
      await page.evaluate(() => {
        const sizes = Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .filter(el => el instanceof HTMLElement)
          .map(el => [el, parseFloat(getComputedStyle(el).fontSize) * 2, parseFloat(getComputedStyle(el).lineHeight) * 2] as const);
        for (const [el, size, line] of sizes) {
          el.style.fontSize = `${size}px`;
          if (Number.isFinite(line)) el.style.lineHeight = `${line}px`;
        }
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      if (testInfo.project.name === "mobile-chromium") {
        for (const width of [375, 390]) {
          await page.setViewportSize({ width, height: 900 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        }
        await page.setViewportSize({ width: 320, height: 900 });
      }
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${path === "/join" ? "join" : path === "/admin/login" ? "custom-404" : "generic-404"}-text-200.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

test("defense build denies Arena pages and API requests", async ({ request }) => {
  const api=await request.get("/api/arena/901");
  expect(api.status()).toBe(403);
  await expect(api.json()).resolves.toMatchObject({code:"FEATURE_DISABLED"});
  const page=await request.get("/arena/901");
  expect([403,404]).toContain(page.status());
});
