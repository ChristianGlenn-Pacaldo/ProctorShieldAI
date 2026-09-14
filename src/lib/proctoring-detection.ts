export interface ObjectPrediction {
  class: string;
  score: number;
}

export interface ShortcutEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export const VALID_VIOLATION_TYPES = [
  "no_face",
  "multiple_faces",
  "looking_away",
  "looking_left",
  "looking_right",
  "looking_up",
  "looking_down",
  "device_detected",
  "audio_anomaly",
  "fullscreen_exit",
  "tab_switch",
  "attempted_screenshot",
  "clipboard_attempt",
  "developer_tools",
  "camera_unavailable",
] as const;

export type ViolationType = typeof VALID_VIOLATION_TYPES[number];

export const VIOLATION_LABELS: Record<ViolationType, string> = {
  no_face: "No face detected",
  multiple_faces: "Multiple faces detected",
  looking_away: "Looking away",
  looking_left: "Looking left",
  looking_right: "Looking right",
  looking_up: "Looking up",
  looking_down: "Looking down",
  device_detected: "Unauthorized phone/device detected",
  audio_anomaly: "Sustained loud audio detected",
  fullscreen_exit: "Fullscreen exited",
  tab_switch: "App/tab switch or window minimized",
  attempted_screenshot: "Screenshot attempt",
  clipboard_attempt: "Copy/paste attempt",
  developer_tools: "Developer tools shortcut",
  camera_unavailable: "Camera disconnected",
};

export function getViolationLabel(type: string): string {
  return VIOLATION_LABELS[type as ViolationType]
    || type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const DEVICE_THRESHOLDS = new Map<string, number>([
  ["cell phone", 0.2],
  ["mobile phone", 0.2],
  ["smartphone", 0.2],
  // A phone held sideways with its display facing the camera is frequently
  // classified as a remote. Require much stronger evidence for that generic
  // label because faces, furniture, and wall fixtures produce false matches.
  ["remote", 0.55],
  ["laptop", 0.65],
  // Do not classify a stationary TV/monitor in the room as a handheld phone.
  // The browser cannot reliably distinguish a background display from a
  // second device being used, so those cases remain for teacher review.
]);

export function getUnauthorizedDeviceConfidence(predictions: ObjectPrediction[]): number {
  let confidence = 0;
  for (const prediction of predictions) {
    const label = prediction.class.toLowerCase();
    const threshold = DEVICE_THRESHOLDS.get(label);
    if (threshold !== undefined && prediction.score >= threshold) {
      confidence = Math.max(confidence, prediction.score);
    }
  }
  return confidence;
}

export function getAudioSignalLevel(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;

  let sumSquares = 0;
  for (let index = 0; index < samples.length; index++) {
    const normalized = (Number(samples[index]) - 128) / 128;
    sumSquares += normalized * normalized;
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  // Mobile browser microphones commonly apply aggressive noise suppression and
  // automatic gain control, leaving speech with a much smaller PCM amplitude.
  return Math.max(0, Math.min(100, Math.round(rms * 500)));
}

export function getAudioAnomalyThreshold(noiseFloor: number): number {
  const normalizedFloor = Number.isFinite(noiseFloor)
    ? Math.max(0, Math.min(100, noiseFloor))
    : 0;
  // Phone microphones commonly sit between 2% and 18% because of automatic
  // gain control, fans, handling noise, or nearby conversation. Treat only a
  // clearly louder sustained signal as anomalous; ordinary room noise should
  // remain below the 20% floor.
  return Math.max(20, Math.min(40, Math.round(normalizedFloor + 12)));
}

export function isScreenshotShortcut(event: ShortcutEvent): boolean {
  const key = event.key.toLowerCase();
  if (key === "printscreen") return true;

  // macOS screenshots and the Windows snipping shortcut. OS-level handlers may
  // consume these before the browser receives them, but detectable events are blocked.
  return Boolean(
    event.metaKey &&
    event.shiftKey &&
    ["3", "4", "5", "s"].includes(key)
  );
}
