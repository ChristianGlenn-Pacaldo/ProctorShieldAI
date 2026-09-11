import assert from "node:assert/strict";
import test from "node:test";
import {
  getMonitoringLevel,
  isMobileUserAgent,
  normalizeDeviceCapabilities,
} from "../src/lib/device-capabilities.ts";

const completeCapabilities = {
  deviceType: "desktop",
  secureContext: true,
  cameraSupported: true,
  cameraPermission: true,
  microphoneSupported: true,
  microphonePermission: true,
  mediaRecorderSupported: true,
  fullscreenSupported: true,
  visibilitySupported: true,
  viewportWidth: 1440,
  viewportHeight: 900,
};

test("mobile devices receive reduced assurance even with all browser capabilities", () => {
  const capabilities = normalizeDeviceCapabilities(
    { ...completeCapabilities, deviceType: "mobile", viewportWidth: 390 },
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile",
  );
  assert.equal(capabilities.deviceType, "mobile");
  assert.equal(getMonitoringLevel(capabilities), "reduced");
});

test("capable desktop browsers receive strict monitoring", () => {
  const capabilities = normalizeDeviceCapabilities(completeCapabilities, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
  assert.equal(capabilities.deviceType, "desktop");
  assert.equal(getMonitoringLevel(capabilities), "strict");
});

test("insecure or camera-denied devices cannot begin proctoring", () => {
  const insecure = normalizeDeviceCapabilities({ ...completeCapabilities, secureContext: false });
  const denied = normalizeDeviceCapabilities({ ...completeCapabilities, cameraPermission: false });
  assert.equal(getMonitoringLevel(insecure), "unsupported");
  assert.equal(getMonitoringLevel(denied), "unsupported");
});

test("microphone permission and video recording are required for monitored quizzes", () => {
  const microphoneDenied = normalizeDeviceCapabilities({
    ...completeCapabilities,
    microphonePermission: false,
  });
  const recorderMissing = normalizeDeviceCapabilities({
    ...completeCapabilities,
    mediaRecorderSupported: false,
  });
  assert.equal(getMonitoringLevel(microphoneDenied), "unsupported");
  assert.equal(getMonitoringLevel(recorderMissing), "unsupported");
});

test("server user-agent detection prevents phones from claiming desktop mode", () => {
  assert.equal(isMobileUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile"), true);
  const capabilities = normalizeDeviceCapabilities(
    completeCapabilities,
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile",
  );
  assert.equal(capabilities.deviceType, "mobile");
});
