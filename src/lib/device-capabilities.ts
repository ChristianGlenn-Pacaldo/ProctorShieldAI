export const DEVICE_TYPES = ["desktop", "mobile"] as const;
export const MONITORING_LEVELS = ["strict", "reduced", "unsupported"] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];
export type MonitoringLevel = (typeof MONITORING_LEVELS)[number];

export interface DeviceCapabilities {
  deviceType: DeviceType;
  secureContext: boolean;
  cameraSupported: boolean;
  cameraPermission: boolean;
  microphoneSupported: boolean;
  microphonePermission: boolean;
  mediaRecorderSupported: boolean;
  fullscreenSupported: boolean;
  visibilitySupported: boolean;
  viewportWidth: number;
  viewportHeight: number;
}

export interface ProctoringPerformanceProfile {
  lowPower: boolean;
  captureWidth: number;
  captureHeight: number;
  frameRate: number;
  inferenceWidth: number;
  inferenceHeight: number;
  faceInputSize: 128 | 160;
  snapshotIntervalMs: number;
  detectionIntervalMs: number;
  audioIntervalMs: number;
  useTinyLandmarks: boolean;
  objectModelBase: "lite_mobilenet_v2" | "mobilenet_v2";
}

interface ProctoringPerformanceHints {
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

const MOBILE_USER_AGENT = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i;

function bool(value: unknown) {
  return value === true;
}

function boundedDimension(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(10_000, Math.round(number))) : 0;
}

export function isMobileUserAgent(userAgent: string) {
  return MOBILE_USER_AGENT.test(userAgent.toLowerCase());
}

export function normalizeDeviceCapabilities(
  value: unknown,
  userAgent = "",
): DeviceCapabilities {
  const input = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  const viewportWidth = boundedDimension(input.viewportWidth);
  const clientMobileHint = input.deviceType === "mobile" && viewportWidth > 0 && viewportWidth <= 1_200;
  const deviceType: DeviceType = isMobileUserAgent(userAgent) || clientMobileHint
    ? "mobile"
    : "desktop";

  return {
    deviceType,
    secureContext: bool(input.secureContext),
    cameraSupported: bool(input.cameraSupported),
    cameraPermission: bool(input.cameraPermission),
    microphoneSupported: bool(input.microphoneSupported),
    microphonePermission: bool(input.microphonePermission),
    mediaRecorderSupported: bool(input.mediaRecorderSupported),
    fullscreenSupported: bool(input.fullscreenSupported),
    visibilitySupported: bool(input.visibilitySupported),
    viewportWidth,
    viewportHeight: boundedDimension(input.viewportHeight),
  };
}

export function getMonitoringLevel(capabilities: DeviceCapabilities): MonitoringLevel {
  if (
    !capabilities.secureContext ||
    !capabilities.cameraSupported ||
    !capabilities.cameraPermission ||
    !capabilities.visibilitySupported
  ) {
    return "unsupported";
  }

  if (
    capabilities.deviceType === "desktop" &&
    capabilities.microphonePermission &&
    capabilities.mediaRecorderSupported &&
    capabilities.fullscreenSupported
  ) {
    return "strict";
  }

  return "reduced";
}

export function monitoringLabel(level: MonitoringLevel) {
  if (level === "strict") return "Strict Monitoring";
  if (level === "reduced") return "Reduced Assurance";
  return "Unsupported Device";
}

export function getProctoringPerformanceProfile(
  deviceType: DeviceType,
  hints: ProctoringPerformanceHints = {},
): ProctoringPerformanceProfile {
  if (deviceType === "desktop") {
    return {
      lowPower: false,
      captureWidth: 640,
      captureHeight: 480,
      frameRate: 24,
      inferenceWidth: 480,
      inferenceHeight: 360,
      faceInputSize: 160,
      snapshotIntervalMs: 2_000,
      detectionIntervalMs: 500,
      audioIntervalMs: 500,
      useTinyLandmarks: false,
      objectModelBase: "mobilenet_v2",
    };
  }

  const memory = Number(hints.deviceMemory);
  const cores = Number(hints.hardwareConcurrency);
  const lowPower = (Number.isFinite(memory) && memory > 0 && memory <= 4)
    || (Number.isFinite(cores) && cores > 0 && cores <= 4);

  return {
    lowPower,
    captureWidth: 320,
    captureHeight: 240,
    frameRate: lowPower ? 10 : 12,
    inferenceWidth: lowPower ? 224 : 256,
    inferenceHeight: lowPower ? 168 : 192,
    faceInputSize: 128,
    snapshotIntervalMs: lowPower ? 8_000 : 5_000,
    detectionIntervalMs: lowPower ? 2_800 : 1_800,
    audioIntervalMs: lowPower ? 1_500 : 1_000,
    useTinyLandmarks: true,
    objectModelBase: "lite_mobilenet_v2",
  };
}

export function getBrowserProctoringPerformanceProfile(deviceType: DeviceType) {
  const runtimeNavigator = typeof navigator === "undefined"
    ? undefined
    : navigator as Navigator & { deviceMemory?: number };

  return getProctoringPerformanceProfile(deviceType, {
    deviceMemory: runtimeNavigator?.deviceMemory,
    hardwareConcurrency: runtimeNavigator?.hardwareConcurrency,
  });
}

export function getBrowserDeviceCapabilities(): DeviceCapabilities {
  const hasWindow = typeof window !== "undefined";
  const hasNavigator = typeof navigator !== "undefined";
  const userAgent = hasNavigator ? navigator.userAgent : "";
  const viewportWidth = hasWindow ? window.innerWidth : 0;
  const deviceType: DeviceType = isMobileUserAgent(userAgent) || (viewportWidth > 0 && viewportWidth < 768)
    ? "mobile"
    : "desktop";
  const cameraSupported = Boolean(
    hasNavigator && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function",
  );

  return {
    deviceType,
    secureContext: hasWindow ? window.isSecureContext : false,
    cameraSupported,
    cameraPermission: false,
    microphoneSupported: cameraSupported,
    microphonePermission: false,
    mediaRecorderSupported: typeof MediaRecorder !== "undefined",
    fullscreenSupported: typeof document !== "undefined" && Boolean(document.fullscreenEnabled),
    visibilitySupported: typeof document !== "undefined" && "hidden" in document,
    viewportWidth,
    viewportHeight: hasWindow ? window.innerHeight : 0,
  };
}
