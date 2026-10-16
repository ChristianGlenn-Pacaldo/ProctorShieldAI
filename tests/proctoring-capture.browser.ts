import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { build } from "esbuild";
import { chromium } from "playwright";
import * as modelAssets from "../src/lib/desktop-device-model.ts";
import type { createDesktopDeviceWorker, createRecoveringDesktopDeviceWorker } from "../src/lib/desktop-device-worker.ts";
import type { createEvidenceClipBuffer } from "../src/lib/evidence-clip-buffer.ts";

declare global {
  interface Window {
    proctoring: {
      createDesktopDeviceWorker: typeof createDesktopDeviceWorker;
      createRecoveringDesktopDeviceWorker: typeof createRecoveringDesktopDeviceWorker;
      createEvidenceClipBuffer: typeof createEvidenceClipBuffer;
    };
  }
}

// Opt-in: node --test tests/proctoring-capture.browser.ts
// Real Chromium encoders, playback, worker, WASM and model; synthetic camera only.
test("fresh browser sessions recover a failed model request and evidence replays the pre-alert movement", { timeout: 180_000 }, async () => {
  const routeSource = await readFile("src/app/api/models/device/[file]/route.ts", "utf8");
  const routeExports: { GET?: (request: Request, context: { params: Promise<{ file: string }> }) => Promise<Response> } = {};
  vm.runInNewContext(ts.transpileModule(routeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: routeExports, Response, fetch, Uint8Array, AbortSignal,
    require(name: string) {
      if (name === "node:fs/promises") return { readFile };
      if (name === "node:crypto") return { createHash };
      if (name === "@/lib/desktop-device-model") return modelAssets;
      throw Error(`Unexpected dependency: ${name}`);
    },
  });
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {createDesktopDeviceWorker,createRecoveringDesktopDeviceWorker} from './src/lib/desktop-device-worker';
    import {createEvidenceClipBuffer} from './src/lib/evidence-clip-buffer';
    window.proctoring={createDesktopDeviceWorker,createRecoveringDesktopDeviceWorker,createEvidenceClipBuffer};
  ` }, bundle: true, write: false, platform: "browser", format: "iife" });
  let failFirstModel = true, modelRequests = 0;
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url!, "http://localhost").pathname;
      if (pathname.startsWith("/api/models/device/")) {
        const file = pathname.split("/").at(-1)!;
        if (file === "model.tflite") {
          modelRequests++;
          if (failFirstModel) { failFirstModel = false; res.writeHead(502).end(); return; }
        }
        const response = await routeExports.GET!(new Request("http://localhost" + pathname), { params: Promise.resolve({ file }) });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (pathname === "/harness.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; worker-src 'self'; media-src blob:");
      res.end('<!doctype html><canvas width="320" height="240"></canvas><script src="/harness.js"></script>');
    } catch { res.writeHead(500).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    // Separate contexts have independent cookies, storage and HTTP caches.
    for (const session of ["first-fresh-session", "second-isolated-session"]) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(origin);
        const result = await page.evaluate(async () => {
          const api = window.proctoring;
          const canvas = document.querySelector("canvas")!;
          canvas.getContext("2d")!.fillRect(0, 0, canvas.width, canvas.height);
          const states: string[] = [];
          const detector = api.createRecoveringDesktopDeviceWorker({ retryDelayMs: 10,
            onStatus: (status: string) => states.push(status),
            createDetector: () => api.createDesktopDeviceWorker({ createFrame: () => createImageBitmap(canvas) }),
          });
          try {
            await detector.ready;
            const predictions = await detector.detect(document.createElement("video"));
            return { states, predictions };
          } finally { detector.dispose(); }
        });
        assert.deepEqual(result.predictions, [], session);
        assert.equal(result.states.at(-1), "ready", session);
        assert.equal(result.states.includes("retrying"), session === "first-fresh-session");
        console.log(JSON.stringify({ session, states: result.states, modelRequests }));
      } finally { await context.close(); }
    }
    assert.equal(modelRequests, 3);

    const page = await browser.newPage();
    await page.goto(origin);
    const playback = await page.evaluate(async () => {
      const canvas = document.querySelector("canvas")!;
      const ctx = canvas.getContext("2d")!;
      let turned = true;
      const draw = () => { ctx.fillStyle = turned ? "rgb(240,10,10)" : "rgb(10,10,240)"; ctx.fillRect(0, 0, 320, 240); };
      draw();
      const drawing = setInterval(draw, 33);
      const stream = canvas.captureStream(24);
      const buffer = window.proctoring.createEvidenceClipBuffer(stream);
      try {
        await new Promise(resolve => setTimeout(resolve, 2_300));
        const pending = buffer.capture();
        turned = false; draw();
        const clip = await pending;
        if (!clip) throw Error("No evidence clip");
        const video = document.createElement("video"); video.muted = true;
        const url = URL.createObjectURL(clip.blob); video.src = url;
        try {
          await video.play();
          const output = document.createElement("canvas"); output.width = 1; output.height = 1;
          const outputContext = output.getContext("2d", { willReadFrequently: true })!;
          const pixel = () => { outputContext.drawImage(video, 0, 0, 1, 1); return [...outputContext.getImageData(0, 0, 1, 1).data]; };
          const before = pixel();
          await new Promise(resolve => setTimeout(resolve, clip.durationMs - 500));
          const after = pixel();
          return { before, after, durationMs: clip.durationMs, bytes: clip.blob.size, sourceLive: stream.getVideoTracks()[0].readyState };
        } finally { video.pause(); URL.revokeObjectURL(url); }
      } finally { buffer.dispose(); clearInterval(drawing); stream.getTracks().forEach(track => track.stop()); }
    });
    assert.ok(playback.before[0] > 200 && playback.before[2] < 50, "clip starts with the pre-alert turn (red)");
    assert.ok(playback.after[2] > 200 && playback.after[0] < 50, "clip ends with the post-alert return (blue)");
    assert.ok(playback.durationMs >= 3_000 && playback.durationMs <= 5_500);
    assert.ok(playback.bytes >= 1_000);
    assert.equal(playback.sourceLive, "live");
    console.log(JSON.stringify({ evidencePlayback: playback }));
  } finally {
    await browser.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
