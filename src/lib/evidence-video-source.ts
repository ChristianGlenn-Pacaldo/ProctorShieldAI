export const EVIDENCE_VIDEO_FPS = 8;

export function getEvidenceVideoDimensions(width: number, height: number) {
  if (!(width > 0 && height > 0)) return { width: 480, height: 360 };
  const scale = Math.min(1, 480 / width, 360 / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Encode the short evidence windows from one small raw-pixel buffer. Encoding
// both windows directly from the HD camera also competes with the teacher's
// live stream and the two AI runtimes on older laptops.
export function createEvidenceVideoSource(source: MediaStream, video: HTMLVideoElement) {
  let capture: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const dispose = () => {
    if (timer) clearInterval(timer);
    timer = null;
    capture?.getVideoTracks().forEach(track => track.stop());
    capture = null;
  };
  try {
    const settings = source.getVideoTracks()[0]?.getSettings();
    const dimensions = getEvidenceVideoDimensions(video.videoWidth || settings?.width || 0, video.videoHeight || settings?.height || 0);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context || typeof canvas.captureStream !== "function") return null;
    const draw = () => {
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;
      // CSS preview mirroring and detector overlays never enter the recording.
      try { context.drawImage(video, 0, 0, canvas.width, canvas.height); } catch { /* Retry the next frame after a media interruption. */ }
    };
    draw();
    capture = canvas.captureStream(EVIDENCE_VIDEO_FPS);
    timer = setInterval(draw, 1_000 / EVIDENCE_VIDEO_FPS);
    return { stream: new MediaStream([...capture.getVideoTracks(), ...source.getAudioTracks().filter(track => track.readyState === "live")]), dispose };
  } catch {
    dispose();
    return null;
  }
}
