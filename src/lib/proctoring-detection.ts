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

const PHONE_CLASSES = new Set(["cell phone", "mobile phone", "smartphone"]);

export function getUnauthorizedDeviceConfidence(predictions: ObjectPrediction[]): number {
  let confidence = 0;
  for (const prediction of predictions) {
    const label = prediction.class.toLowerCase();
    if (PHONE_CLASSES.has(label) && prediction.score >= 0.3) {
      confidence = Math.max(confidence, prediction.score);
    } else if (label === "remote" && prediction.score >= 0.55) {
      // Phones viewed edge-on or from the back are sometimes classified as remotes by COCO-SSD.
      confidence = Math.max(confidence, prediction.score);
    }
  }
  return confidence;
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

