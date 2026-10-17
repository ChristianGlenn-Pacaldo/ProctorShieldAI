import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("phone-shaped evidence survives codec and canvas failures and replays motion", { timeout: 90_000 }, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {createEvidenceClipBuffer} from './src/lib/evidence-clip-buffer';
    window.makeEvidence=createEvidenceClipBuffer;
  ` }, bundle: true, write: false, platform: "browser", format: "iife" });
  const browser = await chromium.launch({ headless: true, args: ["--disable-gpu"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    for (const mode of ["portrait", "codec-fallback", "camera-fallback"]) {
      const result = await page.evaluate(async mode => {
        const canvas = document.createElement("canvas");
        canvas.width = mode === "camera-fallback" ? 240 : 720;
        canvas.height = mode === "camera-fallback" ? 320 : 1280;
        const context = canvas.getContext("2d")!;
        let after = false;
        const draw = () => { context.fillStyle = after ? "#0000ff" : "#ff0000"; context.fillRect(0, 0, canvas.width, canvas.height); };
        draw(); const drawing = setInterval(draw, 80);
        const source = canvas.captureStream(12);
        const video = document.createElement("video"); video.muted = true; video.srcObject = source; await video.play();
        const attempts: string[] = [];
        const sizes: number[][] = [];
        const captureStream = HTMLCanvasElement.prototype.captureStream;
        if (mode === "camera-fallback") HTMLCanvasElement.prototype.captureStream = () => { throw Error("phone canvas capture unavailable"); };
        const buffer = (window as any).makeEvidence(source, { video,
          createRecorder(input: MediaStream, options: MediaRecorderOptions) {
            attempts.push(options.mimeType!);
            if (mode === "codec-fallback" && options.mimeType!.includes("codecs=")) throw Error("advertised codec cannot encode");
            const settings = input.getVideoTracks()[0].getSettings(); sizes.push([settings.width!, settings.height!]);
            return new MediaRecorder(input, options);
          },
        });
        HTMLCanvasElement.prototype.captureStream = captureStream;
        try {
          await new Promise(resolve => setTimeout(resolve, 2_200));
          const pending = buffer.capture(); after = true; draw();
          const clip = await pending;
          if (!clip) throw Error("Incident video unavailable");
          const output = document.createElement("video"); output.muted = true;
          const url = URL.createObjectURL(clip.blob); output.src = url;
          try {
            await output.play();
            const pixelCanvas = document.createElement("canvas"); pixelCanvas.width = 1; pixelCanvas.height = 1;
            const pixelContext = pixelCanvas.getContext("2d", { willReadFrequently: true })!;
            const pixel = () => { pixelContext.drawImage(output, 0, 0, 1, 1); return [...pixelContext.getImageData(0, 0, 1, 1).data]; };
            const before = pixel(); await new Promise(resolve => setTimeout(resolve, clip.durationMs - 400));
            return { before, after: pixel(), bytes: clip.blob.size, durationMs: clip.durationMs, attempts, sizes, sourceLive: source.getVideoTracks()[0].readyState };
          } finally { output.pause(); URL.revokeObjectURL(url); }
        } finally { buffer.dispose(); clearInterval(drawing); video.pause(); source.getTracks().forEach(track => track.stop()); }
      }, mode);
      assert.ok(result.bytes > 1_000, mode);
      assert.ok(result.durationMs >= 3_000 && result.durationMs <= 5_500, mode);
      assert.ok(result.before[0] > 180 && result.before[2] < 60, mode + " pre-incident video");
      assert.ok(result.after[2] > 180 && result.after[0] < 60, mode + " post-incident video");
      assert.equal(result.sourceLive, "live");
      for (const [width, height] of result.sizes) { assert.equal(width % 2, 0); assert.equal(height % 2, 0); }
      if (mode === "codec-fallback") assert.deepEqual(result.attempts.slice(0, 2), ["video/webm;codecs=vp8,opus", "video/webm"]);
      console.log(JSON.stringify({ mode, ...result }));
    }
  } finally { await browser.close(); }
});
