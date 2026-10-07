import type { HeadPoseBaseline, HeadPoseResult } from "./head-pose";

// Brighten dark desktop face pixels with the fixed transform verified in webcam QA.
// A separate buffer keeps mobile, object detection and captured evidence raw.
const desktopFaceBrightnessLookup = Uint8ClampedArray.from(
  { length: 256 }, (_, value) => Math.round(255 * Math.pow(value / 255, 0.7)),
);
export function prepareDesktopFaceFrame(
  source: HTMLCanvasElement, target: HTMLCanvasElement, context: CanvasRenderingContext2D,
) {
  if (target.width !== source.width || target.height !== source.height) {
    target.width = source.width;
    target.height = source.height;
  }
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, target.width, target.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index] = desktopFaceBrightnessLookup[pixels.data[index]];
    pixels.data[index + 1] = desktopFaceBrightnessLookup[pixels.data[index + 1]];
    pixels.data[index + 2] = desktopFaceBrightnessLookup[pixels.data[index + 2]];
  }
  context.putImageData(pixels, 0, 0);
  return target;
}

// Check for missed desktop faces at higher detail without lowering confidence.
export async function detectDesktopFacesWithFallback<Detection>(
  primaryInputSize: number,
  detectFaces: (inputSize: number, scoreThreshold: number) => Promise<Detection[]>,
) {
  const primary = await detectFaces(primaryInputSize, 0.5);
  if (primary.length > 1 || primaryInputSize >= 320) return primary;
  const detailed = await detectFaces(320, 0.5);
  // Use detailed single-face landmarks for calibration and subsequent tracking.
  // Mixing primary calibration with recovered detailed poses biases pitch deltas.
  return detailed.length > 0 && detailed.length >= primary.length ? detailed : primary;
}

// Latch before yielding; clear recovery without letting an old upload latch it again.
export function createDesktopIncidentReporter() {
  let recorded = false, inFlight = false, generation = 0;
  return {
    clear() { recorded = false; generation++; },
    async reportIncident(report: () => Promise<boolean>) {
      if (recorded || inFlight) return false;
      recorded = true;
      inFlight = true;
      const incidentGeneration = generation;
      let persisted = false;
      try {
        persisted = await report();
        return persisted;
      } finally {
        if (!persisted && incidentGeneration === generation) recorded = false;
        inFlight = false;
      }
    },
  };
}

type Point = { x: number; y: number };
export function measureDesktopPose(left: Point, right: Point, nose: Point, inputMirrored = false): HeadPoseBaseline | null {
  const dx = Math.abs(right.x - left.x);
  const dy = right.x >= left.x ? right.y - left.y : left.y - right.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 8 || !Number.isFinite(distance)) return null;
  const nx = nose.x - (left.x + right.x) / 2;
  const ny = nose.y - (left.y + right.y) / 2;
  const yawOffset = (nx * dx + ny * dy) / (distance * distance) * (inputMirrored ? -1 : 1);
  const pitchRatio = (ny * dx - nx * dy) / (distance * distance);
  return Number.isFinite(yawOffset) && Number.isFinite(pitchRatio) ? { yawOffset, pitchRatio } : null;
}

// Use the centered nose tip (point 30) for yaw and vertical displacement.
// A nostril edge introduces yaw bias and flattens or reverses downward pitch.
export function measureDesktopLandmarkPose(left: Point, right: Point, nosePoints: readonly Point[], inputMirrored = false): HeadPoseBaseline | null {
  const noseTip = nosePoints[3];
  if (!noseTip || !nosePoints[8]) return null;
  return measureDesktopPose(left, right, noseTip, inputMirrored);
}

export function getDesktopInferenceDimensions(width: number, height: number, maxWidth: number, maxHeight: number) {
  if (!(width > 0 && height > 0)) return { width: maxWidth, height: maxHeight };
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function requestDesktopCamera(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>, audio: boolean,
) {
  try {
    return await getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } }, audio });
  } catch (error) {
    if ((error as { name?: string })?.name !== "OverconstrainedError") throw error;
    return getUserMedia({ video: { facingMode: "user" }, audio });
  }
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
// Recorded nose-tip down tilts exceed this delta; confirmation still rejects brief motion.
// Recorded moderate Left turns have 0.32–0.36 yaw deltas with inflated pitch.
// Recognize their horizontal movement before vertical classification; Right is unchanged.
const DESKTOP_LEFT_YAW_DELTA_THRESHOLD = 0.30;
const DESKTOP_DOWN_PITCH_DELTA_THRESHOLD = 0.12;
const DESKTOP_DOWN_NEUTRAL_DELTA_THRESHOLD = 0.08;
const focused = (calibrated: boolean): HeadPoseResult => ({ direction: "Focused ✓", violationReason: "", normalizedYaw: 0, normalizedPitch: 0, calibrated });

// Only desktop callers use this tracker. Mobile calibration and thresholds stay in head-pose.ts.
export function createDesktopHeadTracker() {
  let baseline: HeadPoseBaseline | null = null;
  let calibration: HeadPoseBaseline[] = [];
  let samples: HeadPoseBaseline[] = [];
  let lastTime: number | null = null;
  let candidate = "", since = 0, frames = 0, neutralFrames = 0, recorded = false, recordedReason = "";
  let reportInFlight = false, recordedGeneration = 0;
  const acknowledge = () => { recorded = true; recordedReason = candidate; recordedGeneration++; };
  const clearPending = () => { samples = []; candidate = ""; frames = 0; neutralFrames = 0; };
  return {
    reset() { baseline = null; calibration = []; lastTime = null; clearPending(); },
    acknowledge,
    async reportIncident(report: () => Promise<boolean>) {
      if (reportInFlight || recorded || !candidate) return false;
      // Latch this incident before yielding, while fresh frames keep scanning.
      // A centered return may rearm the tracker before the request completes.
      reportInFlight = true;
      acknowledge();
      const generation = recordedGeneration;
      let persisted = false;
      try {
        persisted = await report();
        return persisted;
      } finally {
        if (!persisted && generation === recordedGeneration) { recorded = false; recordedReason = ""; }
        reportInFlight = false;
      }
    },
    observe(input: HeadPoseBaseline | null, now: number, confidence = 1) {
      if (lastTime !== null && (now <= lastTime || now - lastTime > 2500)) { clearPending(); if (!baseline) calibration = []; }
      lastTime = now;
      if (!input || confidence < 0.5 || !Number.isFinite(input.yawOffset) || !Number.isFinite(input.pitchRatio)) {
        clearPending(); calibration = [];
        return { pose: focused(Boolean(baseline)), confirmed: false, reliable: false };
      }
      if (!baseline) {
        if (Math.abs(input.yawOffset) > 0.25 || input.pitchRatio < 0.15 || input.pitchRatio > 1.1) calibration = [];
        else calibration = [...calibration.slice(-7), input];
        if (calibration.length === 8) {
          const yaw = calibration.map(x => x.yawOffset), pitch = calibration.map(x => x.pitchRatio);
          if (Math.max(...yaw) - Math.min(...yaw) <= 0.1 && Math.max(...pitch) - Math.min(...pitch) <= 0.1) {
            baseline = { yawOffset: median(yaw), pitchRatio: median(pitch) };
          }
        }
        return { pose: focused(Boolean(baseline)), confirmed: false, reliable: true };
      }
      samples = [...samples.slice(-2), input];
      const yaw = median(samples.map(x => x.yawOffset)) - baseline.yawOffset;
      const pitch = median(samples.map(x => x.pitchRatio)) - baseline.pitchRatio;
      const pose: HeadPoseResult = { ...focused(true), normalizedYaw: yaw, normalizedPitch: pitch };
      if (yaw < -0.38) { pose.direction = "Looking Right ✗"; pose.violationReason = "looking_right"; }
      else if (yaw > DESKTOP_LEFT_YAW_DELTA_THRESHOLD) { pose.direction = "Looking Left ✗"; pose.violationReason = "looking_left"; }
      else if (pitch < -0.18) { pose.direction = "Looking Up ✗"; pose.violationReason = "looking_up"; }
      else if (pitch > DESKTOP_DOWN_PITCH_DELTA_THRESHOLD) { pose.direction = "Looking Down ✗"; pose.violationReason = "looking_down"; }
      if (!pose.violationReason) {
        candidate = ""; frames = 0;
        // Hysteresis: rearm only after two genuinely neutral observations.
        const centered = Math.abs(yaw) < 0.2 && Math.abs(pitch) < 0.12
          && (recordedReason !== "looking_down" || pitch < DESKTOP_DOWN_NEUTRAL_DELTA_THRESHOLD);
        neutralFrames = centered ? neutralFrames + 1 : 0;
        if (neutralFrames >= 2 && recorded) { recorded = false; recordedReason = ""; recordedGeneration++; }
      } else {
        neutralFrames = 0;
        if (candidate !== pose.violationReason) { candidate = pose.violationReason; since = now; frames = 1; }
        else frames++;
      }
      return { pose, confirmed: Boolean(candidate) && frames >= 3 && now - since >= 1200 && !recorded && !reportInFlight, reliable: true };
    },
  };
}
