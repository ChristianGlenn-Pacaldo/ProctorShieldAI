import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceClipBuffer } from "../src/lib/evidence-clip-buffer.ts";

function fixture(options: { stopDelay?: number; startFailures?: number; neverFinalizes?: boolean; rejectMime?: string; video?: HTMLVideoElement } = {}) {
  let stoppedTracks = 0;
  const stream = { getVideoTracks: () => [{ readyState: "live", stop() { stoppedTracks++; } }] } as unknown as MediaStream;
  const recorders: FakeRecorder[] = [];
  const mimeAttempts: string[] = [];
  class FakeRecorder {
    state = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    start() { this.state = "recording"; this.frame("container-header"); }
    frame(label: string) { if (this.state === "recording") this.ondataavailable?.({ data: new Blob([label + "\n"]) }); }
    stop() {
      this.state = "inactive";
      if (options.neverFinalizes) return;
      if (options.stopDelay) setTimeout(() => this.onstop?.(), options.stopDelay);
      else this.onstop?.();
    }
  }
  const buffer = createEvidenceClipBuffer(stream, {
    video: options.video,
    now: () => Date.now(), isTypeSupported: type => type === "video/webm" || Boolean(options.rejectMime && type === options.rejectMime),
    createRecorder: (input, settings) => {
      mimeAttempts.push(settings.mimeType!);
      if (settings.mimeType === options.rejectMime) throw new Error("phone encoder rejects advertised codec");
      assert.equal(input, stream);
      if ((options.startFailures ?? 0) > 0) { options.startFailures!--; throw new Error("encoder busy"); }
      const recorder = new FakeRecorder(); recorders.push(recorder); return recorder as unknown as MediaRecorder;
    },
  });
  return { buffer, recorders, mimeAttempts, get stoppedTracks() { return stoppedTracks; } };
}

test("evidence contains the turn before confirmation and the return afterward in one playable container", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const f = fixture();
  try {
    t.mock.timers.tick(1_500);
    f.recorders.forEach(recorder => recorder.frame("looking-left"));
    t.mock.timers.tick(800);
    const pending = f.buffer.capture();
    f.recorders.forEach(recorder => recorder.frame("focused-after-alert"));
    t.mock.timers.tick(1_500);
    const clip = await pending;
    assert.ok(clip);
    assert.equal(clip.durationMs, 3_800);
    assert.equal(clip.extension, "webm");
    assert.equal(await clip.blob.text(), "container-header\nlooking-left\nfocused-after-alert\n");
    assert.equal(f.stoppedTracks, 0);
  } finally { f.buffer.dispose(); }
});

test("delayed native finalization preserves a valid clip and uses its recording duration", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const f = fixture({ stopDelay: 1_200 });
  try {
    for (let i = 0; i < 29; i++) t.mock.timers.tick(100);
    const pending = f.buffer.capture();
    for (let i = 0; i < 28; i++) t.mock.timers.tick(100);
    const clip = await pending;
    assert.ok(clip);
    assert.equal(clip.durationMs, 4_400);
    assert.match(await clip.blob.text(), /container-header/);
  } finally { f.buffer.dispose(); t.mock.timers.tick(2_000); }
});

test("mobile encoder finalization after three seconds retains the incident video", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const f = fixture({ stopDelay: 3_000 });
  try {
    const pending = f.buffer.capture();
    for (let i = 0; i < 62; i++) t.mock.timers.tick(100);
    const clip = await pending;
    assert.ok(clip);
    assert.equal(clip.durationMs, 3_100);
  } finally { f.buffer.dispose(); t.mock.timers.tick(6_000); }
});

test("a phone that advertises but cannot start VP8/Opus falls back to native WebM", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const f = fixture({ rejectMime: "video/webm;codecs=vp8,opus" });
  try {
    const pending = f.buffer.capture();
    for (let i = 0; i < 32; i++) t.mock.timers.tick(100);
    assert.ok(await pending);
    assert.deepEqual(f.mimeAttempts.slice(0, 2), ["video/webm;codecs=vp8,opus", "video/webm"]);
    assert.equal(f.stoppedTracks, 0);
  } finally { f.buffer.dispose(); }
});

test("camera video remains recordable when canvas capture is unavailable", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  // No document/canvas in this environment: createEvidenceVideoSource returns null.
  const f = fixture({ video: {} as HTMLVideoElement });
  try {
    const pending = f.buffer.capture();
    for (let i = 0; i < 32; i++) t.mock.timers.tick(100);
    assert.ok(await pending);
    assert.equal(f.stoppedTracks, 0);
  } finally { f.buffer.dispose(); }
});

test("a recorder that never finalizes cannot block submission indefinitely", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const f = fixture({ neverFinalizes: true });
  try {
    const pending = f.buffer.capture();
    for (let i = 0; i < 82; i++) t.mock.timers.tick(100);
    assert.equal(await pending, null);
  } finally { f.buffer.dispose(); t.mock.timers.tick(2_000); }
});

test("a transient startup failure is retried when an incident needs a clip", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const f = fixture({ startFailures: 1 });
  try {
    const pending = f.buffer.capture();
    for (let i = 0; i < 32; i++) t.mock.timers.tick(100);
    assert.ok(await pending);
    assert.equal(f.stoppedTracks, 0);
  } finally { f.buffer.dispose(); }
});

for (const at of [0, 1_499, 1_500, 2_999, 3_000, 4_499, 9_000]) {
  test(`capture at rotation boundary ${at}ms stays within the upload duration limits`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    const f = fixture();
    try {
      // Advance in frame-sized increments, as the real event loop does.
      for (let elapsed = 0; elapsed < at;) { const step = Math.min(100, at - elapsed); t.mock.timers.tick(step); elapsed += step; }
      const pending = f.buffer.capture();
      for (let i = 0; i < 32; i++) t.mock.timers.tick(100);
      const clip = await pending;
      assert.ok(clip);
      assert.ok(clip.durationMs >= 3_000 && clip.durationMs <= 5_500);
      assert.ok((await clip.blob.text()).startsWith("container-header\n"));
    } finally { f.buffer.dispose(); }
  });
}

test("rotation keeps at most two background recorders and disposal resolves a capture without stopping camera tracks", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const f = fixture();
  for (let i = 0; i < 40; i++) {
    t.mock.timers.tick(1_500);
    assert.ok(f.recorders.filter(recorder => recorder.state === "recording").length <= 2);
  }
  const pending = f.buffer.capture();
  f.buffer.dispose();
  await pending;
  assert.equal(f.recorders.filter(recorder => recorder.state === "recording").length, 0);
  assert.equal(f.stoppedTracks, 0);
  assert.equal(await f.buffer.capture(), null);
});

test("unsupported MediaRecorder returns no clip without touching camera tracks", async () => {
  const buffer = createEvidenceClipBuffer({} as MediaStream, { isTypeSupported: () => false });
  try { assert.equal(await buffer.capture(), null); } finally { buffer.dispose(); }
});
