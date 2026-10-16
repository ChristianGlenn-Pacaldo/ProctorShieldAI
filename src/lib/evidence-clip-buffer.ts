import { createEvidenceVideoSource } from "./evidence-video-source.ts";

export type EvidenceClip = {
  blob: Blob;
  durationMs: number;
  extension: "webm" | "mp4";
};

// Each recorder produces its own playable file, including its container header.
// Keep two overlapping windows so an incident includes the movement before the
// detector confirms it. Never join arbitrary MediaRecorder chunks from a ring.
export function createEvidenceClipBuffer(source: MediaStream, options: {
  video?: HTMLVideoElement;
  createRecorder?: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  isTypeSupported?: (type: string) => boolean;
  now?: () => number;
} = {}) {
  const supported = options.isTypeSupported ?? ((type: string) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type));
  const mimeType = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find(supported);
  const now = options.now ?? (() => performance.now());
  const videoSource = mimeType && options.video ? createEvidenceVideoSource(source, options.video) : null;
  const recordingSource = options.video ? videoSource?.stream : source;
  const windows = new Set<{
    recorder: MediaRecorder;
    startedAt: number;
    claimed: boolean;
    finish: () => void;
    result: Promise<EvidenceClip | null>;
  }>();
  let disposed = false;

  const startWindow = () => {
    if (disposed || !mimeType || !recordingSource?.getVideoTracks().some(track => track.readyState === "live")) return;
    try {
      const recorder = options.createRecorder
        ? options.createRecorder(recordingSource, { mimeType, videoBitsPerSecond: 250_000, audioBitsPerSecond: 32_000 })
        : new MediaRecorder(recordingSource, { mimeType, videoBitsPerSecond: 250_000, audioBitsPerSecond: 32_000 });
      const chunks: BlobPart[] = [];
      let resolve!: (clip: EvidenceClip | null) => void;
      let finished = false;
      const result = new Promise<EvidenceClip | null>(done => { resolve = done; });
      const settle = (clip: EvidenceClip | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        windows.delete(entry);
        resolve(clip);
      };
      const entry = {
        recorder, startedAt: now(), claimed: false, result,
        finish() {
          if (recorder.state !== "inactive") {
            try { recorder.stop(); } catch { settle(null); }
          } else { settle(null); }
        },
      };
      // Bound both recording and the wait for a final onstop event.
      const deadline = setTimeout(() => { entry.finish(); settle(null); }, 5_500);
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => { settle(null); entry.finish(); };
      recorder.onstop = () => {
        const durationMs = Math.round(now() - entry.startedAt);
        const type = mimeType.startsWith("video/mp4") ? "video/mp4" : "video/webm";
        settle(entry.claimed && durationMs >= 3_000 && durationMs <= 5_500 && chunks.length > 0
          ? { blob: new Blob(chunks, { type }), durationMs, extension: type === "video/mp4" ? "mp4" : "webm" }
          : null);
      };
      windows.add(entry);
      recorder.start(500);
    } catch {
      // Snapshot evidence still works; a later window can retry recording.
    }
  };

  startWindow();
  const rotation = setInterval(() => {
    const timestamp = now();
    for (const entry of windows) {
      if (!entry.claimed && timestamp - entry.startedAt >= 3_000) entry.finish();
    }
    startWindow();
  }, 1_500);

  return {
    capture(): Promise<EvidenceClip | null> {
      if (disposed) return Promise.resolve(null);
      const entry = [...windows].find(item => !item.claimed && item.recorder.state === "recording");
      if (!entry) return Promise.resolve(null);
      entry.claimed = true;
      // Preserve 1.5–3 seconds before confirmation and 1.5 seconds after it.
      const remaining = Math.max(3_050 - (now() - entry.startedAt), 1_500);
      const stopTimer = setTimeout(() => entry.finish(), remaining);
      void entry.result.finally(() => clearTimeout(stopTimer));
      return entry.result;
    },
    dispose() {
      disposed = true;
      clearInterval(rotation);
      for (const entry of windows) entry.finish();
      videoSource?.dispose();
      // The camera and microphone belong to the caller. Do not stop their tracks.
    },
  };
}
