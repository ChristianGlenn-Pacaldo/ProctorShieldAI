import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "playwright";
import { studentThemeFixture, type StudentScene } from "./helpers/student-theme-fixture.ts";
import { sidebarFixture } from "./helpers/sidebar-theme-fixture.ts";

// Opt-in, one browser process: node --test --test-concurrency=1 tests/student-theme.browser.ts
// Renders the real JSX/CSS with disposable display data; not server-authenticated E2E.
let browser: Browser, css: string;
before(async () => {
  css = (await postcss([tailwind({ base: process.cwd() })]).process(
    fs.readFileSync("src/app/globals.css", "utf8").replace(/^@import url\(.*?\);\s*/m, ""),
    { from: path.resolve("src/app/globals.css") })).css;
  // Include Teacher styles to catch collisions after cross-role navigation.
  css += "\n" + fs.readFileSync("src/app/dashboard/teacher/teacher-theme.css", "utf8");
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

const luminance = (rgb: number[]) => rgb.slice(0, 3).map(channel => channel / 255)
  .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
async function readable(page: Page, selector: string, backgroundToken = "--surface", minimum = 4.5) {
  const values = await page.locator(selector).first().evaluate((node, token) => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const rgb = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data); };
    const style = getComputedStyle(node);
    return { foreground: rgb(style.color), background: rgb(style.getPropertyValue(token)) };
  }, backgroundToken);
  const a = luminance(values.foreground), b = luminance(values.background);
  assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= minimum, `${selector} must have readable contrast`);
}
async function render(scene: StudentScene, theme: string, width: number, variant = "default") {
  const shell = sidebarFixture("student", { storage: new Map([["theme", theme]]), systemDark: theme === "light" });
  await shell.mount();
  shell.navigate(`/dashboard/student${scene === "dashboard" ? "" : "/" + scene}`);
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme === "light" ? "dark" : "light", reducedMotion: "reduce" });
  await page.route("**/*", route => route.abort());
  await page.setContent(`<!doctype html><html class="${theme === "dark" ? "dark" : ""}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${shell.html().replace("<p >Dashboard content retained</p>", `<div id="student-view">${studentThemeFixture(scene, variant)}</div>`)}</body></html>`);
  await page.evaluate(async () => { await Promise.all(document.getAnimations()
    .filter(animation => Number.isFinite(animation.effect?.getTiming().iterations))
    .map(animation => animation.finished.catch(() => {}))); });
  return { page, shell };
}

for (const scene of ["dashboard", "settings"] as StudentScene[]) for (const theme of ["light", "dark"]) for (const width of [1280, 390, 320]) {
  test(`Student ${scene}: selected ${theme} at ${width}px with opposite OS preference`, async () => {
    const { page, shell } = await render(scene, theme, width);
    try {
      await readable(page, "#student-view h1");
      const layout = await page.locator("#student-view").evaluate(root => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        clipped: [...root.querySelectorAll<HTMLElement>("button,input")].filter(node => {
          const box = node.getBoundingClientRect(); return box.width > 0 && (box.left < 0 || box.right > innerWidth + 1);
        }).map(node => node.outerHTML),
      }));
      assert.equal(layout.overflow, false);
      assert.deepEqual(layout.clipped, []);
      assert.equal(await page.locator(".teacher-content").count(), 0);
      if (scene === "dashboard") {
        await readable(page, '[aria-label="Quiz access code"]', "--surface2");
        assert.equal(await page.getByText("Average Exam Score", { exact: true }).count(), 1);
        assert.equal(await page.getByText("70%", { exact: true }).count(), 1);
        assert.equal(await page.getByText("213 pts", { exact: true }).count(), 1);
        assert.equal(await page.getByText("213%", { exact: true }).count(), 0);
        assert.equal(await page.getByText(/EXP Earned|Student Progression|Level Progression/i).count(), 0);
      } else {
        for (const id of ["student-full-name", "student-email", "student-current-password", "student-new-password", "student-confirm-password"]) {
          assert.equal(await page.locator(`label[for="${id}"]`).count(), 1);
          await readable(page, `#${id}`, "--surface2");
        }
        assert.equal(await page.getByRole("button", { name: "Show current password" }).count(), 1);
      }
      await page.screenshot({ path: path.join(process.env.UI_QA_ARTIFACT_DIR || "test-results", `student-${scene}-${theme}-${width}.png`), fullPage: true });
    } finally { shell.unmount(); await page.close(); }
  });
}

for (const theme of ["light", "dark"]) for (const variant of ["error", "success"]) {
  test(`Student Settings ${variant} feedback wraps and remains readable in ${theme}`, async () => {
    const { page, shell } = await render("settings", theme, 320, variant);
    try {
      await readable(page, variant === "error" ? '[role="alert"]' : '[role="status"]');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    } finally { shell.unmount(); await page.close(); }
  });
}
for (const variant of ["empty", "loading", "join-error"]) {
  test(`Student Dashboard ${variant} state renders without missing content`, async () => {
    const { page, shell } = await render("dashboard", "light", 390, variant);
    try {
      const text = await page.locator("#student-view").innerText();
      assert.match(text, variant === "empty" ? /All caught up!/ : variant === "loading" ? /Scanning for active missions/ : /Could not join this quiz/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    } finally { shell.unmount(); await page.close(); }
  });
}
test("Student Dashboard and Results render the same 70% mixed-history exam average", async () => {
  for (const scene of ["dashboard", "results"] as StudentScene[]) {
    const { page, shell } = await render(scene, "light", 1280);
    try { assert.equal(await page.getByText("70%", { exact: true }).count(), 1); }
    finally { shell.unmount(); await page.close(); }
  }
});
test("Student selected theme changes CSS immediately and survives navigation/reload with Teacher CSS loaded", async () => {
  const storage = new Map([["theme", "light"]]);
  const shell = sidebarFixture("student", { storage, systemDark: true }); await shell.mount();
  const page = await browser.newPage();
  try {
    await page.setContent(`<html><head><style>${css}</style></head><body>${studentThemeFixture("dashboard")}</body></html>`);
    const hero = page.locator('[class~="from-[var(--surface)]"]').first();
    const light = await hero.evaluate(node => getComputedStyle(node).backgroundImage);
    await shell.click("Switch to dark theme");
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    assert.notEqual(await hero.evaluate(node => getComputedStyle(node).backgroundImage), light);
    assert.equal(storage.get("theme"), "dark");
    shell.navigate("/dashboard/student/settings"); assert.ok(shell.classes.has("dark")); shell.unmount();
    const reloaded = sidebarFixture("student", { storage, systemDark: false }); await reloaded.mount();
    assert.ok(reloaded.classes.has("dark")); reloaded.unmount();
  } finally { shell.unmount(); await page.close(); }
});
