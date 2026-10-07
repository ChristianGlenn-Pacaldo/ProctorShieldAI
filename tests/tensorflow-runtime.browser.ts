import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import nextConfig from "../next.config.ts";

// Opt-in: node --test tests/tensorflow-runtime.browser.ts
// Exercises real model weights and inference without webcam permissions or app services.
test("modular TensorFlow initializes face-api and COCO on one browser engine", { timeout: 180_000 }, async () => {
  const alias = nextConfig.turbopack!.resolveAlias!["@tensorflow/tfjs/dist/index.js"] as string;
  const bundle = await build({
    stdin: { contents: `
      import * as faceapi from '@vladmandic/face-api/dist/face-api.esm-nobundle.js';
      import * as core from '@tensorflow/tfjs-core';
      import * as coco from '@tensorflow-models/coco-ssd';
      window.monitoring = { faceapi, core, coco };
    `, resolveDir: process.cwd() },
    alias: { "@tensorflow/tfjs/dist/index.js": path.resolve(alias) },
    bundle: true, write: false, platform: "browser", format: "iife",
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://models.example.test/models/*", async route => {
    const file = path.basename(new URL(route.request().url()).pathname);
    await route.fulfill({ body: await fs.readFile(path.join("public/models", file)),
      contentType: file.endsWith(".json") ? "application/json" : "application/octet-stream",
      headers: { "access-control-allow-origin": "*" } });
  });
  try {
    await page.setContent('<canvas id="frame" width="160" height="160"></canvas>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const { faceapi, core, coco } = (window as any).monitoring;
      faceapi.tf.enableProdMode();
      await faceapi.tf.ready();
      const sharedEngine = faceapi.tf.engine() === core.engine();
      const backends = ["cpu", "webgl", "wasm"].map(name => Boolean(core.findBackendFactory(name)));
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri("https://models.example.test/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("https://models.example.test/models"),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri("https://models.example.test/models"),
      ]);
      const model = await coco.load({ base: "lite_mobilenet_v2" });
      const canvas = document.getElementById("frame") as HTMLCanvasElement;
      canvas.getContext("2d")!.fillRect(0, 0, 160, 160);
      const inference = [];
      for (const backend of ["webgl", "cpu"]) {
        await core.setBackend(backend); await core.ready();
        const full = await faceapi.detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks(false);
        const tiny = await faceapi.detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks(true);
        const fullLandmarks = await faceapi.nets.faceLandmark68Net.detectLandmarks(canvas);
        const tinyLandmarks = await faceapi.nets.faceLandmark68TinyNet.detectLandmarks(canvas);
        const objects = await model.detect(canvas);
        inference.push({ backend: core.getBackend(), full: full.length, tiny: tiny.length, objects: objects.length,
          fullLandmarks: fullLandmarks.positions.length, tinyLandmarks: tinyLandmarks.positions.length });
      }
      model.dispose();
      faceapi.nets.tinyFaceDetector.dispose();
      faceapi.nets.faceLandmark68Net.dispose();
      faceapi.nets.faceLandmark68TinyNet.dispose();
      return { sharedEngine, backends, inference };
    });
    assert.equal(result.sharedEngine, true);
    assert.deepEqual(result.backends, [true, true, true]);
    assert.deepEqual(result.inference, [
      { backend: "webgl", full: 0, tiny: 0, objects: 0, fullLandmarks: 68, tinyLandmarks: 68 },
      { backend: "cpu", full: 0, tiny: 0, objects: 0, fullLandmarks: 68, tinyLandmarks: 68 },
    ]);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
