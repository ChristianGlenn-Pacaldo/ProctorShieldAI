import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "playwright";
import { sidebarFixture } from "./helpers/sidebar-theme-fixture.ts";

// Opt-in browser regression: node --test tests/sidebar-theme.browser.ts
// Uses the real dashboard CSS and shell markup, without a server/database/camera.
let browser: Browser, css: string;
before(async () => {
  css = (await postcss([tailwind({ base: process.cwd() })]).process(
    fs.readFileSync("src/app/globals.css", "utf8").replace(/^@import url\(.*?\);\s*/m, ""),
    { from: path.resolve("src/app/globals.css") },
  )).css;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });
type RGB = number[];
const luminance = (rgb: RGB) => rgb.slice(0, 3).map((channel) => channel / 255)
  .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
function contrast(foreground: RGB, background: RGB, minimum: number, label: string) {
  const foregroundLight = luminance(foreground), backgroundLight = luminance(background);
  const ratio = (Math.max(foregroundLight, backgroundLight) + 0.05) / (Math.min(foregroundLight, backgroundLight) + 0.05);
  assert.ok(ratio >= minimum, `${label} contrast ${ratio.toFixed(2)} must be >= ${minimum}`);
}
async function styles(page: Page, selector: string) {
  return page.locator(selector).first().evaluate(async (element) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(element.getAnimations().filter((animation) => animation instanceof CSSTransition).map((animation) => animation.finished.catch(() => {})));
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const rgb = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data); };
    const style = getComputedStyle(element), icon = element.querySelector("svg");
    return { color: rgb(style.color), background: rgb(style.backgroundColor), image: style.backgroundImage,
      surface: rgb(style.getPropertyValue("--surface")), surface2: rgb(style.getPropertyValue("--surface2")),
      opacity: Number(style.opacity), border: rgb(style.borderRightColor), outline: rgb(style.outlineColor), outlineStyle: style.outlineStyle,
      icon: icon ? rgb(getComputedStyle(icon).color) : null, transform: style.transform };
  });
}
async function show(page: Page, fixture: ReturnType<typeof sidebarFixture>) {
  await page.setContent(`<!doctype html><html class="${fixture.classes.has("dark") ? "dark" : ""}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="app-motion-scope">${fixture.html()}</body></html>`);
}
for (const role of ["student", "teacher", "admin"] as const) {
  for (const theme of ["light", "dark"] as const) for (const width of [1280, 390]) {
    test(`${role} ${theme} sidebar and dropdown contrast at ${width}px, independent of OS theme`, async () => {
      const fixture = sidebarFixture(role, { storage: new Map([["theme", theme]]), systemDark: theme === "light" });
      await fixture.mount(); if (width < 1024) await fixture.click("Open navigation menu");
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme === "light" ? "dark" : "light", reducedMotion: "reduce" });
      try {
        await page.route("**/*", (route) => route.abort()); await show(page, fixture);
        const sidebar = await styles(page, ".dashboard-sidebar");
        assert.equal(luminance(sidebar.background) > 0.7, theme === "light");
        assert.ok(sidebar.border[3] > 0, "sidebar divider remains visible");
        assert.ok(await page.locator(".dashboard-sidebar").evaluate((element) => element.getBoundingClientRect().left >= 0));
        const normalSelector = ".dashboard-sidebar nav a:not(.dashboard-nav-active)";
        const normal = await styles(page, normalSelector);
        for (const background of [sidebar.surface, sidebar.surface2]) {
          contrast(normal.color, background, 4.5, "normal navigation"); contrast(normal.icon!, background, 3, "normal icon");
        }
        for (const selector of [".dashboard-sidebar .font-bold", ".dashboard-sidebar nav > div > div", ".dashboard-sidebar > div:last-child .font-semibold", ".dashboard-sidebar > div:last-child .capitalize"]) {
          const text = await styles(page, selector); contrast(text.color, sidebar.surface2, 4.5, "sidebar identity/section");
        }
        await page.locator(normalSelector).first().hover(); const hovered = await styles(page, normalSelector);
        contrast(hovered.color, hovered.background, 4.5, "hovered navigation");
        await page.locator(normalSelector).first().focus(); const focused = await styles(page, normalSelector);
        assert.equal(focused.outlineStyle, "solid"); contrast(focused.outline, sidebar.surface2, 3, "keyboard focus ring");
        const active = await styles(page, ".dashboard-nav-active");
        const backgrounds = active.image.match(/rgb\([^)]+\)/g)!.map((value) => value.match(/[\d.]+/g)!.map(Number));
        for (const background of backgrounds) { contrast(active.color, background, 4.5, "active navigation"); contrast(active.icon!, background, 3, "active icon"); }
        if (role === "teacher") {
          await page.locator(".dashboard-nav-badge").evaluate((element) => {
            for (const animation of element.getAnimations()) if (animation instanceof CSSAnimation && animation.animationName === "pulse") {
              animation.pause(); animation.currentTime = Number(animation.effect!.getComputedTiming().duration) / 2;
            }
          });
          const badge = await styles(page, ".dashboard-nav-badge");
          const composite = (color: RGB) => color.slice(0, 3).map((channel, index) => channel * badge.opacity + sidebar.surface2[index] * (1 - badge.opacity));
          contrast(composite(badge.color), composite(badge.background), 4.5, "Pro badge at its minimum opacity");
          const arena = await styles(page, 'nav a[href="/dashboard/teacher/playground"]'); contrast(arena.icon!, sidebar.surface2, 3, "Arena icon");
        }
        await page.locator(normalSelector).first().evaluate((element) => element.setAttribute("aria-disabled", "true"));
        await page.locator(normalSelector).first().hover(); const disabled = await styles(page, normalSelector);
        contrast(disabled.color, sidebar.surface2, 4.5, "disabled navigation");
        if (width < 1024) await fixture.click("Close navigation menu");
        await fixture.click("Open profile menu"); await show(page, fixture);
        const dropdown = await styles(page, ".dashboard-dropdown");
        assert.equal(luminance(dropdown.background) > 0.7, theme === "light");
        const profileLink = '.dashboard-dropdown a'; await page.locator(profileLink).hover();
        const profileHover = await styles(page, profileLink); contrast(profileHover.color, sidebar.surface2, 4.5, "profile menu hover");
        const signOut = await styles(page, ".dashboard-dropdown button"); contrast(signOut.color, sidebar.surface2, 4.5, "sign-out text");
        await page.locator('[aria-label="Open notifications"]').evaluate((element: HTMLButtonElement) => { element.disabled = true; });
        await page.locator('[aria-label="Open notifications"]').hover(); const disabledBell = await styles(page, '[aria-label="Open notifications"]');
        contrast(disabledBell.color, disabledBell.background, 4.5, "disabled notification button");
        await fixture.click("Open notifications"); await show(page, fixture);
        const notifications = await styles(page, ".dashboard-dropdown"); assert.equal(luminance(notifications.background) > 0.7, theme === "light");
        const emptyNotice = await styles(page, ".dashboard-dropdown .text-center"); contrast(emptyNotice.color, sidebar.surface2, 4.5, "notification empty state");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "dashboard has no horizontal overflow");
      } finally { fixture.unmount(); await page.close(); }
    });
  }
  test(role + " sidebar, text and dividers update on root theme change without reloading the document", async () => {
    const fixture = sidebarFixture(role); await fixture.mount();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.route("**/*", (route) => route.abort()); await show(page, fixture);
      const light = await styles(page, ".dashboard-sidebar");
      await page.evaluate(() => { (window as any).sameDocument = true; document.documentElement.classList.add("dark"); });
      const dark = await styles(page, ".dashboard-sidebar"); assert.notDeepEqual(dark.background, light.background); assert.notDeepEqual(dark.border, light.border);
      const text = await styles(page, ".dashboard-sidebar nav a:not(.dashboard-nav-active)"); assert.ok(luminance(text.color) > luminance(dark.background));
      await page.evaluate(() => document.documentElement.classList.remove("dark"));
      assert.deepEqual((await styles(page, ".dashboard-sidebar")).background, light.background);
      assert.equal(await page.evaluate(() => (window as any).sameDocument), true);
    } finally { fixture.unmount(); await page.close(); }
  });
}
