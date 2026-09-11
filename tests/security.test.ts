import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { consumeRateLimit, consumeRateLimitGroup, hashOtp, isStrongPassword } from "../src/lib/security.ts";
import { verifyPayMongoSignature } from "../src/lib/paymongo.ts";
import { canStudentEnterQuiz } from "../src/lib/quiz-access.ts";
import {
  getAudioAnomalyThreshold,
  getAudioSignalLevel,
  getViolationLabel,
  getUnauthorizedDeviceConfidence,
  isScreenshotShortcut,
  VALID_VIOLATION_TYPES,
} from "../src/lib/proctoring-detection.ts";
import { getNotificationDestination } from "../src/lib/notification-destination.ts";
import { normalizeQuizAccessCode, QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH } from "../src/lib/quiz-access-code.ts";
import { hasVerifiedGoogleEmail } from "../src/lib/google-identity.ts";
import { getProctoringPerformanceProfile } from "../src/lib/device-capabilities.ts";
import {
  DEFAULT_TEACHER_WARNING,
  normalizeTeacherWarningMessage,
} from "../src/lib/live-warning-store.ts";

test("password policy rejects weak values", () => {
  assert.equal(isStrongPassword("short1"), false);
  assert.equal(isStrongPassword("onlyletterslong"), false);
  assert.equal(isStrongPassword("StrongPass123"), true);
});

test("OTP hashes are scoped by user and purpose", () => {
  process.env.NEXTAUTH_SECRET = "test-secret-that-is-longer-than-thirty-two-characters";
  const login = hashOtp("user-a", "123456", "login");
  assert.notEqual(login, "123456");
  assert.notEqual(login, hashOtp("user-b", "123456", "login"));
  assert.notEqual(login, hashOtp("user-a", "123456", "password-reset"));
});

test("Google authentication accepts only explicitly verified email identities", () => {
  assert.equal(hasVerifiedGoogleEmail({ email: "student@example.com", email_verified: true }), true);
  assert.equal(hasVerifiedGoogleEmail({ email: "student@example.com", email_verified: false }), false);
  assert.equal(hasVerifiedGoogleEmail({ email: "student@example.com" }), false);
  assert.equal(hasVerifiedGoogleEmail({ email: "", email_verified: true }), false);
  assert.equal(hasVerifiedGoogleEmail(null), false);
});

test("mobile proctoring uses a bounded low-power workload", () => {
  const mobile = getProctoringPerformanceProfile("mobile", {
    deviceMemory: 4,
    hardwareConcurrency: 4,
  });
  const desktop = getProctoringPerformanceProfile("desktop");

  assert.equal(mobile.lowPower, true);
  assert.equal(mobile.objectModelBase, "lite_mobilenet_v2");
  assert.equal(mobile.useTinyLandmarks, true);
  assert.ok(mobile.captureWidth < desktop.captureWidth);
  assert.ok(mobile.snapshotIntervalMs > desktop.snapshotIntervalMs);
  assert.ok(mobile.detectionIntervalMs > desktop.detectionIntervalMs);
});

test("teacher warnings are normalized and bounded before realtime delivery", () => {
  assert.equal(normalizeTeacherWarningMessage("  Keep   your face visible.  "), "Keep your face visible.");
  assert.equal(normalizeTeacherWarningMessage(""), DEFAULT_TEACHER_WARNING);
  assert.equal(normalizeTeacherWarningMessage("x".repeat(300)).length, 240);
});

test("students cannot enter until both teacher and enrollment are started", () => {
  const startTime = new Date();
  assert.equal(canStudentEnterQuiz({ quizStatus: "active", studentQuizStatus: "enrolled", startTime: null }), false);
  assert.equal(canStudentEnterQuiz({ quizStatus: "in_progress", studentQuizStatus: "enrolled", startTime }), false);
  assert.equal(canStudentEnterQuiz({ quizStatus: "in_progress", studentQuizStatus: "pending_approval", startTime }), false);
  assert.equal(canStudentEnterQuiz({ quizStatus: "in_progress", studentQuizStatus: "in_progress", startTime }), true);
  assert.equal(canStudentEnterQuiz({ quizStatus: "ended", studentQuizStatus: "in_progress", startTime }), true);
  assert.equal(canStudentEnterQuiz({ quizStatus: "ended", studentQuizStatus: "enrolled", startTime: null }), false);
  assert.equal(canStudentEnterQuiz({ quizStatus: "in_progress", studentQuizStatus: "in_progress", startTime, endTime: new Date() }), false);
});

test("current and legacy quiz codes survive mobile clipboard normalization", () => {
  const currentCode = "PS-1234567890";
  assert.ok(currentCode.length <= QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH);
  assert.equal(normalizeQuizAccessCode(currentCode), currentCode);
  assert.equal(normalizeQuizAccessCode(" ps\u2013 12345 67890\n"), currentCode);
  assert.equal(normalizeQuizAccessCode("ps-8430"), "PS-8430");
});

test("phone detection accepts repeated COCO phone labels at practical confidence", () => {
  assert.equal(getUnauthorizedDeviceConfidence([{ class: "cell phone", score: 0.14 }]), 0);
  assert.equal(getUnauthorizedDeviceConfidence([{ class: "cell phone", score: 0.19 }]), 0.19);
  assert.equal(getUnauthorizedDeviceConfidence([{ class: "cell phone", score: 0.29 }]), 0.29);
  assert.equal(getUnauthorizedDeviceConfidence([{ class: "cell phone", score: 0.61 }]), 0.61);
  assert.equal(getUnauthorizedDeviceConfidence([{ class: "remote", score: 0.34 }]), 0);
  assert.equal(getUnauthorizedDeviceConfidence([{ class: "remote", score: 0.44 }]), 0.44);
  assert.equal(getUnauthorizedDeviceConfidence([{ class: "remote", score: 0.54 }]), 0.54);
  assert.equal(getUnauthorizedDeviceConfidence([{ class: "remote", score: 0.72 }]), 0.72);
  assert.equal(getUnauthorizedDeviceConfidence([{ class: "tv", score: 0.52 }]), 0.52);
  assert.equal(getUnauthorizedDeviceConfidence([{ class: "laptop", score: 0.48 }]), 0.48);
});

test("audio monitoring converts PCM samples into a bounded adaptive signal", () => {
  assert.equal(getAudioSignalLevel(new Uint8Array(32).fill(128)), 0);
  assert.ok(getAudioSignalLevel(Uint8Array.from([64, 192, 64, 192])) > 50);
  assert.equal(getAudioAnomalyThreshold(0), 5);
  assert.ok(getAudioAnomalyThreshold(12) > getAudioAnomalyThreshold(2));
  assert.equal(getAudioAnomalyThreshold(100), 30);
  assert.equal(getAudioAnomalyThreshold(Number.NaN), 5);
  assert.equal(getViolationLabel("audio_anomaly"), "Sustained loud audio detected");
  assert.equal(getViolationLabel("tab_switch"), "App/tab switch or window minimized");
});

test("detectable operating-system screenshot shortcuts are recognized", () => {
  assert.equal(isScreenshotShortcut({ key: "PrintScreen" }), true);
  assert.equal(isScreenshotShortcut({ key: "4", metaKey: true, shiftKey: true }), true);
  assert.equal(isScreenshotShortcut({ key: "s", metaKey: true, shiftKey: true }), true);
  assert.equal(isScreenshotShortcut({ key: "s", ctrlKey: true }), false);
});

test("the violation API accepts every event emitted by the proctoring client", () => {
  for (const type of [
    "looking_left",
    "looking_right",
    "looking_up",
    "looking_down",
    "attempted_screenshot",
    "clipboard_attempt",
    "developer_tools",
    "camera_unavailable",
  ]) {
    assert.ok(VALID_VIOLATION_TYPES.includes(type as (typeof VALID_VIOLATION_TYPES)[number]));
  }
});

test("notification destinations are role-scoped and never use notification-provided URLs", () => {
  assert.equal(getNotificationDestination("student", "Quiz Completed"), "/dashboard/student/results");
  assert.equal(getNotificationDestination("student", "Retake Request Approved"), "/dashboard/student/quizzes");
  assert.equal(getNotificationDestination("teacher", "Retake Request Submitted"), "/dashboard/teacher/monitor");
  assert.equal(getNotificationDestination("teacher", "AI Verdict Issued"), "/dashboard/teacher/reports");
  assert.equal(getNotificationDestination("admin", "New Login"), "/dashboard/admin/users");
  assert.equal(getNotificationDestination("unknown", "javascript:alert(1)"), "/login");
});

test("PayMongo signatures require a valid HMAC and recent timestamp", () => {
  const nowMs = 1_800_000_000_000;
  const timestamp = String(nowMs / 1000);
  const body = JSON.stringify({ data: { id: "evt_test" } });
  const secret = "whsk_test_secret";
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  assert.equal(
    verifyPayMongoSignature(body, `t=${timestamp},te=${signature},li=`, secret, nowMs),
    "te"
  );
  assert.equal(
    verifyPayMongoSignature(`${body}x`, `t=${timestamp},te=${signature},li=`, secret, nowMs),
    null
  );
  assert.equal(
    verifyPayMongoSignature(body, `t=${Number(timestamp) - 301},te=${signature},li=`, secret, nowMs),
    null
  );
});

test("rate limiting rejects requests beyond the configured local limit", async () => {
  const key = `test:${crypto.randomUUID()}`;
  assert.equal((await consumeRateLimit(key, 2, 60_000)).allowed, true);
  assert.equal((await consumeRateLimit(key, 2, 60_000)).allowed, true);
  assert.equal((await consumeRateLimit(key, 2, 60_000)).allowed, false);
});

test("grouped rate limits protect an account independently of the IP key", async () => {
  const accountKey = `account:${crypto.randomUUID()}`;
  assert.equal((await consumeRateLimitGroup([accountKey, `ip:${crypto.randomUUID()}`], 1, 60_000)).allowed, true);
  assert.equal((await consumeRateLimitGroup([accountKey, `ip:${crypto.randomUUID()}`], 1, 60_000)).allowed, false);
});
