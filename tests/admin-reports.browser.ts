import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";

// Actual components/CSS and shared shell; all sessions and records are synthetic.
const root = process.cwd();
const temp = path.join(root, ".tmp-admin-reports");
const evidence = path.resolve(process.env.UI_QA_ARTIFACT_DIR || "release-review/admin-reports");
let browser: Browser, server: http.Server, origin: string;
const results: object[] = [];
const eventLabels = ["Tab Switch", "No Face", "Device Detected", "Multiple Faces", "Looking Left", "Looking Right", "Looking Up", "Looking Down", "Audio Anomaly", "Fullscreen Exit", "Clipboard Attempt", "Camera Unavailable"];
before(async () => {
  fs.mkdirSync(temp, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(temp, "entry.tsx"), `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import Shell from '../src/components/dashboard-shell';
    import Logs from '../src/app/dashboard/admin/logs/content';
    import Analytics from '../src/app/dashboard/admin/analytics/content';
    createRoot(document.getElementById('root')).render(<Shell role="admin" userName="Synthetic Admin" userInitials="SA"><div className="ps-admin-page">{location.pathname.endsWith('logs')?<Logs/>:<Analytics/>}</div></Shell>);
  `);
  const stubs: Record<string, string> = {
    "next/navigation": "export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>location.pathname;",
    "next/link": "import React from 'react';export default function Link({prefetch,...p}){return React.createElement('a',p)}",
    "next/image": "import React from 'react';export default function Image({priority,preload,fill,sizes,quality,...p}){return React.createElement('img',p)}",
    "pusher-js": "export default class Pusher{connection={bind(){},unbind(){}};subscribe(){return{bind(){},unbind(){},unbind_all(){}}}unsubscribe(){}disconnect(){}}",
  };
  await build({ entryPoints: [path.join(temp, "entry.tsx")], outfile: path.join(temp, "bundle.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_PUSHER_KEY": '"synthetic"', "process.env.NEXT_PUBLIC_PUSHER_CLUSTER": '"ap1"' }, plugins: [{ name: "synthetic-boundaries", setup(b) {
    b.onResolve({ filter: /^(next\/(navigation|link|image)|pusher-js)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: stubs[a.path], loader: "js", resolveDir: root }));
  } }] });
  const css = (await postcss([tailwind({ base: root })]).process(fs.readFileSync("src/app/globals.css", "utf8").replace(/^@import url\(.*?\);\s*/m, ""), { from: "src/app/globals.css" })).css;
  fs.writeFileSync(path.join(temp, "base.css"), css + ["admin.css", "admin-glass.css", "logs/logs.css", "logs/print.css"].map(p => fs.readFileSync("src/app/dashboard/admin/" + p, "utf8")).join("\n"));
  server = http.createServer((req, res) => {
    const file = req.url === "/base.css" ? "base.css" : req.url === "/bundle.js" ? "bundle.js" : null;
    res.setHeader("Content-Type", file === "base.css" ? "text/css" : file ? "text/javascript" : "text/html");
    res.end(file ? fs.readFileSync(path.join(temp, file)) : '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/base.css"></head><body class="app-motion-scope"><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, args: ["--disable-gpu"] });
});
after(async () => {
  await browser?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  fs.writeFileSync(path.join(evidence, "BROWSER_RESULTS.json"), JSON.stringify({ scope: "Actual Admin components and CSS; synthetic transport and accounts; no real academic records", results }, null, 2));
});

for (const scene of ["analytics", "logs"]) for (const width of [360, 390, 768, 1280, 1440]) for (const theme of ["light", "dark"] as const) {
  test(`${scene} ${width}px ${theme}: chart scope and printable current-page report`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 950 }, colorScheme: theme });
    const errors: string[] = [], writes: string[] = [];
    let failLogs = false;
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(theme => {
      localStorage.setItem("theme", theme);
      Object.assign(window, { printCalls: 0 });
      window.print = () => { (window as unknown as {printCalls:number}).printCalls++; };
    }, theme);
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) {
        const asset = path.join(root, "public", url.pathname);
        if (url.pathname.startsWith("/images/") && fs.existsSync(asset)) return route.fulfill({ path: asset });
        return /\.(png|svg|webp)$/.test(url.pathname) ? route.fulfill({ status: 204 }) : route.continue();
      }
      if (route.request().method() !== "GET") writes.push(url.pathname);
      let data: object = { success: true, notifications: [], unreadCount: 0 };
      if (url.pathname === "/api/auth/session") data = { success: true, authenticated: true, user: { userId: "synthetic", role: "admin", fullName: "Synthetic Admin" } };
      if (url.pathname.endsWith("/analytics")) data = {
        success: true, userStats: { totalUsers: 23, totalStudents: 14, totalTeachers: 8, totalAdmins: 1, newUsersThisMonth: 0 },
        subscriptionStats: { proTeachers: 0, freeTeachers: 8, conversionPct: 0 }, quizStats: { totalQuizzes: 6, completedQuizzes: 2, totalAttempts: 40 },
        aiStats: { totalVerdicts: 0, totalViolations: 0, cleanCount: 0, suspiciousCount: 0, cheatedCount: 0, cleanPct: 0, suspiciousPct: 0, cheatedPct: 0, flaggedPct: 0 },
      };
      if (url.pathname.endsWith("/logs")) {
        if (failLogs) return route.fulfill({ status: 500, json: { success: false } });
        const p = Number(url.searchParams.get("page"));
        data = { success: true, total: 50, page: p, pageSize: 25, logs: Array.from({ length: 25 }, (_, i) => {
          const event = eventLabels[((p - 1) * 25 + i) % eventLabels.length];
          const severity = ["Device Detected", "Multiple Faces"].includes(event) ? "High"
            : ["Tab Switch", "No Face", "Looking Left", "Looking Right", "Looking Up", "Looking Down", "Audio Anomaly"].includes(event) ? "Medium" : "Low";
          return { id: String((p - 1) * 25 + i + 1), timestamp: "Oct 16, 2026, 09:30 AM", event, severity,
            rowBg: severity === "High" ? "bg-rose-50 dark:bg-rose-500/5" : severity === "Medium" ? "bg-amber-50 dark:bg-amber-500/5" : "",
            confidence: "92%", student: `Synthetic Student ${(p - 1) * 25 + i + 1}`, quiz: "Synthetic Academic Quiz With A Long Title That Must Print In Full" };
        }) };
      }
      return route.fulfill({ json: data });
    });
    try {
      await page.goto(`${origin}/dashboard/admin/${scene}`);
      const target = page.getByRole("heading", { name: scene === "logs" ? "🧠 Global AI Event Logs" : "📊 Platform Distribution", exact: true });
      await target.waitFor();
      await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      if (scene === "analytics") {
        const chart = target.locator("../..");
        assert.equal(await chart.locator(".ps-admin-bar").count(), 2);
        assert.equal(await chart.getByText("Admins", { exact: true }).count(), 0);
        assert.deepEqual(await chart.locator(".ps-admin-bar > div > div").evaluateAll(els => els.map(el => (el as HTMLElement).style.width)), ["64%", "36%"]);
        assert.equal(await page.locator(".ps-admin-bar").filter({ hasText: "PRO (Active)" }).locator("div > div").evaluate(el => (el as HTMLElement).style.width), "0%");
      } else {
        const print = page.getByRole("button", { name: "Print / Save as PDF", exact: true });
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await page.getByText("Showing 26–50 of 50", { exact: true }).waitFor();
        assert.deepEqual(await page.locator("thead th").allTextContents(), ["Timestamp", "Event Type", "Confidence", "Student", "Quiz"]);
        assert.equal(await page.locator("tbody td").count(), 125);
        const eventStyles = await page.locator("tbody .ps-ai-log-badge").evaluateAll(elements => elements.map(element => {
          const style = getComputedStyle(element);
          const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
          const luminance = (value: string) => rgb(value).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
          const fg = luminance(style.color), bg = luminance(style.backgroundColor);
          return { priority: element.getAttribute("data-priority"), contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05), rowBackground: getComputedStyle(element.closest("tr")!).backgroundColor };
        }));
        assert.equal(new Set(eventStyles.map(style => style.priority)).size, 3);
        assert.ok(eventStyles.every(style => style.contrast >= 4.5), JSON.stringify(eventStyles));
        assert.ok(eventStyles.every(style => style.rowBackground === "rgba(0, 0, 0, 0)"));
        for (let i = 0; i < 25; i++) {
          const cells = page.locator("tbody tr").nth(i).locator("td");
          assert.equal(await cells.nth(1).innerText(), eventLabels[(25 + i) % eventLabels.length]);
          assert.equal(await cells.nth(3).innerText(), `Synthetic Student ${26 + i}`);
        }
        await print.focus(); await page.keyboard.press("Enter");
        assert.equal(await page.evaluate(() => (window as unknown as {printCalls:number}).printCalls), 1);
        assert.equal(await page.locator("tbody tr").count(), 25);
        if (width === 1280) {
          await page.emulateMedia({ media: "print" });
          await page.setViewportSize({ width: 794, height: 1123 });
          assert.equal(await page.locator(".dashboard-sidebar").isVisible(), false);
          assert.equal(await page.locator(".dashboard-topbar").isVisible(), false);
          assert.equal(await print.isVisible(), false);
          assert.match(await page.locator(".ps-ai-log-print-summary").innerText(), /Page 2 of 2 · Displayed records 26–50 of 50/);
          const cells = await page.locator("tbody td").evaluateAll(els => els.map(el => ({ overflow: getComputedStyle(el).overflow, whitespace: getComputedStyle(el).whiteSpace, width: el.clientWidth, scroll: el.scrollWidth })));
          assert.ok(cells.every(cell => cell.overflow === "visible" && cell.whitespace === "normal" && cell.scroll <= cell.width + 1));
          assert.equal(await page.locator(".ps-ai-log-report").evaluate(el => getComputedStyle(el).color), "rgb(17, 17, 17)");
          assert.equal(await page.locator(".ps-admin-glass-caption").evaluate(el => getComputedStyle(el).color), "rgb(17, 17, 17)");
          assert.equal(await page.locator(".ps-ai-log-report .ps-admin-glass-card").evaluate(el => getComputedStyle(el).boxShadow), "none");
          assert.equal(await page.locator(".ps-ai-log-report .ps-admin-glass-card").evaluate(el => getComputedStyle(el, "::after").display), "none");
          await page.pdf({ path: path.join(evidence, `synthetic-log-page-2-${theme}.pdf`), format: "A4", margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" }, printBackground: false });
          await page.emulateMedia({ media: "screen" }); await page.setViewportSize({ width, height: 950 });
        }
        await page.locator(".dashboard-main").evaluate(element => { element.scrollTop = 0; });
        await page.screenshot({ path: path.join(evidence, `${scene}-${width}-${theme}.png`), fullPage: true });
        failLogs = true;
        await page.getByRole("button", { name: "Previous", exact: true }).click();
        await page.getByRole("alert").waitFor();
        assert.equal(await print.isDisabled(), true, "stale results cannot be printed through the action after a failed load");
      }
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(evidence, `${scene}${scene === "logs" ? "-load-error" : ""}-${width}-${theme}.png`), fullPage: true });
      results.push({ scene, width, theme, status: "passed", writes: 0 });
    } finally { await page.close(); }
  });
}
