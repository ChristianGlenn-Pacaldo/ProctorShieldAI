import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import fs from "node:fs";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";
import { teacherScenes, teacherThemeFixture, type TeacherScene } from "./helpers/teacher-theme-fixture.ts";
import { sidebarFixture } from "./helpers/sidebar-theme-fixture.ts";

// Opt-in: node --test tests/teacher-theme.browser.ts
let browser: Browser, css: string;
before(async () => {
  css = (await postcss([tailwind({ base: process.cwd() })]).process(
    fs.readFileSync("src/app/globals.css", "utf8").replace(/^@import url\(.*?\);\s*/m, ""),
    { from: "src/app/globals.css" },
  )).css + "\n" + fs.readFileSync("src/app/dashboard/teacher/teacher-theme.css", "utf8");
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });
const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => value / 255)
  .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);

for (const scene of teacherScenes) for (const theme of ["light", "dark"] as const) for (const width of [1280, 390]) {
  test(`${scene}: selected ${theme} theme at ${width}px regardless of OS preference`, async () => {
    const shell = sidebarFixture("teacher", { storage: new Map([["theme", theme]]), systemDark: theme === "light" });
    await shell.mount();
    const routes: Record<TeacherScene, string> = { dashboard: "", playground: "/playground", arena: "/playground/arena/77",
      quizzes: "/quizzes", monitor: "/monitor", evidence: "/evidence", reports: "/reports", billing: "/billing", settings: "/settings" };
    shell.navigate("/dashboard/teacher" + routes[scene]);
    const content = teacherThemeFixture(scene);
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme === "light" ? "dark" : "light", reducedMotion: "reduce" });
    try {
      await page.route("**/*", route => route.abort());
      await page.setContent(`<!doctype html><html class="${theme === "dark" ? "dark" : ""}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${shell.html().replace("<p >Dashboard content retained</p>", content.content)}${content.portals}<div id="outside" class="bg-slate-950 text-white">Other role surface</div></body></html>`);
      assert.equal(await page.locator(".teacher-content").count(), 1, "real Teacher layout scope is present");
      await page.evaluate(async () => { await Promise.all(document.getAnimations()
        .filter(animation => Number.isFinite(animation.effect?.getTiming().iterations))
        .map(animation => animation.finished.catch(() => {}))); });
      const result = await page.evaluate(() => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d")!;
        const rgb = (value: string) => { ctx.clearRect(0,0,1,1); ctx.fillStyle = value; ctx.fillRect(0,0,1,1); return Array.from(ctx.getImageData(0,0,1,1).data); };
        const root = document.querySelector(".teacher-content")!;
        const surface = rgb(getComputedStyle(root).getPropertyValue("--surface"));
        const ink = rgb(getComputedStyle(root).color);
        const outside = getComputedStyle(document.getElementById("outside")!);
        return { surface, ink, scheme: getComputedStyle(root).colorScheme, outside: { bg: rgb(outside.backgroundColor), color: rgb(outside.color) },
          overflow: document.documentElement.scrollWidth > innerWidth,
          clippedControls: Array.from(root.querySelectorAll<HTMLElement>("button,input,select"))
            .filter(node => !node.closest(".overflow-x-auto,.overflow-auto") && node.getBoundingClientRect().width > 0)
            .filter(node => { const box=node.getBoundingClientRect(); return box.left < -1 || box.right > innerWidth + 1; })
            .map(node => node.textContent?.trim() || node.getAttribute("aria-label") || node.tagName),
          panels: Array.from(root.querySelectorAll<HTMLElement>(".bg-slate-900,.bg-slate-950,.text-white"))
            .filter(node => !node.closest(".teacher-media") && !node.matches("button,a,svg,span"))
            .map(node => { const style=getComputedStyle(node); return { tag: node.tagName, classes: node.className,
              background: rgb(style.backgroundColor), color: rgb(style.color), image: style.backgroundImage }; }),
        };
      });
      assert.equal(result.scheme, theme);
      assert.equal(luminance(result.surface) > .7, theme === "light");
      const contrast = (Math.max(luminance(result.surface), luminance(result.ink)) + .05) / (Math.min(luminance(result.surface), luminance(result.ink)) + .05);
      assert.ok(contrast >= 4.5, "Teacher text has readable contrast");
      assert.ok(luminance(result.outside.bg) < .05 && luminance(result.outside.color) > .9, "Teacher CSS does not recolor another role");
      assert.equal(result.overflow, false, "no document overflow on mobile or desktop");
      assert.deepEqual(result.clippedControls, [], "page controls stay inside the viewport");
      if (theme === "light") for (const panel of result.panels) {
        if ((panel.classes.includes("bg-slate-900") || panel.classes.includes("bg-slate-950")) && panel.background[3] > 240) {
          assert.ok(luminance(panel.background) > .7, "light panel: " + panel.classes);
        }
      }
      if (scene === "dashboard") {
        assert.equal(await page.getByText("Live Biometric Telemetry").count(), 0);
        assert.equal(await page.getByText("RADAR ACTIVE").count(), 0);
        assert.ok(await page.getByText("Violation Breakdown", { exact: false }).count());
        assert.ok(await page.locator('a[href="/dashboard/teacher/monitor"]').count(), "Live Monitor navigation is retained");
      }
      if (scene === "arena") assert.ok(await page.locator(".teacher-content header").evaluate(header => {
        const bounds = header.getBoundingClientRect();
        return Array.from(header.querySelectorAll("span,button,svg")).every(child => {
          const box = child.getBoundingClientRect();
          return box.width === 0 || box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
        });
      }), "Arena title and controls fit within the header at every width");
      if (process.env.TEACHER_THEME_SCREENSHOTS === "1" && ["dashboard", "playground", "arena", "settings"].includes(scene)) {
        fs.mkdirSync(".tmp-teacher-theme", { recursive: true });
        await page.locator("#outside").evaluate(node => node.remove());
        await page.screenshot({ path: `.tmp-teacher-theme/${scene}-${theme}-${width}.png`, fullPage: true });
      }
    } finally { shell.unmount(); await page.close(); }
  });
}

for (const [scene, variant, selector] of [
  ["playground", "free", '[class~="text-indigo-300/60"]'],
  ["playground", "free", ".bg-clip-text.text-transparent"],
  ["quizzes", "answers", '[class~="text-emerald-400/80"]'],
  ["quizzes", "locked", '[class~="text-amber-400/90"]'],
] as const) {
  test(`${scene} ${variant}: light-mode detail labels have readable ink`, async () => {
    const view = teacherThemeFixture(scene, variant);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
    try {
      await page.route("**/*", route => route.abort());
      await page.setContent(`<html><head><style>${css}</style></head><body>${view.content}${view.portals}</body></html>`);
      const labels = await page.locator(selector).all();
      assert.ok(labels.length, "rendered the real detail label");
      for (const label of labels) {
        const colors = await label.evaluate(node => {
          const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d")!;
          const rgb = (value: string) => {
            context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
            return Array.from(context.getImageData(0, 0, 1, 1).data);
          };
          const style = getComputedStyle(node), surface = rgb(style.getPropertyValue("--surface")), ink = rgb(style.color);
          return { ink: ink.map((value, index) => index < 3 ? value * ink[3] / 255 + surface[index] * (1 - ink[3] / 255) : 255), surface };
        });
        const a = luminance(colors.ink), b = luminance(colors.surface);
        assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, "detail copy has AA contrast against the light surface");
      }
    } finally { await page.close(); }
  });
}

for (const phase of ["wave", "podium"]) for (const theme of ["light", "dark"]) for (const width of [390, 1280]) {
  test(`Arena ${phase}: scores and identities retained in ${theme} at ${width}px`, async () => {
    const view = teacherThemeFixture("arena", phase);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.route("**/*", route => route.abort());
      await page.setContent(`<html class="${theme === "dark" ? "dark" : ""}"><head><style>${css}</style></head><body>${view.content}${view.portals}</body></html>`);
      assert.ok(await page.getByText("First", { exact: true }).count(), "leaderboard identity retained");
      assert.ok(await page.getByText(/^300\s*pts$/).count(), "gameplay score retained");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const identities = await page.locator('[aria-label="First identity"]').all();
      assert.ok(identities.length, "real shared Arena identity rendered");
      if (theme === "light") for (const identity of identities) assert.notEqual(
        await identity.evaluate(node => getComputedStyle(node).color), "rgb(224, 231, 255)", "identity ink adapts in Teacher light mode");
    } finally { await page.close(); }
  });
}

for (const scene of ["monitor", "evidence"] as const) for (const theme of ["light", "dark"]) {
  test(`${scene}: footage retains a dark viewing surface inside ${theme} Teacher UI`, async () => {
    const view = teacherThemeFixture(scene, scene === "evidence" ? "dialog" : "default");
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.route("**/*", route => route.abort());
      await page.setContent(`<html class="${theme === "dark" ? "dark" : ""}"><head><style>${css}</style></head><body>${view.content}${view.portals}</body></html>`);
      const media = await page.locator(".teacher-media").all();
      assert.ok(media.length, "real footage scope retained");
      for (const region of media) assert.equal(await region.evaluate(node => getComputedStyle(node).colorScheme), "dark");
      assert.ok(await page.getByText(scene === "monitor" ? "Waiting for camera snapshot" : "Evidence Replay — Fixture Student", { exact: true }).count());
    } finally { await page.close(); }
  });
}

for (const scene of ["playground", "quizzes", "evidence"] as TeacherScene[]) for (const theme of ["light", "dark"]) {
  test(`${scene} dialog uses selected ${theme} theme including body portals`, async () => {
    const content = teacherThemeFixture(scene, "dialog");
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: theme === "light" ? "dark" : "light" });
    try {
      await page.route("**/*", route => route.abort());
      await page.setContent(`<html class="${theme === "dark" ? "dark" : ""}"><head><style>${css}</style></head><body><main class="dashboard-main">${content.content}</main>${content.portals}</body></html>`);
      assert.ok(await page.locator("input,button").count(), "dialog actions retained");
      for (const scope of await page.locator(".teacher-content").all()) assert.equal(await scope.evaluate(node => getComputedStyle(node).colorScheme), theme);
      const surfaces = await page.locator('.teacher-content [class~="bg-slate-900"],.teacher-content.bg-slate-950,.teacher-content [class~="bg-[#111]"]').all();
      assert.ok(surfaces.length, "dialog has a styled panel");
      for (const panel of surfaces) assert.equal(await panel.evaluate(node => {
        if (node.closest(".teacher-media")) return true;
        const style = getComputedStyle(node); return style.backgroundColor;
      }).then(value => value === true || (theme === "light" ? /255|237/.test(value as string) : !(value as string).includes("255, 255, 255"))), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    } finally { await page.close(); }
  });
}

test("Teacher page styles switch without document reload and preference survives navigation/remount", async () => {
  const storage = new Map<string,string>([["theme","light"]]);
  const shell = sidebarFixture("teacher", { storage, systemDark: true }); await shell.mount();
  const view = teacherThemeFixture("playground");
  const page = await browser.newPage();
  try {
    await page.setContent(`<html><head><style>${css}</style></head><body>${view.content}</body></html>`);
    const panel = page.locator('[class~="bg-slate-900/80"]').first();
    const light = await panel.evaluate(node => getComputedStyle(node).backgroundColor);
    await shell.click("Switch to dark theme");
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    assert.notEqual(await panel.evaluate(node => getComputedStyle(node).backgroundColor), light);
    assert.equal(storage.get("theme"), "dark");
    shell.navigate("/dashboard/teacher/settings"); assert.ok(shell.classes.has("dark")); shell.unmount();
    const reloaded = sidebarFixture("teacher", { storage, systemDark: false }); await reloaded.mount();
    assert.ok(reloaded.classes.has("dark")); reloaded.unmount();
  } finally { shell.unmount(); await page.close(); }
});

for (const scene of ["playground", "arena", "settings"] as TeacherScene[]) for (const theme of ["light", "dark"]) {
  test(`${scene} error messages remain readable in selected ${theme} theme`, async () => {
    const view = teacherThemeFixture(scene, "error");
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.setContent(`<html class="${theme === "dark" ? "dark" : ""}"><head><style>${css}</style></head><body>${view.content}${view.portals}</body></html>`);
      const message = page.getByText(/Could not (launch|update|save)/).first();
      const colors = await message.evaluate(node => {
        const canvas=document.createElement("canvas"), context=canvas.getContext("2d")!;
        canvas.width=canvas.height=1;
        const rgb=(value:string)=>{ context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return Array.from(context.getImageData(0,0,1,1).data); };
        let panel: Element | null = node;
        while (panel && getComputedStyle(panel).backgroundColor === "rgba(0, 0, 0, 0)") panel = panel.parentElement;
        const color=rgb(getComputedStyle(node).color), background=rgb(getComputedStyle(panel!).backgroundColor);
        const surface=rgb(getComputedStyle(node).getPropertyValue("--surface"));
        return { color, background: background.map((value,index)=>index < 3 ? value * background[3]/255 + surface[index]*(1-background[3]/255) : 255) };
      });
      const a=luminance(colors.color), b=luminance(colors.background);
      assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05) >= 4.5, "error copy has AA contrast");
      if (scene === "settings") assert.ok(await page.getByRole("status").evaluate(node => {
        const box = node.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && node.scrollWidth <= node.clientWidth;
      }), "long Settings feedback stays inside the mobile viewport");
    } finally { await page.close(); }
  });
}
