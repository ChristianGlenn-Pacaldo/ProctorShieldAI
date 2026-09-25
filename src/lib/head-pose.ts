export interface HeadPoseBaseline {
  yawOffset: number;
  pitchRatio: number;
}

export interface HeadPoseResult {
  direction: "Focused ✓" | "Looking Right ✗" | "Looking Left ✗" | "Looking Up ✗" | "Looking Down ✗";
  violationReason: "" | "looking_right" | "looking_left" | "looking_up" | "looking_down";
  normalizedYaw: number;
  normalizedPitch: number;
  calibrated: boolean;
}

const MOBILE_YAW_DELTA_THRESHOLD = 0.2;
const MOBILE_UP_PITCH_DELTA_THRESHOLD = 0.16;
const MOBILE_DOWN_PITCH_DELTA_THRESHOLD = 0.085;
const MOBILE_DOWN_YAW_DOMINANCE_RATIO = 1.5;
const MOBILE_CALIBRATION_SAMPLE_COUNT = 8;
const MOBILE_CALIBRATION_MAX_YAW = 0.85;
const MOBILE_CALIBRATION_MIN_PITCH = -0.25;
const MOBILE_CALIBRATION_MAX_PITCH = 1.75;
export const MOBILE_FACE_REACQUIRE_GRACE_MS = 4_000;
export const MOBILE_NO_FACE_RECOVERY_FRAMES = 8;
const MOBILE_RECENT_FACE_WINDOW_MS = 6_000;
const MOBILE_FALLBACK_FACE_INPUT_SIZE = 224;
const MOBILE_FALLBACK_FACE_SCORE_THRESHOLD = 0.4;

export async function detectMobileFacesWithFallback<Detection>(
  mobile: boolean,
  primaryInputSize: number,
  detectFaces: (inputSize: number, scoreThreshold: number) => Promise<Detection[]>,
) {
  const primary = await detectFaces(primaryInputSize, 0.5);
  if (!mobile || primary.length > 0) return primary;
  return detectFaces(MOBILE_FALLBACK_FACE_INPUT_SIZE, MOBILE_FALLBACK_FACE_SCORE_THRESHOLD);
}

export function getMobileInferenceDimensions(
  videoWidth: number,
  videoHeight: number,
  landscapeWidth: number,
  landscapeHeight: number,
) {
  const portrait = videoHeight > videoWidth;
  const maxWidth = portrait ? landscapeHeight : landscapeWidth;
  const maxHeight = portrait ? landscapeWidth : landscapeHeight;
  const scale = Math.min(1, maxWidth / videoWidth, maxHeight / videoHeight);
  return {
    width: Math.max(1, Math.round(videoWidth * scale)),
    height: Math.max(1, Math.round(videoHeight * scale)),
  };
}

export function advanceMobileNoFaceRecovery(recoveryFrames: number, focused: boolean) {
  return focused ? Math.min(recoveryFrames + 1, MOBILE_NO_FACE_RECOVERY_FRAMES) : 0;
}

export async function confirmMobileFaceMissing(
  detectFaceCount: (inputSize: number, scoreThreshold: number) => Promise<number>,
) {
  if (await detectFaceCount(MOBILE_FALLBACK_FACE_INPUT_SIZE, MOBILE_FALLBACK_FACE_SCORE_THRESHOLD) > 0) return false;
  await new Promise((resolve) => setTimeout(resolve, 250));
  return (await detectFaceCount(MOBILE_FALLBACK_FACE_INPUT_SIZE, MOBILE_FALLBACK_FACE_SCORE_THRESHOLD)) === 0;
}

export function isTransientMobileFaceLoss(
  lastFaceSeenAt: number | null,
  firstMissingAt: number,
  now: number,
) {
  return lastFaceSeenAt !== null
    && firstMissingAt >= lastFaceSeenAt
    && firstMissingAt - lastFaceSeenAt <= MOBILE_RECENT_FACE_WINDOW_MS
    && now >= firstMissingAt
    && now - firstMissingAt < MOBILE_FACE_REACQUIRE_GRACE_MS;
}

export function advanceMobileHeadPoseCalibration(
  samples: HeadPoseBaseline[],
  yawOffset: number,
  pitchRatio: number,
): { samples: HeadPoseBaseline[]; baseline: HeadPoseBaseline | null } {
  if (!Number.isFinite(yawOffset) || !Number.isFinite(pitchRatio)
    || Math.abs(yawOffset) > MOBILE_CALIBRATION_MAX_YAW
    || pitchRatio < MOBILE_CALIBRATION_MIN_PITCH
    || pitchRatio > MOBILE_CALIBRATION_MAX_PITCH) {
    return { samples: [], baseline: null };
  }

  const nextSamples = [...samples.slice(1 - MOBILE_CALIBRATION_SAMPLE_COUNT), { yawOffset, pitchRatio }];
  if (nextSamples.length < MOBILE_CALIBRATION_SAMPLE_COUNT) {
    return { samples: nextSamples, baseline: null };
  }

  const yawValues = nextSamples.map((sample) => sample.yawOffset).sort((a, b) => a - b);
  const pitchValues = nextSamples.map((sample) => sample.pitchRatio).sort((a, b) => a - b);
  if (yawValues[7] - yawValues[0] > 0.16 + 1e-9 || pitchValues[7] - pitchValues[0] > 0.14 + 1e-9) {
    return { samples: nextSamples.slice(1), baseline: null };
  }

  return {
    samples: nextSamples,
    baseline: {
      yawOffset: (yawValues[3] + yawValues[4]) / 2,
      pitchRatio: (pitchValues[3] + pitchValues[4]) / 2,
    },
  };
}

export function classifyHeadPose(
  yawOffset: number,
  pitchRatio: number,
  options: { mobile: boolean; baseline?: HeadPoseBaseline },
): HeadPoseResult {
  if (options.mobile && !options.baseline) {
    return { direction: "Focused ✓", violationReason: "", normalizedYaw: 0, normalizedPitch: 0, calibrated: false };
  }

  const normalizedYaw = options.mobile && options.baseline
    ? yawOffset - options.baseline.yawOffset
    : yawOffset;
  const normalizedPitch = options.mobile && options.baseline
    ? pitchRatio - options.baseline.pitchRatio
    : pitchRatio;

  if (options.mobile && options.baseline) {
    if (normalizedYaw < -MOBILE_YAW_DELTA_THRESHOLD) {
      return { direction: "Looking Right ✗", violationReason: "looking_right", normalizedYaw, normalizedPitch, calibrated: true };
    }
    if (normalizedYaw > MOBILE_YAW_DELTA_THRESHOLD) {
      return { direction: "Looking Left ✗", violationReason: "looking_left", normalizedYaw, normalizedPitch, calibrated: true };
    }
    if (normalizedPitch < -MOBILE_UP_PITCH_DELTA_THRESHOLD) {
      return { direction: "Looking Up ✗", violationReason: "looking_up", normalizedYaw, normalizedPitch, calibrated: true };
    }
    if (normalizedPitch > MOBILE_DOWN_PITCH_DELTA_THRESHOLD
      && normalizedPitch > Math.abs(normalizedYaw) * MOBILE_DOWN_YAW_DOMINANCE_RATIO) {
      return { direction: "Looking Down ✗", violationReason: "looking_down", normalizedYaw, normalizedPitch, calibrated: true };
    }
  } else {
    if (yawOffset < -0.38) {
      return { direction: "Looking Right ✗", violationReason: "looking_right", normalizedYaw, normalizedPitch, calibrated: true };
    }
    if (yawOffset > 0.38) {
      return { direction: "Looking Left ✗", violationReason: "looking_left", normalizedYaw, normalizedPitch, calibrated: true };
    }
    if (pitchRatio < 0.15) {
      return { direction: "Looking Up ✗", violationReason: "looking_up", normalizedYaw, normalizedPitch, calibrated: true };
    }
    if (pitchRatio > 1.1) {
      return { direction: "Looking Down ✗", violationReason: "looking_down", normalizedYaw, normalizedPitch, calibrated: true };
    }
  }

  return { direction: "Focused ✓", violationReason: "", normalizedYaw, normalizedPitch, calibrated: true };
}

export function getHeadPoseRadarPosition(result: HeadPoseResult, mobile: boolean) {
  const xScale = mobile ? 250 : 100;
  const yScale = mobile ? 250 : 80;
  const yCenter = mobile ? 50 : 50 - (0.55 * yScale);
  return {
    x: Math.max(15, Math.min(85, 50 - (result.normalizedYaw * xScale))),
    y: Math.max(15, Math.min(85, yCenter + (result.normalizedPitch * yScale))),
  };
}
