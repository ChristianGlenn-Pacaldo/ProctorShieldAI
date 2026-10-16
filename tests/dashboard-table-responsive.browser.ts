import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";

// Actual client components, shell and compiled CSS. Only navigation, realtime
// and API boundaries are synthetic; no configured database/account is used.
const root = process.cwd();
const temp = path.join(root, ".tmp-dashboard-table-review");
const evidence = path.join(root, "release-review/dashboard-tables-2026-10-16");
let browser: Browser, server: http.Server, origin: string;
const results: object[] = [];
before(async () => {
  fs.mkdirSync(temp, { recursive: true });
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(temp, "entry.tsx"), `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Shell from '../src/components/dashboard-shell';
    import Student from '../src/app/dashboard/student/quizzes/content';
    import Teacher from '../src/app/dashboard/teacher/quizzes/content';
    import Admin from '../src/app/dashboard/admin/content';
    import Users from '../src/app/dashboard/admin/users/content';
    import TeacherOverview from '../src/app/dashboard/teacher/content';
    import Results from '../src/app/dashboard/student/results/content';
    import AdminQuizzes from '../src/app/dashboard/admin/quizzes/content';
    const scene=new URLSearchParams(location.search).get('scene');
    const role=scene.startsWith('student')?'student':scene.startsWith('teacher')?'teacher':'admin';
    const node=scene==='student-results'?<Results/>:scene==='student'?<Student/>:scene==='teacher-overview'?<TeacherOverview teacherId="synthetic" isSubscribed={true}/>:scene==='teacher'?<Teacher isSubscribed={true} teacherName="Synthetic Teacher"/>:scene==='users'?<Users/>:scene==='admin-quizzes'?<AdminQuizzes/>:<Admin/>;
    createRoot(document.getElementById('root')).render(<Shell role={role} userName={'Synthetic '+role} userInitials="QA"><div className={role==='teacher'?'teacher-content ps-teacher-page':role==='admin'?'ps-admin-page':'ps-student-page'}>{node}</div></Shell>);
  `);
  const stubs: Record<string, string> = {
    "next/navigation": "export const useRouter=()=>({push:url=>{window.__navigation=url},replace:url=>{window.__navigation=url},refresh(){}});export const usePathname=()=>location.pathname;",
    "next/link": "import React from 'react';export default function Link({prefetch,...props}){return React.createElement('a',props)}",
    "next/image": "import React from 'react';export default function Image({priority,preload,fill,sizes,quality,...props}){return React.createElement('img',props)}",
    "pusher-js": "export default class Pusher{connection={bind(){},unbind(){}};subscribe(){return{bind(){},unbind(){},unbind_all(){}}}unsubscribe(){}disconnect(){}}",
  };
  await build({ entryPoints: [path.join(temp, "entry.tsx")], outfile: path.join(temp, "bundle.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_PUSHER_KEY": '"synthetic"', "process.env.NEXT_PUBLIC_PUSHER_CLUSTER": '"ap1"' }, plugins: [{ name: "synthetic-boundaries", setup(b) {
    b.onResolve({ filter: /^(next\/(navigation|link|image)|pusher-js)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: stubs[a.path], loader: "js", resolveDir: root }));
  } }] });
  const css = (await postcss([tailwind({ base: root })]).process(fs.readFileSync("src/app/globals.css", "utf8").replace(/^@import url\(.*?\);\s*/m, ""), { from: "src/app/globals.css" })).css;
  fs.writeFileSync(path.join(temp, "base.css"), css + ["teacher/teacher-theme.css", "teacher/teacher-glass.css", "student/student.css", "student/student-glass.css", "admin/admin.css", "admin/admin-glass.css"].map(p => fs.readFileSync("src/app/dashboard/" + p, "utf8")).join("\n"));
  server = http.createServer((req, res) => {
    const file = req.url === "/base.css" ? "base.css" : req.url === "/bundle.js" ? "bundle.js" : null;
    res.setHeader("Content-Type", file === "base.css" ? "text/css" : file ? "text/javascript" : "text/html");
    res.end(file ? fs.readFileSync(path.join(temp, file)) : '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/base.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  fs.writeFileSync(path.join(evidence, "BROWSER_RESULTS.json"), JSON.stringify({ scope: "Actual dashboard client components and CSS; synthetic APIs, session, navigation and realtime; no live authenticated or database checks", results }, null, 2));
});

const users = ["Student", "Teacher"].map((role, i) => ({ id: `synthetic-${i}`, name: `Synthetic ${role} With A Long Family Name`, email: `${"long-email-".repeat(7)}${i}@example.invalid`, role, roleClass: "bg-indigo-500/10 text-indigo-600", plan: role === "Teacher" ? "Free Tier" : "N/A", status: i ? "Suspended" : "Active", statusClass: i ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-600", isOnline: false, subscription: "Free Plan", joined: "Oct 16, 2026" }));
const quiz = { id: 7, title: "Synthetic Assessment " + "LongTitle".repeat(16), quizMode: "proctored", quizStatus: "in_progress", duration: 30, totalQuestions: 2, subject: { subjectName: "Computer Science and Information Technology" }, accessCode: "PS-SYNTHETIC", participantCount: 2, participantLimit: 100 };
const scenes: Record<string, string> = { student: "/dashboard/student/quizzes", teacher: "/dashboard/teacher/quizzes", admin: "/dashboard/admin", users: "/dashboard/admin/users", "student-results": "/dashboard/student/results", "teacher-overview": "/dashboard/teacher", "admin-quizzes": "/dashboard/admin/quizzes" };
for (const scene of Object.keys(scenes)) for (const theme of ["light", "dark"]) for (const width of [360, 390, 768, 1280, 1440]) {
  test(`${scene}: readable table, local scrolling and actions at ${width}px / ${theme}`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(selected => localStorage.setItem("theme", selected), theme);
    await page.route("**/*", route => {
      const u = new URL(route.request().url());
      if (u.origin !== origin) return route.abort();
      if (!u.pathname.startsWith("/api/")) {
        if (/\.(png|svg|webp)$/.test(u.pathname)) return route.fulfill({ status: 204 });
        return route.continue();
      }
      if (route.request().method() !== "GET") writes.push(u.pathname);
      let data: unknown = { success: true, notifications: [], unreadCount: 0 };
      if (u.pathname === "/api/auth/session") data = { success: true, user: { userId: "synthetic", role: scene.startsWith("student") ? "student" : scene.startsWith("teacher") ? "teacher" : "admin" } };
      else if (u.pathname === "/api/dashboard/teacher") data = { stats: { totalQuizzes: 2, studentsMonitored: 2, totalViolations: 3, flaggedStudents: 1 }, recentVerdicts: [{ name: "Synthetic Student With A Long Family Name", quiz: quiz.title, violations: ["No Face Detected", "Looking Away"], verdict: "SUSPICIOUS", verdictClass: "bg-amber-500/15 text-amber-600", score: "80%" }], violationsBreakdown: [] };
      else if (u.pathname === "/api/dashboard/student/results") data = { success: true, results: [{ id: "result-1", quiz, quizStatus: "completed", isCompleted: true, aiVerdict: "suspicious", score: 80, totalPoints: 100, createdAt: "2026-10-16T00:00:00Z" }] };
      else if (u.pathname === "/api/dashboard/admin") data = { success: true, stats: { totalUsers: 2, totalQuizzes: 6, totalViolations: 0, aiVerdictsToday: 11 }, platformBars: [{ label: "Students", value: 14, pct: 64, color: "bg-indigo-500" }, { label: "Teachers", value: 8, pct: 36, color: "bg-violet-500" }], activityBars: [{ label: "Quizzes In-Progress", value: 6, pct: 100, color: "bg-emerald-500" }, { label: "Active Violations", value: 0, pct: 0, color: "bg-red-500" }], activities: [], users };
      else if (u.pathname === "/api/billing/status") data = { isSubscribed: true, manualQuizCount: 1, manualQuizLimit: 5 };
      else if (u.pathname === "/api/quizzes") data = scene === "student" ? { success: true, quizzes: [{ id: "enrollment-1", quiz, quizStatus: "completed", aiVerdict: "suspicious" }, { id: "enrollment-2", quiz: { ...quiz, id: 8, title: "Synthetic Active Quiz" }, quizStatus: "in_progress", aiVerdict: null }, { id: "hidden", quiz: { ...quiz, quizMode: "arena", title: "Hidden Arena Fixture" } }] } : { quizzes: scene === "admin-quizzes" ? [{ ...quiz, teacher: { fullName: "Synthetic Teacher" }, createdAt: "2026-10-16T00:00:00Z" }] : [quiz, { ...quiz, id: 9, quizMode: "arena", title: "Hidden Arena Fixture" }], pendingApprovals: [], pendingRetakes: [], entitlements: { isSubscribed: true, manualQuizCount: 1, manualQuizLimit: 5 } };
      return route.fulfill({ json: data });
    });
    try {
      await page.goto(origin + scenes[scene] + "?scene=" + scene);
      await page.locator(".ps-dashboard-table tbody tr").filter({ hasText: /Synthetic/ }).first().waitFor();
      await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "page overflows horizontally");
      const geometry = await page.locator("table.ps-dashboard-table").evaluate(table => {
        const singleLine = (el: Element) => {
          const range = document.createRange(); range.selectNodeContents(el);
          const lines = new Set(Array.from(range.getClientRects()).filter(r => r.width > 0).map(r => Math.round(r.top)));
          return lines.size <= 1;
        };
        const badges = Array.from(table.querySelectorAll("td span.rounded-full"));
        const controls = Array.from(table.querySelectorAll("button,a,code"));
        return { brokenHeaders: Array.from(table.querySelectorAll("th")).filter(el => !singleLine(el)).map(el => el.textContent), brokenBadges: badges.filter(el => !singleLine(el) || el.scrollWidth > el.clientWidth + 1).map(el => el.textContent), brokenControls: controls.filter(el => getComputedStyle(el).whiteSpace !== "nowrap" || el.scrollWidth > el.clientWidth + 1).map(el => el.textContent), nonTableCells: Array.from(table.querySelectorAll("td")).filter(el => getComputedStyle(el).display !== "table-cell").length, badges: badges.length };
      });
      assert.deepEqual(geometry.brokenHeaders, []);
      assert.deepEqual(geometry.brokenBadges, []);
      assert.deepEqual(geometry.brokenControls, []);
      assert.equal(geometry.nonTableCells, 0);
      assert.ok(geometry.badges >= 1);
      assert.equal(await page.getByText("Hidden Arena Fixture", { exact: true }).count(), 0);
      assert.equal(await page.locator('a[href*="/arena/"],a[href*="/playground"]').count(), 0);
      const scroll = page.locator(".ps-table-scroll");
      await scroll.focus();
      assert.equal(await scroll.evaluate(el => el === document.activeElement), true);
      const reachable = await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; const actions = el.querySelector("tbody tr td:last-child")!.getBoundingClientRect(), box = el.getBoundingClientRect(); return actions.right <= box.right + 1 && actions.left >= box.left; });
      assert.equal(reachable, true, "rightmost actions cannot be scrolled into view");
      await scroll.evaluate(el => { el.scrollLeft = 0; });
      if (scene === "admin") {
        const demographics = page.locator(".ps-admin-demographics");
        assert.equal(await demographics.getByText("Admins", { exact: true }).count(), 0);
        for (const label of ["Students", "Teachers", "Quizzes In-Progress", "Active Violations"]) assert.equal(await demographics.getByText(label, { exact: true }).count(), 1);
      }
      await page.screenshot({ path: path.join(evidence, `${scene}-${theme}-${width}.png`), fullPage: true });
      if (scene === "teacher") {
        await page.getByRole("button", { name: "Manage", exact: true }).click();
        await page.locator(".app-modal-panel").waitFor();
        await page.getByRole("button", { name: "Close", exact: true }).click();
      } else if (scene === "users") {
        assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).count(), 0);
        await page.getByRole("button", { name: "View", exact: true }).first().click();
        await page.getByRole("dialog").waitFor();
        await page.getByRole("button", { name: "Close", exact: true }).click();
      } else if (scene === "student") {
        assert.equal(await page.getByRole("link", { name: "Take Quiz" }).getAttribute("href"), "/quiz/8");
        const search = page.getByRole("textbox", { name: "Search enrolled quizzes" });
        await search.fill("no-match");
        await page.getByText("No enrolled quizzes found", { exact: true }).waitFor();
        await search.fill("Synthetic Active");
        assert.equal(await page.locator("tbody tr").count(), 1);
      }
      // The shared shell performs only a synthetic presence heartbeat, if any.
      assert.deepEqual(writes.filter(url => !url.includes("heartbeat")), []);
      assert.deepEqual(errors, []);
      results.push({ scene, theme, width, pass: true, ...geometry });
    } catch (error) {
      fs.writeFileSync(path.join(evidence, `FAILURE-${scene}-${theme}-${width}.txt`), String(error));
      throw error;
    } finally { await page.close(); }
  });
}
