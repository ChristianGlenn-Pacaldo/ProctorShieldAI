import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs";
import ts from "typescript";
import { getProctoringPerformanceProfile } from "../src/lib/device-capabilities.ts";
import { requestDesktopCamera } from "../src/lib/desktop-head-tracking.ts";
import { getEvidenceVideoDimensions } from "../src/lib/evidence-video-source.ts";

test("four-thread laptops keep detailed head tracking while giving camera encoding and object AI CPU headroom", async () => {
  const profile = getProctoringPerformanceProfile("desktop", { hardwareConcurrency: 4, deviceMemory: 8 });
  assert.equal(profile.lowPower, true);
  assert.equal(profile.frameRate, 12);
  assert.equal(profile.faceInputSize, 320);
  assert.equal(profile.useTinyLandmarks, false);
  assert.ok(profile.objectDetectionIntervalMs >= profile.detectionIntervalMs * 2);
  assert.ok(profile.snapshotIntervalMs >= 5_000);
  let constraints: MediaStreamConstraints | undefined;
  await requestDesktopCamera(async value => { constraints = value; return {} as MediaStream; }, true, profile.frameRate);
  assert.deepEqual(constraints, { video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 12 } }, audio: true });
});

test("higher-capacity desktops retain the original face cadence and mobile keeps its own profile", () => {
  const desktop = getProctoringPerformanceProfile("desktop", { hardwareConcurrency: 8, deviceMemory: 8 });
  assert.equal(desktop.lowPower, false);
  assert.equal(desktop.frameRate, 24);
  assert.equal(desktop.detectionIntervalMs, 500);
  const mobile = getProctoringPerformanceProfile("mobile", { hardwareConcurrency: 4, deviceMemory: 4 });
  assert.equal(mobile.faceInputSize, 128);
  assert.equal(mobile.detectionIntervalMs, 1_600);
  assert.equal(mobile.useTinyLandmarks, true);
  assert.equal(mobile.captureWidth, 640);
  assert.equal(mobile.captureHeight, 480);
});

test("evidence is bounded in both orientations without stretching or upscaling", () => {
  assert.deepEqual(getEvidenceVideoDimensions(1280, 720), { width: 480, height: 270 });
  assert.deepEqual(getEvidenceVideoDimensions(720, 1280), { width: 202, height: 360 });
  assert.deepEqual(getEvidenceVideoDimensions(640, 480), { width: 480, height: 360 });
  assert.deepEqual(getEvidenceVideoDimensions(320, 240), { width: 320, height: 240 });
});

test("evidence samples raw video eight times per second, preserves microphone tracks and stops only its own capture", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let cameraStops = 0, audioStops = 0, ownedStops = 0, draws = 0, fps = 0;
  const camera = { kind: "video", getSettings: () => ({ width: 1280, height: 720 }), stop() { cameraStops++; } };
  const audio = { kind: "audio", readyState: "live", stop() { audioStops++; } };
  const owned = { kind: "video", stop() { ownedStops++; } };
  const source = { getVideoTracks: () => [camera], getAudioTracks: () => [audio] };
  const video = { readyState: 2, videoWidth: 1280, videoHeight: 720 };
  const canvas = { width: 0, height: 0,
    getContext: () => ({ drawImage(...args: unknown[]) { assert.equal(args[0], video); draws++; } }),
    captureStream(value: number) { fps = value; return { getVideoTracks: () => [owned] }; },
  };
  const exports: { createEvidenceVideoSource?: (stream: unknown, video: unknown) => { stream: { tracks: unknown[] }; dispose(): void } } = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/evidence-video-source.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, document: { createElement: () => canvas }, setInterval, clearInterval,
    MediaStream: class { tracks: unknown[]; constructor(tracks: unknown[]) { this.tracks = tracks; } },
  });
  const recording = exports.createEvidenceVideoSource!(source, video)!;
  assert.equal(canvas.width, 480); assert.equal(canvas.height, 270); assert.equal(fps, 8);
  assert.equal(recording.stream.tracks[0], owned); assert.equal(recording.stream.tracks[1], audio);
  t.mock.timers.tick(1_000); assert.equal(draws, 9);
  recording.dispose(); t.mock.timers.tick(1_000); assert.equal(draws, 9);
  assert.equal(cameraStops, 0); assert.equal(audioStops, 0); assert.equal(ownedStops, 1);
});

for (const failWasm of [false, true]) {
  test(`low-power face runtime uses one WASM thread and ${failWasm ? "falls back to CPU without touching WebGL" : "initializes WASM before any inference"}`, async () => {
    const calls: unknown[][] = [];
    const exports: { initializeProctoringFaceRuntime?: (tf: unknown, lowPower: boolean) => Promise<void> } = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/proctoring-face-runtime.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require(name: string) {
      assert.equal(name, "@tensorflow/tfjs-backend-wasm");
      return { setThreadsCount: (count: number) => calls.push(["threads", count]), setWasmPaths: (url: string) => calls.push(["path", url]) };
    } });
    const tf = { enableProdMode() {}, env: () => ({ set: (key: string, value: boolean) => calls.push([key, value]) }),
      async setBackend(name: string) { calls.push(["backend", name]); if (name === "wasm" && failWasm) throw Error("asset offline"); return true; },
      async ready() { calls.push(["ready"]); },
    };
    await exports.initializeProctoringFaceRuntime!(tf, true);
    assert.deepEqual(calls, [["WASM_HAS_MULTITHREAD_SUPPORT", false], ["threads", 1], ["path", "/api/models/device/"], ["backend", "wasm"], ...(failWasm ? [["backend", "cpu"]] : []), ["ready"]]);
  });
}
