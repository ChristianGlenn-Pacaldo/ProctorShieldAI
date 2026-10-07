import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";
import { arenaHeaderFixture } from "./helpers/arena-header-fixture.ts";

// Opt-in: node --test tests/arena-header.browser.ts
// Real student Arena markup and compiled project CSS, with no app services.
let browser: Browser, css: string;
before(async () => {
  css = (await postcss([tailwind({ base: process.cwd() })]).process(
    fs.readFileSync("src/app/globals.css", "utf8").replace(/^@import url\(.*?\);\s*/m, ""),
    { from: path.resolve("src/app/globals.css") },
  )).css;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });
for (const width of [320, 390, 768, 1280]) for (const mode of ["lobby", "gameplay", "spectator"]) {
  test(mode + " header keeps controls and values visible without clipping at " + width + "px", async () => {
    const view = arenaHeaderFixture({ phase: mode === "lobby" ? "lobby" : "in_wave",
      questionsCompleted: mode === "spectator", isSpectating: mode === "spectator",
      matchTimeLeft: 754, score: 12345, studentRank: 12, totalParticipants: 120 },
      { quizTitle: "Operating Systems and Computer Science Championship — Advanced Round with a Long Title" });
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    try {
      await page.route("**/*", (route) => route.abort());
      await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body>' + view.html() + '</body></html>');
      const header = page.locator("header").first();
      for (const selector of ["button", "[data-arena-identity]", '[title="Overall Arena Match Time Remaining"]']) {
        for (const element of await header.locator(selector).all()) {
          assert.ok(await element.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth && rect.width > 0 && rect.height > 0;
          }), selector + " clipped outside viewport");
        }
      }
      assert.ok(await header.evaluate((node) => node.scrollWidth <= node.clientWidth), "header content overflows its container");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "horizontal page overflow");
      if (mode !== "lobby") {
        for (const label of ["12:34", "12345 PTS", "#12"]) await header.getByText(label, { exact: true }).waitFor({ state: "visible" });
        assert.ok(await header.locator('[title="Overall Arena Match Time Remaining"]').evaluate((node) => node.scrollWidth <= node.clientWidth), "timer text clipped");
      }
      if (process.env.ARENA_HEADER_SCREENSHOTS === "1") {
        fs.mkdirSync(".tmp-arena-header-preview", { recursive: true });
        await page.screenshot({ path: ".tmp-arena-header-preview/" + mode + "-" + width + ".png" });
      }
    } finally { await page.close(); }
  });
}
