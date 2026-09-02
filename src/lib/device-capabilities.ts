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
