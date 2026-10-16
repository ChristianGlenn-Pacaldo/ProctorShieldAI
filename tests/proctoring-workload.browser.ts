import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import nextConfig from "../next.config.ts";
import { getDesktopDeviceAssetPath } from "../src/lib/desktop-device-model.ts";
import { getCocoModelUpstreamUrl } from "../src/lib/coco-model.ts";

// Opt-in: node --test tests/proctoring-workload.browser.ts
// Face and object AI, continuous evidence, and a teacher WebRTC receiver run
// together on the actual host. Set PROCTORING_CPU_THROTTLE=2 for an additional
// stress run; it is reported separately from this host's acceptance result.
test("combined proctoring workload keeps quiz input responsive with bounded evidence encoding", { timeout: 240_000 }, async () => {
  const alias = nextConfig.turbopack!.resolveAlias!["@tensorflow/tfjs/dist/index.js"] as string;
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import * as faceapi from '@vladmandic/face-api/dist/face-api.esm-nobundle.js';
    import {createEvidenceClipBuffer} from './src/lib/evidence-clip-buffer';
    import * as coco from '@tensorflow-models/coco-ssd';
    import {prepareDesktopFaceFrame,detectDesktopFacesWithFallback} from './src/lib/desktop-head-tracking';
    import {getProctoringPerformanceProfile} from './src/lib/device-capabilities';
    import {initializeProctoringFaceRuntime} from './src/lib/proctoring-face-runtime';
    window.workload={faceapi,coco,createEvidenceClipBuffer,prepareDesktopFaceFrame,detectDesktopFacesWithFallback,getProctoringPerformanceProfile,initializeProctoringFaceRuntime};
  ` }, alias: { "@tensorflow/tfjs/dist/index.js": path.resolve(alias) }, bundle: true, write: false, platform: "browser", format: "iife" });
  const cache = new Map<string, Buffer>();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://localhost");
      if (url.pathname === "/harness.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
      if (url.pathname.startsWith("/api/models/device/")) {
        const file = url.pathname.split("/").at(-1)!;
        const asset = getDesktopDeviceAssetPath(file);
        if (!asset) { res.writeHead(404).end(); return; }
        res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
        res.end(await fs.readFile(asset)); return;
      }
      if (url.pathname.startsWith("/api/models/coco/")) {
        const file = url.pathname.split("/").at(-1)!;
        const upstream = getCocoModelUpstreamUrl(file);
        if (!upstream) { res.writeHead(404).end(); return; }
        if (!cache.has(file)) {
          const response = await fetch(upstream, { signal: AbortSignal.timeout(30_000) });
          if (!response.ok) { res.writeHead(502).end(); return; }
          cache.set(file, Buffer.from(await response.arrayBuffer()));
        }
        res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "application/octet-stream");
        res.end(cache.get(file)); return;
      }
      if (url.pathname.startsWith("/models/")) {
        const file = path.basename(url.pathname);
        res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "application/octet-stream");
        res.end(await fs.readFile(path.join("public/models", file))); return;
      }
      if (url.pathname === "/sample.jpg") { res.setHeader("Content-Type", "image/jpeg"); res.end(await fs.readFile("node_modules/@vladmandic/face-api/demo/sample1.jpg")); return; }
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:");
      res.end('<!doctype html><button id="answer">Choose answer</button><script src="/harness.js"></script>');
    } catch { res.writeHead(500).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ headless: true, args: ["--disable-gpu"] });
  const throttleRate = Number(process.env.PROCTORING_CPU_THROTTLE || 1);
  assert.ok(Number.isFinite(throttleRate) && throttleRate >= 1);
  const rows: Record<string, any>[] = [];
  try {
    for (const mode of ["bounded-laptop"]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.text().startsWith("workload-phase")) console.log(mode, message.text()); });
      const client = await context.newCDPSession(page);
      await client.send("Emulation.setCPUThrottlingRate", { rate: throttleRate });
      await client.send("Performance.enable");
      await page.goto(origin);
      const answerBox = await page.locator("#answer").boundingBox();
      assert.ok(answerBox);
      const metricsBefore = await client.send("Performance.getMetrics");
      const run = page.evaluate(async mode => {
        const api = (window as any).workload;
        const profile = mode === "bounded-laptop" ? api.getProctoringPerformanceProfile("desktop", { hardwareConcurrency: 4, deviceMemory: 8 })
          : { frameRate: 24, detectionIntervalMs: 500, objectDetectionIntervalMs: 500 };
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        let clicks = 0; document.getElementById("answer")!.onclick = () => { clicks++; };
        const gaps: number[] = [], faceMs: number[] = [], objectMs: number[] = [];
        let last = performance.now(); const heartbeat = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; }, 50);
        const start = performance.now();
        const { faceapi } = api;
        await api.initializeProctoringFaceRuntime(faceapi.tf, true);
        console.log("workload-phase tensorflow-ready", Math.round(performance.now() - start));
        await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri("/models"), faceapi.nets.faceLandmark68Net.loadFromUri("/models")]);
        console.log("workload-phase face-models-ready", Math.round(performance.now() - start));
        const photo = new Image(); photo.src = "/sample.jpg"; await photo.decode();
        const boxes = await faceapi.detectAllFaces(photo, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }));
        if (!boxes.length) throw Error("Sample must contain a real detected face");
        console.log("workload-phase face-warmup-ready", Math.round(performance.now() - start));
        const box = boxes[0].box;
        const camera = document.createElement("canvas"); camera.width = 1280; camera.height = 720;
        const ctx = camera.getContext("2d")!;
        const draw = () => {
          ctx.fillStyle = "#555"; ctx.fillRect(0, 0, 1280, 720);
          ctx.drawImage(photo, Math.max(0, box.x - box.width * .3), Math.max(0, box.y - box.height * .3), box.width * 1.6, box.height * 1.6, 320, 40, 640, 640);
        };
        draw(); const drawing = setInterval(draw, 1000 / profile.frameRate);
        const stream = camera.captureStream(profile.frameRate);
        const video = document.createElement("video"); video.muted = true; video.srcObject = stream; await video.play();
        const recordings: MediaRecorder[] = []; const settings: MediaTrackSettings[] = [];
        const evidence = api.createEvidenceClipBuffer(stream, {
          ...(mode === "bounded-laptop" ? { video } : {}),
          createRecorder(input: MediaStream, options: MediaRecorderOptions) {
            const { width, height, frameRate } = input.getVideoTracks()[0].getSettings();
            settings.push({ width, height, frameRate });
            const recorder = new MediaRecorder(input, mode === "deployed-hd-control" ? { ...options, videoBitsPerSecond: 350_000 } : options);
            recordings.push(recorder); return recorder;
          },
        });
        const sender = new RTCPeerConnection({ iceServers: [] }), receiver = new RTCPeerConnection({ iceServers: [] });
        const teacherVideo = document.createElement("video"); teacherVideo.muted = true;
        sender.onicecandidate = event => { if (event.candidate) void receiver.addIceCandidate(event.candidate).catch(() => {}); };
        receiver.onicecandidate = event => { if (event.candidate) void sender.addIceCandidate(event.candidate).catch(() => {}); };
        receiver.ontrack = event => { teacherVideo.srcObject = event.streams[0]; void teacherVideo.play(); };
        stream.getTracks().forEach(track => sender.addTrack(track, stream));
        await sender.setLocalDescription(await sender.createOffer()); await receiver.setRemoteDescription(sender.localDescription!);
        await receiver.setLocalDescription(await receiver.createAnswer()); await sender.setRemoteDescription(receiver.localDescription!);
        const detector = await api.coco.load({ base: "lite_mobilenet_v2", modelUrl: "/api/models/coco/model.json" });
        console.log("workload-phase device-ready", Math.round(performance.now() - start));
        const raw = document.createElement("canvas"); raw.width = 480; raw.height = 270;
        const rawCtx = raw.getContext("2d")!; const bright = document.createElement("canvas"); const brightCtx = bright.getContext("2d", { willReadFrequently: true })!;
        let faceBusy = false, objectBusy = false, faceCount = 0, objectCount = 0, stopped = false;
        const faceTimer = setInterval(async () => {
          if (faceBusy || objectBusy) return; faceBusy = true; const time = performance.now();
          try {
            rawCtx.drawImage(video, 0, 0, 480, 270);
            const faces = await api.detectDesktopFacesWithFallback(320, (size: number, threshold: number) =>
              faceapi.detectAllFaces(size === 320 ? api.prepareDesktopFaceFrame(raw, bright, brightCtx) : raw,
                new faceapi.TinyFaceDetectorOptions({ inputSize: size, scoreThreshold: threshold })).withFaceLandmarks(false));
            if (faces.length) faceCount++;
            faceMs.push(performance.now() - time);
          } finally { faceBusy = false; }
        }, profile.detectionIntervalMs);
        const objectTimer = setInterval(async () => {
          if (objectBusy || faceBusy) return; objectBusy = true; const time = performance.now();
          try { rawCtx.drawImage(video, 0, 0, 480, 270); await detector.detect(raw, 10, .5); objectCount++; objectMs.push(performance.now() - time); }
          catch (error) { if (!stopped) throw error; }
          finally { objectBusy = false; }
        }, profile.objectDetectionIntervalMs);
        try {
          await sleep(12_000);
          const stats = await receiver.getStats(); let decodedFrames = 0;
          stats.forEach(row => { if (row.type === "inbound-rtp" && row.kind === "video") decodedFrames += row.framesDecoded || 0; });
          return { mode, backend: faceapi.tf.getBackend(), clicks, faceCount, objectCount, faceMs, objectMs, decodedFrames, settings,
            maxHeartbeatGapMs: Math.max(...gaps), durationMs: performance.now() - start, sourceStillLive: stream.getVideoTracks()[0].readyState };
        } finally {
          stopped = true;
          clearInterval(faceTimer); clearInterval(objectTimer); clearInterval(heartbeat); clearInterval(drawing);
          detector.dispose(); evidence.dispose(); sender.close(); receiver.close();
          video.pause(); teacherVideo.pause(); stream.getTracks().forEach(track => track.stop());
        }
      }, mode);
      // Actual trusted input travels through Chromium while all monitoring runs.
      const clickMs: number[] = [];
      let finished = false; void run.then(() => { finished = true; }, () => { finished = true; });
      let clickTimeouts = 0;
      while (!finished) {
        const time = performance.now();
        try { await page.mouse.click(answerBox.x + answerBox.width / 2, answerBox.y + answerBox.height / 2); }
        catch { clickTimeouts++; }
        clickMs.push(performance.now() - time);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      const result = await run;
      const metricsAfter = await client.send("Performance.getMetrics");
      const metric = (value: typeof metricsAfter, name: string) => value.metrics.find(item => item.name === name)?.value ?? 0;
      rows.push({ ...result, clickMs, clickTimeouts, maxClickMs: Math.max(...clickMs), pageErrors: errors,
        mainThreadTaskSeconds: metric(metricsAfter, "TaskDuration") - metric(metricsBefore, "TaskDuration") });
      console.log(JSON.stringify(rows.at(-1)));
      assert.deepEqual(errors, []);
      assert.ok(result.faceCount > 0 && result.objectCount > 0 && result.decodedFrames > 0);
      await context.close();
    }
    const after = rows[0];
    assert.equal(after.backend, "wasm");
    assert.ok(after.settings.every((setting: MediaTrackSettings) => setting.width! <= 480 && setting.height! <= 360 && setting.frameRate! <= 8));
    const pixels = (row: typeof after) => row.settings[0].width * row.settings[0].height * row.settings[0].frameRate;
    const deployedPixelRate = 1280 * 720 * 24;
    assert.ok(pixels(after) < deployedPixelRate / 10);
    // Dispatch trusted pointer input directly. Locator auto-wait measures two
    // animation frames as well, which is different from a user's pointer click.
    assert.equal(after.clickTimeouts, 0);
    assert.ok(after.clicks >= 8);
    assert.ok(after.maxClickMs < 2_000, `trusted pointer input must respond during cold startup and active monitoring at ${throttleRate}x CPU throttling`);
    await fs.mkdir("release-review/proctoring-laptop-20261017", { recursive: true });
    await fs.writeFile("release-review/proctoring-laptop-20261017/combined-workload.json", JSON.stringify({ scope: "Synthetic camera on the actual host; real WASM face/object models, encoders and WebRTC. Physical Chrome/driver behavior is separate.", throttleRate, evidencePixelReductionPercent: 100 * (1 - pixels(after) / deployedPixelRate), rows }, null, 2));
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
