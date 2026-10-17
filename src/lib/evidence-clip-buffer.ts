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
  const mimeTypes = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].filter(supported);
  const now = options.now ?? (() => performance.now());
  const videoSource = mimeTypes.length && options.video ? createEvidenceVideoSource(source, options.video) : null;
  // captureStream and isTypeSupported are capability hints, not guarantees
  // that this phone can encode that canvas/codec combination.
  const sources = videoSource ? [videoSource.stream, source] : [source];
  const profiles = sources.flatMap(stream => mimeTypes.map(mimeType => ({ stream, mimeType })));
  let preferredProfile = 0;
  const windows = new Set<{
    recorder: MediaRecorder;
    startedAt: number;
    claimed: boolean;
    retryable: boolean;
    finish: () => void;
    result: Promise<EvidenceClip | null>;
  }>();
  let disposed = false;

  const startWindow = () => {
    if (disposed) return;
    const firstProfile = preferredProfile;
    for (let attempt = 0; attempt < profiles.length; attempt++) {
      const profileIndex = (firstProfile + attempt) % profiles.length;
      const { stream: recordingSource, mimeType } = profiles[profileIndex];
      if (!recordingSource.getVideoTracks().some(track => track.readyState === "live")) continue;
      let abandon: (() => void) | undefined;
      try {
        const recorder = options.createRecorder
          ? options.createRecorder(recordingSource, { mimeType, videoBitsPerSecond: 250_000, audioBitsPerSecond: 32_000 })
          : new MediaRecorder(recordingSource, { mimeType, videoBitsPerSecond: 250_000, audioBitsPerSecond: 32_000 });
        const chunks: BlobPart[] = [];
        let resolve!: (clip: EvidenceClip | null) => void;
        let finished = false;
        let stoppedAt: number | null = null;
        let finalizationTimer: ReturnType<typeof setTimeout> | undefined;
        const result = new Promise<EvidenceClip | null>(done => { resolve = done; });
        const settle = (clip: EvidenceClip | null) => {
          if (finished) return;
          finished = true;
          clearTimeout(deadline);
          clearTimeout(finalizationTimer);
          windows.delete(entry);
          resolve(clip);
        };
        const entry = {
          recorder, startedAt: now(), claimed: false, retryable: false, result,
          finish() {
            if (stoppedAt !== null) return;
            if (recorder.state !== "inactive") {
              // Native encoders may deliver their final chunks later. Their
              // delivery delay is not part of the recorded camera duration.
              stoppedAt = now();
              // Mobile encoders may need longer to flush while face AI is busy.
              if (!finished) finalizationTimer = setTimeout(() => settle(null), 5_000);
              try { recorder.stop(); } catch { settle(null); }
            } else { settle(null); }
          },
        };
        // Bound both recording and the wait for a final onstop event.
        const deadline = setTimeout(() => entry.finish(), 5_500);
        recorder.ondataavailable = event => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onerror = () => {
          entry.retryable = true;
          preferredProfile = (profileIndex + 1) % profiles.length;
          settle(null);
          entry.finish();
        };
        recorder.onstop = () => {
          if (finished) return;
          const durationMs = Math.round((stoppedAt ?? now()) - entry.startedAt);
          const type = mimeType.startsWith("video/mp4") ? "video/mp4" : "video/webm";
          entry.retryable = chunks.length === 0;
          if (entry.retryable) preferredProfile = (profileIndex + 1) % profiles.length;
          settle(entry.claimed && durationMs >= 3_000 && durationMs <= 5_500 && chunks.length > 0
            ? { blob: new Blob(chunks, { type }), durationMs, extension: type === "video/mp4" ? "mp4" : "webm" }
            : null);
        };
        windows.add(entry);
        abandon = () => { settle(null); entry.finish(); };
        recorder.start(500);
        preferredProfile = profileIndex;
        return;
      } catch {
        // Constructor/start can fail even when isTypeSupported returned true.
        // Do not leave a failed entry or its timers in the rolling buffer.
        abandon?.();
    }
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
    async capture(): Promise<EvidenceClip | null> {
      if (disposed) return null;
      for (let attempt = 0; attempt < 2 && !disposed; attempt++) {
        let entry = [...windows].find(item => !item.claimed && item.recorder.state === "recording");
        if (!entry) {
          // Retry a transient recorder-start failure at the incident itself.
          startWindow();
          entry = [...windows].find(item => !item.claimed && item.recorder.state === "recording");
        }
        if (!entry) return null;
        entry.claimed = true;
        // Preserve 1.5–3 seconds before confirmation and 1.5 seconds after it.
        const remaining = Math.max(3_050 - (now() - entry.startedAt), 1_500);
        const stopTimer = setTimeout(() => entry.finish(), remaining);
        void entry.result.finally(() => clearTimeout(stopTimer));
        const clip = await entry.result;
        if (clip || !entry.retryable) return clip;
        // Retry a failed phone encoder once using another supported profile.
        // The camera/microphone stay live throughout recovery.
      }
      return null;
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
