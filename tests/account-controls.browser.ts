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
const temp = path.join(root, ".tmp-account-controls-review");
const evidence = path.resolve(process.env.UI_QA_ARTIFACT_DIR || path.join(root, "release-review/account-controls-2026-10-16"));
let browser: Browser, server: http.Server, origin: string;
const results: object[] = [];
before(async () => {
  fs.mkdirSync(temp, { recursive: true });
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(temp, "entry.tsx"), `

    import React from 'react';import {createRoot} from 'react-dom/client';
    import Shell from '../src/components/dashboard-shell';
    import StudentSettings from '../src/app/dashboard/student/settings/content';
    import TeacherSettings from '../src/app/dashboard/teacher/settings/content';
    import StudentRegistration from '../src/app/login/student/page';
    import TeacherRegistration from '../src/app/login/teacher/page';
    const scene=new URLSearchParams(location.search).get('scene');
    const role=scene.startsWith('student')?'student':scene.startsWith('teacher')?'teacher':'admin';
    const registration=scene.endsWith('register');
    const node=registration?(role==='student'?<StudentRegistration/>:<TeacherRegistration/>):role==='student'?<StudentSettings/>:role==='teacher'?<TeacherSettings/>:<p>Administration dashboard</p>;
    createRoot(document.getElementById('root')).render(registration?<div className="ps-auth">{node}</div>:<Shell role={role} userName={'Synthetic '+role} userInitials="QA"><div className={role==='teacher'?'teacher-content ps-teacher-page':role==='admin'?'ps-admin-page':'ps-student-page'}>{node}</div></Shell>);
  `);
  const stubs: Record<string, string> = {
    "@react-oauth/google": "export const GoogleOAuthProvider=({children})=>children; export const GoogleLogin=()=>null;",
    "next/navigation": "export const useRouter=()=>({push:url=>{window.__navigation=url},replace:url=>{window.__navigation=url},refresh(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);",
    "next/link": "import React from 'react';export default function Link({prefetch,...props}){return React.createElement('a',props)}",
    "next/image": "import React from 'react';export default function Image({priority,preload,fill,sizes,quality,...props}){return React.createElement('img',props)}",
    "pusher-js": "export default class Pusher{connection={bind(){},unbind(){}};subscribe(){return{bind(){},unbind(){},unbind_all(){}}}unsubscribe(){}disconnect(){}}",
  };
  await build({ entryPoints: [path.join(temp, "entry.tsx")], outfile: path.join(temp, "bundle.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID": '""', "process.env.NEXT_PUBLIC_PUSHER_KEY": '"synthetic"', "process.env.NEXT_PUBLIC_PUSHER_CLUSTER": '"ap1"' }, plugins: [{ name: "synthetic-boundaries", setup(b) {
    b.onResolve({ filter: /^(next\/(navigation|link|image)|pusher-js|@react-oauth\/google)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: stubs[a.path], loader: "js", resolveDir: root }));
  } }] });
  const css = (await postcss([tailwind({ base: root })]).process(fs.readFileSync("src/app/globals.css", "utf8").replace(/^@import url\(.*?\);\s*/m, ""), { from: "src/app/globals.css" })).css;
  fs.writeFileSync(path.join(temp, "base.css"), css + ["teacher/teacher-theme.css", "teacher/teacher-glass.css", "student/student.css", "student/student-glass.css", "admin/admin.css", "admin/admin-glass.css"].map(p => fs.readFileSync("src/app/dashboard/" + p, "utf8")).join("\n") + fs.readFileSync("src/app/login/auth.css", "utf8") + fs.readFileSync("src/app/login/auth-glass.css", "utf8"));
  server = http.createServer((req, res) => {
    const file = req.url === "/base.css" ? "base.css" : req.url === "/bundle.js" ? "bundle.js" : null;
    res.setHeader("Content-Type", file === "base.css" ? "text/css" : file ? "text/javascript" : "text/html");
    res.end(file ? fs.readFileSync(path.join(temp, file)) : '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/base.css"></head><body class="app-motion-scope"><div id="root"></div><script src="/bundle.js"></script></body></html>');
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

for (const scene of ["student-register", "teacher-register", "student-settings", "teacher-settings", "admin"]) {
  for (const width of [360, 390, 768, 1280, 1440]) for (const theme of ["light", "dark"]) {
    test(`${scene} ${width}px ${theme}: accessible account controls`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 950 }, colorScheme: theme as "light" | "dark" });
      const role = scene.split("-")[0], registration = scene.endsWith("register");
      const writes: string[] = [], errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith("/api/")) {
          if (/\.(png|svg|webp)$/.test(url.pathname)) return route.fulfill({ status: 204 });
          return route.continue();
        }
        if (route.request().method() !== "GET") writes.push(url.pathname);
        const data = url.pathname === "/api/auth/session" ? { success: true, authenticated: true, user: { userId: "synthetic", role, fullName: "Synthetic Reviewer", email: "reviewer@example.invalid" } } : { success: true, notifications: [], unreadCount: 0 };
        return route.fulfill({ json: data });
      });
      try {
        const pathname = registration ? `/login/${role}` : `/dashboard/${role}${role === "admin" ? "" : "/settings"}`;
        await page.goto(`${origin}${pathname}?scene=${scene}${registration ? "&tab=register" : ""}`);
        await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
        if (registration) await page.locator(`#${role}-register-password`).waitFor();
        else if (role !== "admin") await page.locator(`#${role}-email`).getByText("reviewer@example.invalid", { exact: true }).waitFor();
        else await page.getByText("Administration dashboard", { exact: true }).waitFor();
        // Registration pages do not mount the dashboard theme controller.
        if (registration) await page.evaluate(t => document.documentElement.classList.toggle("dark", t === "dark"), theme);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        if (role === "admin") {
          await page.getByRole("button", { name: "Open profile menu" }).click();
          assert.equal(await page.locator('a[href="/dashboard/admin/settings"]').count(), 0);
          assert.equal(await page.getByRole("link", { name: "Profile & Settings" }).count(), 0);
          assert.equal(await page.getByRole("button", { name: "Sign out", exact: true }).count(), 1);
        } else {
          const suffixes = registration ? ["register-password", "register-confirm"] : ["current-password", "new-password", "confirm-password"];
          for (const suffix of suffixes) {
            const id = `${role}-${suffix}`, input = page.locator(`#${id}`), control = page.locator(`button[aria-controls="${id}"]`);
            assert.equal(await input.getAttribute("type"), "password");
            await input.fill("SyntheticOnly123!");
            assert.equal(await control.getAttribute("type"), "button");
            assert.equal(await control.getAttribute("aria-pressed"), "false");
            const size = await control.boundingBox(); assert.ok(size && size.width >= 44 && size.height >= 44);
            await control.hover();
            const assertCentered = async () => {
              const inputBox = await input.boundingBox(), buttonBox = await control.boundingBox();
              assert.ok(inputBox && buttonBox);
              assert.ok(Math.abs(inputBox.y + inputBox.height / 2 - buttonBox.y - buttonBox.height / 2) <= 1, "eye button must remain centered on hover and focus");
            };
            await assertCentered();
            const ink = await control.evaluate(el => getComputedStyle(el).color);
            assert.notEqual(ink, "rgba(0, 0, 0, 0)");
            await control.click();
            assert.equal(await input.getAttribute("type"), "text");
            assert.equal(await input.inputValue(), "SyntheticOnly123!");
            assert.equal(await control.getAttribute("aria-pressed"), "true");
            // Each field's visibility is independent of the remaining fields.
            for (const other of suffixes.filter(s => s !== suffix)) assert.equal(await page.locator(`#${role}-${other}`).getAttribute("type"), "password");
            await control.focus(); await page.keyboard.press("Space");
            assert.equal(await input.getAttribute("type"), "password");
            assert.equal(await input.inputValue(), "SyntheticOnly123!");
            assert.equal(await control.getAttribute("aria-pressed"), "false");
            await assertCentered();
          }
          if (!registration) {
            assert.equal(await page.locator(`input#${role}-email`).count(), 0);
            assert.equal(await page.getByText("Email changes are not available here.", { exact: true }).count(), 1);
            assert.equal(await page.locator(`#${role}-email`).getAttribute("aria-labelledby"), `${role}-email-label`);
          }
        }
        assert.deepEqual(writes, [], "visibility must not submit a form or change an account");
        assert.deepEqual(errors, []);
        await page.screenshot({ path: path.join(evidence, `${scene}-${width}-${theme}.png`), fullPage: true });
        results.push({ scene, width, theme, result: "passed", writes: 0 });
      } finally { await page.close(); }
    });
  }
}
