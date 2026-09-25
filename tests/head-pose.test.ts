import assert from "node:assert/strict";
import test from "node:test";
import { advanceMobileHeadPoseCalibration, advanceMobileNoFaceRecovery, classifyHeadPose, confirmMobileFaceMissing, detectMobileFacesWithFallback, getHeadPoseRadarPosition, getMobileInferenceDimensions, isTransientMobileFaceLoss, MOBILE_FACE_REACQUIRE_GRACE_MS, MOBILE_NO_FACE_RECOVERY_FRAMES } from "../src/lib/head-pose.ts";

const mobileBaseline = { yawOffset: 0.18, pitchRatio: 0.48 };

test("mobile face fallback recovers a tracked down pose when the fast scan misses", async () => {
  const calls: [number, number][] = [];
  const recovered = await detectMobileFacesWithFallback(true, 128, async (inputSize, scoreThreshold) => {
    calls.push([inputSize, scoreThreshold]);
    return inputSize === 224 ? [{ pitchRatio: 0.606 }] : [];
  });
  assert.deepEqual(calls, [[128, 0.5], [224, 0.4]]);
  assert.deepEqual(recovered, [{ pitchRatio: 0.606 }]);
});

test("mobile fallback retains genuine absence and does not run after a primary face match", async () => {
  const absent = await detectMobileFacesWithFallback(true, 128, async () => []);
  assert.deepEqual(absent, []);
  let calls = 0;
  const primary = await detectMobileFacesWithFallback(true, 128, async () => {
    calls++;
    return [{ id: 1 }];
  });
  assert.deepEqual(primary, [{ id: 1 }]);
  assert.equal(calls, 1);
});

test("desktop face detection keeps its single existing scan", async () => {
  let calls = 0;
  assert.deepEqual(await detectMobileFacesWithFallback(false, 160, async () => {
    calls++;
    return [];
  }), []);
  assert.equal(calls, 1);
});

test("mobile inference preserves portrait and landscape camera geometry without upscaling", () => {
  assert.deepEqual(getMobileInferenceDimensions(240, 320, 256, 192), { width: 192, height: 256 });
  assert.deepEqual(getMobileInferenceDimensions(320, 240, 256, 192), { width: 256, height: 192 });
  assert.deepEqual(getMobileInferenceDimensions(1080, 1920, 256, 192), { width: 144, height: 256 });
  assert.deepEqual(getMobileInferenceDimensions(120, 160, 256, 192), { width: 120, height: 160 });
});

test("mobile head pose uses the student's calibrated neutral position", () => {
  assert.equal(classifyHeadPose(0.18, 0.48, { mobile: true, baseline: mobileBaseline }).direction, "Focused ✓");
  assert.equal(classifyHeadPose(0.4, 0.48, { mobile: true, baseline: mobileBaseline }).violationReason, "looking_left");
  assert.equal(classifyHeadPose(-0.04, 0.48, { mobile: true, baseline: mobileBaseline }).violationReason, "looking_right");
  assert.equal(classifyHeadPose(0.18, 0.28, { mobile: true, baseline: mobileBaseline }).violationReason, "looking_up");
  assert.equal(classifyHeadPose(0.18, 0.68, { mobile: true, baseline: mobileBaseline }).violationReason, "looking_down");
});

test("mobile down tilt crosses the measured phone threshold without classifying neutral jitter", () => {
  assert.equal(classifyHeadPose(0.18, 0.56, { mobile: true, baseline: mobileBaseline }).direction, "Focused ✓");
  assert.equal(classifyHeadPose(0.212, 0.575, { mobile: true, baseline: mobileBaseline }).direction, "Looking Down ✗");
  assert.equal(classifyHeadPose(0.18, 0.606, { mobile: true, baseline: mobileBaseline }).direction, "Looking Down ✗");
  assert.equal(classifyHeadPose(0.18, 0.33, { mobile: true, baseline: mobileBaseline }).direction, "Focused ✓");
  assert.equal(classifyHeadPose(0.18, 0.30, { mobile: true, baseline: mobileBaseline }).direction, "Looking Up ✗");
});

test("gentle horizontal turns do not become a down warning before the yaw threshold", () => {
  assert.equal(classifyHeadPose(0.31, 0.60, { mobile: true, baseline: mobileBaseline }).direction, "Focused ✓");
  assert.equal(classifyHeadPose(0.05, 0.60, { mobile: true, baseline: mobileBaseline }).direction, "Focused ✓");
  assert.equal(classifyHeadPose(0.18, 0.606, { mobile: true, baseline: mobileBaseline }).violationReason, "looking_down");
  assert.equal(classifyHeadPose(0.27, 0.68, { mobile: true, baseline: mobileBaseline }).violationReason, "looking_down");
  assert.equal(classifyHeadPose(0.40, 0.68, { mobile: true, baseline: mobileBaseline }).violationReason, "looking_left");
});

test("mobile head pose does not issue an absolute-threshold violation before calibration", () => {
  const pose = classifyHeadPose(0.44, 1.14, { mobile: true });
  assert.equal(pose.calibrated, false);
  assert.equal(pose.violationReason, "");
  assert.deepEqual(getHeadPoseRadarPosition(pose, true), { x: 50, y: 50 });
});

test("uncalibrated mobile poses cannot cause a head-pose strike", () => {
  for (const [yawOffset, pitchRatio] of [[0.7, 0.48], [-0.7, 0.48], [0, 1.5], [0, -0.2]]) {
    const pose = classifyHeadPose(yawOffset, pitchRatio, { mobile: true });
    assert.equal(pose.calibrated, false);
    assert.equal(pose.violationReason, "");
  }
});

test("mobile calibration requires eight stable, finite, plausible face samples", () => {
  let samples: { yawOffset: number; pitchRatio: number }[] = [];
  for (let index = 0; index < 7; index++) {
    const result = advanceMobileHeadPoseCalibration(samples, 0.18 + index * 0.002, 0.48);
    samples = result.samples;
    assert.equal(result.baseline, null);
  }
  const ready = advanceMobileHeadPoseCalibration(samples, 0.18, 0.48);
  assert.equal(ready.samples.length, 8);
  assert.ok(ready.baseline);
  assert.equal(classifyHeadPose(0.18, 0.48, { mobile: true, baseline: ready.baseline }).calibrated, true);

  assert.deepEqual(advanceMobileHeadPoseCalibration(samples, 0.9, 0.48), { samples: [], baseline: null });
  assert.deepEqual(advanceMobileHeadPoseCalibration(samples, NaN, 0.48), { samples: [], baseline: null });
  assert.equal(advanceMobileHeadPoseCalibration([], 0.18, 0.48).baseline, null);
});

test("neutral mobile camera geometry and calibration jitter do not cause a strike", () => {
  let samples: { yawOffset: number; pitchRatio: number }[] = [];
  for (let index = 0; index < 8; index++) {
    const result = advanceMobileHeadPoseCalibration(samples, 0.18, index % 2 === 0 ? 1.4 : 1.54);
    samples = result.samples;
    if (index === 7) {
      assert.ok(result.baseline);
      assert.equal(classifyHeadPose(0.18, 1.54, { mobile: true, baseline: result.baseline }).violationReason, "");
      assert.equal(classifyHeadPose(0.18, 1.4, { mobile: true, baseline: result.baseline }).violationReason, "");
    }
  }
});

test("desktop head pose retains the existing absolute thresholds", () => {
  assert.equal(classifyHeadPose(-0.39, 0.55, { mobile: false }).violationReason, "looking_right");
  assert.equal(classifyHeadPose(0.39, 0.55, { mobile: false }).violationReason, "looking_left");
  assert.equal(classifyHeadPose(0, 0.14, { mobile: false }).violationReason, "looking_up");
  assert.equal(classifyHeadPose(0, 1.11, { mobile: false }).violationReason, "looking_down");
});

test("mobile radar is centered on the calibrated neutral pose", () => {
  const centered = classifyHeadPose(0.18, 0.48, { mobile: true, baseline: mobileBaseline });
  assert.deepEqual(getHeadPoseRadarPosition(centered, true), { x: 50, y: 50 });
  assert.ok(getHeadPoseRadarPosition(classifyHeadPose(0.18, 0.28, { mobile: true, baseline: mobileBaseline }), true).y < 50);
  assert.ok(getHeadPoseRadarPosition(classifyHeadPose(0.18, 0.68, { mobile: true, baseline: mobileBaseline }), true).y > 50);
});

test("brief mobile detector loss after a tracked head turn is reacquisition, not no-face evidence", () => {
  const firstMissingAt = 1_000;
  for (const elapsed of [0, 1_100, 2_200, MOBILE_FACE_REACQUIRE_GRACE_MS - 1]) {
    assert.equal(isTransientMobileFaceLoss(0, firstMissingAt, firstMissingAt + elapsed), true);
  }
  assert.equal(isTransientMobileFaceLoss(0, firstMissingAt, firstMissingAt + MOBILE_FACE_REACQUIRE_GRACE_MS), false);
});

test("sustained genuine absence and a camera with no tracked face are not exempt", () => {
  const firstMissingAt = 1_000;
  assert.equal(isTransientMobileFaceLoss(null, firstMissingAt, firstMissingAt), false);
  assert.equal(isTransientMobileFaceLoss(-10_000, firstMissingAt, firstMissingAt), false);
  assert.equal(isTransientMobileFaceLoss(0, firstMissingAt, firstMissingAt - 1), false);
  assert.equal(isTransientMobileFaceLoss(0, firstMissingAt, firstMissingAt + 12_000), false);
  let confirmedFrames = 0;
  for (const elapsed of [4_000, 6_200, 8_400, 10_600]) {
    if (!isTransientMobileFaceLoss(0, firstMissingAt, firstMissingAt + elapsed)) confirmedFrames++;
  }
  assert.equal(confirmedFrames, 4);
});

test("one covered-camera absence cannot rearm a second no-face strike on intermittent detections", () => {
  let recoveryFrames = 0;
  for (let index = 0; index < 40; index++) {
    recoveryFrames = advanceMobileNoFaceRecovery(recoveryFrames, index % 3 !== 0);
    assert.ok(recoveryFrames < MOBILE_NO_FACE_RECOVERY_FRAMES);
  }
  assert.equal(advanceMobileNoFaceRecovery(recoveryFrames, false), 0);
});

test("a sustained focused return rearms a distinct later no-face incident", () => {
  let recoveryFrames = 0;
  for (let index = 0; index < MOBILE_NO_FACE_RECOVERY_FRAMES - 1; index++) {
    recoveryFrames = advanceMobileNoFaceRecovery(recoveryFrames, true);
    assert.ok(recoveryFrames < MOBILE_NO_FACE_RECOVERY_FRAMES);
  }
  recoveryFrames = advanceMobileNoFaceRecovery(recoveryFrames, true);
  assert.equal(recoveryFrames, MOBILE_NO_FACE_RECOVERY_FRAMES);
  assert.equal(advanceMobileNoFaceRecovery(recoveryFrames, true), MOBILE_NO_FACE_RECOVERY_FRAMES);
});

test("mobile no-face candidate is vetoed when a stronger scan finds the centered face", async () => {
  assert.equal(await confirmMobileFaceMissing(async (inputSize, scoreThreshold) => {
    assert.equal(inputSize, 224);
    assert.equal(scoreThreshold, 0.4);
    return 1;
  }), false);
});

test("mobile no-face candidate remains valid when the stronger scan also finds no face", async () => {
  let scans = 0;
  assert.equal(await confirmMobileFaceMissing(async () => {
    scans++;
    return 0;
  }), true);
  assert.equal(scans, 2);
});

test("mobile no-face candidate is vetoed when a fresh recovery scan sees the face", async () => {
  let scans = 0;
  assert.equal(await confirmMobileFaceMissing(async () => ++scans === 2 ? 1 : 0), false);
  assert.equal(scans, 2);
});
