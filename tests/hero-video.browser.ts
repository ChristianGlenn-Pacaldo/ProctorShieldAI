import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const output = process.argv[2];
assert.ok(output, "Pass an external artifact directory");
const base = "http://127.0.0.1:3450";
const report: Record<string, unknown> = { target: base, backendAuthentication: "not contacted", tests: [] };
const results = report.tests as { name: string; details?: unknown }[];
const pass = (name: string, details?: unknown) => { results.push({ name, details }); console.log("PASS", name); };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
async function open(options: Parameters<typeof browser.newContext>[0] = {}, setup?: (page: Awaited<ReturnType<typeof browser.newPage>>) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", ...options });
  contexts.push(context);
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== base || url.pathname.startsWith("/api/") || route.request().method() !== "GET") return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", msg => { if (msg.type() === "error" && /hydrat/i.test(msg.text())) errors.push(msg.text()); });
  await setup?.(page);
  await page.goto(base, { waitUntil: "networkidle" });
  const stage = page.locator("[data-hero-video]");
  await stage.waitFor();
  return { context, page, stage, video: stage.locator("video"), errors };
}

try {
  const desktop = await open({}, async page => {
    await page.addInitScript(() => {
      const observed = window as unknown as { __heroQA: { wraps: number; frames: Record<string, string>; times: number[]; shifts: number } };
      observed.__heroQA = { wraps: 0, frames: {}, times: [], shifts: 0 };
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!(entry as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput)
          observed.__heroQA.shifts += (entry as PerformanceEntry & { value: number }).value;
      }).observe({ type: "layout-shift", buffered: true });
      document.addEventListener("playing", event => {
        const v = event.target as HTMLVideoElement & { __observed?: boolean };
        if (v.tagName !== "VIDEO" || v.__observed) return;
        v.__observed = true;
        let previous = 0;
        const capture = () => {
          const canvas = document.createElement("canvas"); canvas.width = (v as HTMLVideoElement).videoWidth; canvas.height = (v as HTMLVideoElement).videoHeight;
          canvas.getContext("2d")!.drawImage(v, 0, 0); return canvas.toDataURL("image/png");
        };
        const frame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
          const t = metadata.mediaTime;
          if (t > 9.9) observed.__heroQA.frames[`ending-${observed.__heroQA.wraps + 1}`] = capture();
          if (previous > 8 && t < 1) {
            observed.__heroQA.wraps++;
            observed.__heroQA.times.push(performance.now());
            observed.__heroQA.frames[`opening-${observed.__heroQA.wraps}`] = capture();
          }
          previous = t;
          if (observed.__heroQA.wraps < 3) v.requestVideoFrameCallback(frame);
        };
        v.requestVideoFrameCallback(frame);
      }, true);
    });
  });
  await desktop.stage.scrollIntoViewIfNeeded();
  await desktop.page.waitForFunction(() => document.querySelector("[data-hero-video]")?.getAttribute("data-status") === "playing");
  const boundsBefore = await desktop.stage.boundingBox();
  await desktop.page.waitForFunction(() => { const v = document.querySelector("video"); return v && (v as HTMLVideoElement).currentTime > 4.5 && (v as HTMLVideoElement).currentTime < 7; });
  await desktop.page.screenshot({ path: path.join(output, "desktop-playing.png") });
  await desktop.page.waitForFunction(() => (window as unknown as { __heroQA: { wraps: number } }).__heroQA.wraps >= 3, { timeout: 45000 });
  const cycles = await desktop.page.evaluate(() => (window as unknown as { __heroQA: { wraps: number; frames: Record<string, string>; times: number[]; shifts: number } }).__heroQA);
  for (const [name, url] of Object.entries(cycles.frames)) fs.writeFileSync(path.join(output, `loop-${name}.png`), Buffer.from(url.split(",")[1], "base64"));
  const media = await desktop.video.evaluate(v => ({ muted: (v as HTMLVideoElement).muted, defaultMuted: (v as HTMLVideoElement).defaultMuted, inline: (v as HTMLVideoElement).playsInline, loop: (v as HTMLVideoElement).loop, duration: (v as HTMLVideoElement).duration, width: (v as HTMLVideoElement).videoWidth, height: (v as HTMLVideoElement).videoHeight, fit: getComputedStyle(v).objectFit }));
  assert.equal(cycles.wraps, 3); assert.equal(media.muted, true); assert.equal(media.defaultMuted, true);
  assert.equal(media.inline, true); assert.equal(media.loop, true); assert.equal(media.fit, "contain");
  const boundsAfter = await desktop.stage.boundingBox();
  assert.equal(boundsBefore!.width, boundsAfter!.width); assert.equal(boundsBefore!.height, boundsAfter!.height);
  pass("three full consecutive native playback cycles, silent inline repeat and stable stage", { ...media, wraps: cycles.wraps, boundaryTimesMs: cycles.times, cls: cycles.shifts, boundsBefore, boundsAfter });

  await desktop.page.getByRole("button", { name: "Pause logo animation" }).focus();
  await desktop.page.keyboard.press("Enter");
  await desktop.page.waitForFunction(() => document.querySelector("video")?.paused);
  const pausedTime = await desktop.video.evaluate(v => (v as HTMLVideoElement).currentTime);
  await desktop.page.locator("footer").scrollIntoViewIfNeeded();
  await desktop.stage.scrollIntoViewIfNeeded();
  await desktop.page.waitForTimeout(400);
  assert.equal(await desktop.video.evaluate(v => (v as HTMLVideoElement).paused), true);
  assert.ok(Math.abs((await desktop.video.evaluate(v => (v as HTMLVideoElement).currentTime)) - pausedTime) < 0.1);
  await desktop.page.getByRole("button", { name: "Play logo animation" }).focus();
  await desktop.page.keyboard.press("Space");
  await desktop.page.waitForFunction(() => !document.querySelector("video")?.paused);
  pass("keyboard Enter pauses; scrolling cannot override manual pause; Space resumes");
  await desktop.page.locator("footer").scrollIntoViewIfNeeded();
  await desktop.page.waitForFunction(() => document.querySelector("video")?.paused);
  await desktop.stage.scrollIntoViewIfNeeded();
  await desktop.page.waitForFunction(() => !document.querySelector("video")?.paused);
  pass("real offscreen IntersectionObserver pause and resume");
  await desktop.page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await desktop.video.evaluate(v => (v as HTMLVideoElement).paused), true);
  await desktop.page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await desktop.page.waitForFunction(() => !document.querySelector("video")?.paused);
  pass("simulated document visibility pause/resume on actual component");
  assert.deepEqual(desktop.errors, []); pass("no page errors or hydration errors");
  const range = await desktop.context.request.get(`${base}/videos/original-google-flow-intro.mp4`, { headers: { Range: "bytes=0-31" } });
  assert.equal(range.status(), 206); assert.match(range.headers()["content-type"], /video\/mp4/);
  pass("same-origin video MIME and range requests", { status: range.status(), type: range.headers()["content-type"] });
  await desktop.context.close();

  for (const width of [850, 390, 375, 320]) {
    const f = await open({ viewport: { width, height: 900 } });
    const initial = await f.stage.boundingBox();
    if (initial && initial.y >= 900) {
      assert.equal(await f.video.getAttribute("src"), null);
      pass(`offscreen initial media deferred at ${width}px`);
    }
    await f.stage.scrollIntoViewIfNeeded();
    await f.page.waitForFunction(() => document.querySelector("[data-hero-video]")?.getAttribute("data-status") === "playing");
    await f.page.waitForFunction(() => { const v = document.querySelector("video"); return v && (v as HTMLVideoElement).currentTime > 4 && (v as HTMLVideoElement).currentTime < 8; });
    await f.page.screenshot({ path: path.join(output, `playing-${width}.png`) });
    await f.stage.screenshot({ path: path.join(output, `stage-${width}.png`) });
    const layout = await f.page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth, stage: document.querySelector("[data-hero-video]")!.getBoundingClientRect().toJSON() }));
    assert.ok(layout.scroll <= layout.viewport);
    assert.ok(Math.abs(layout.stage.width / layout.stage.height - 1015 / 807) < .01);
    assert.deepEqual(f.errors, []);
    pass(`responsive contain framing without horizontal overflow ${width}px`, layout);
    await f.context.close();
  }

  for (const mode of ["reduced-motion", "save-data", "reduced-data", "autoplay-blocked", "media-error", "javascript-disabled"] as const) {
    let mediaRequests = 0;
    const f = await open({ reducedMotion: mode === "reduced-motion" ? "reduce" : "no-preference", javaScriptEnabled: mode !== "javascript-disabled" }, async page => {
      page.on("request", request => { if (request.url().includes("original-google-flow-intro.mp4")) mediaRequests++; });
      if (mode === "save-data") await page.addInitScript(() => {
        const connection = new EventTarget() as EventTarget & { saveData: boolean }; connection.saveData = true;
        Object.defineProperty(navigator, "connection", { configurable: true, value: connection });
      });
      if (mode === "reduced-data") await page.addInitScript(() => {
        const original = matchMedia;
        window.matchMedia = query => query.includes("prefers-reduced-data") ? Object.assign(new EventTarget(), { matches: true, media: query }) as MediaQueryList : original(query);
      });
      if (mode === "autoplay-blocked") await page.addInitScript(() => {
        const original = HTMLMediaElement.prototype.play; let rejected = false;
        HTMLMediaElement.prototype.play = function () {
          if (!rejected) { rejected = true; return Promise.reject(new DOMException("QA blocked autoplay", "NotAllowedError")); }
          return original.call(this);
        };
      });
      if (mode === "media-error") await page.route("**/videos/original-google-flow-intro.mp4", route => route.fulfill({ contentType: "video/mp4", body: "synthetic corrupt media" }));
    });
    await f.stage.scrollIntoViewIfNeeded();
    if (mode === "autoplay-blocked") await f.page.waitForFunction(() => document.querySelector("[data-hero-video]")?.getAttribute("data-status") === "fallback");
    else if (mode !== "javascript-disabled") await f.page.waitForFunction(() => document.querySelector("[data-hero-video]")?.getAttribute("data-status") === "unavailable");
    assert.equal(await f.stage.locator("img").evaluate(element => { const img = element as HTMLImageElement; return img.complete && img.naturalWidth > 0 && getComputedStyle(img.parentElement!).opacity === "1"; }), true);
    if (["reduced-motion", "save-data", "reduced-data", "javascript-disabled"].includes(mode)) {
      assert.equal(await f.video.getAttribute("src"), null); assert.equal(mediaRequests, 0);
    }
    await f.page.screenshot({ path: path.join(output, `${mode}.png`) });
    if (mode === "autoplay-blocked") {
      await f.page.getByRole("button", { name: "Play logo animation" }).click();
      await f.page.waitForFunction(() => document.querySelector("[data-hero-video]")?.getAttribute("data-status") === "playing");
    }
    assert.deepEqual(f.errors, []);
    pass(`${mode} official-logo fallback`, { mediaRequests, simulation: ["save-data", "reduced-data", "autoplay-blocked", "media-error"].includes(mode) });
    await f.context.close();
  }
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = String(error); throw error;
} finally {
  fs.writeFileSync(path.join(output, "browser-results.json"), JSON.stringify(report, null, 2));
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser.close();
}
