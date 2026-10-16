import type { ObjectPrediction } from "./proctoring-detection";
import { DESKTOP_DEVICE_ASSET_PREFIX } from "./desktop-device-model.ts";

type WorkerHandle = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror">;
type Options = {
  createWorker?: () => WorkerHandle;
  createFrame?: (video: HTMLVideoElement) => Promise<ImageBitmap>;
  loadTimeoutMs?: number;
  scanTimeoutMs?: number;
};
type ErrorCode = "STOPPED" | "BUSY" | "LOAD_TIMEOUT" | "SCAN_TIMEOUT" |
  "FRAME_CAPTURE_FAILED" | "WORKER_ERROR" | "WORKER_PROTOCOL_ERROR" |
  "MODEL_LOAD_FAILED" | "INFERENCE_FAILED" | "POST_MESSAGE_FAILED";

// Stable categories support diagnostics without retaining frames or raw errors.
export class DesktopDeviceError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "DesktopDeviceError";
    this.code = code;
  }
}

function isPredictions(value: unknown): value is ObjectPrediction[] {
  return Array.isArray(value) && value.every(prediction =>
    prediction !== null && typeof prediction === "object" &&
    typeof prediction.class === "string" && prediction.class.trim().length > 0 &&
    Number.isFinite(prediction.score) && prediction.score >= 0 && prediction.score <= 1);
}

export function createDesktopDeviceWorker(options: Options = {}) {
  const worker = options.createWorker?.() ?? new Worker(DESKTOP_DEVICE_ASSET_PREFIX + "worker.js");
  let terminalError: DesktopDeviceError | null = null;
  let busy = false, sequence = 0;
  let pending: {
    id: number; type: "load" | "detect";
    resolve: (value: ObjectPrediction[]) => void; reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  function stop(error: DesktopDeviceError) {
    if (terminalError) return;
    terminalError = error;
    const item = pending;
    pending = null;
    if (item) { clearTimeout(item.timer); item.reject(error); }
    worker.terminate();
  }
  function dispose() {
    stop(new DesktopDeviceError("STOPPED", "Desktop device AI stopped"));
  }
  function request(type: "load" | "detect", video?: HTMLVideoElement): Promise<ObjectPrediction[]> {
    return new Promise((resolve, reject) => {
      if (terminalError) { reject(terminalError); return; }
      const id = ++sequence;
      // One deadline covers both frame preparation and worker inference.
      const timer = setTimeout(() => stop(new DesktopDeviceError(
        type === "load" ? "LOAD_TIMEOUT" : "SCAN_TIMEOUT",
        "Desktop device AI stopped after timing out",
      )), type === "load" ? (options.loadTimeoutMs ?? 60_000) : (options.scanTimeoutMs ?? 10_000));
      const item = { id, type, resolve, reject, timer };
      pending = item;
      const send = (frame?: ImageBitmap) => {
        if (terminalError || pending !== item) { frame?.close(); return; }
        try { worker.postMessage({ id, type, frame }, frame ? [frame] : []); }
        catch {
          frame?.close();
          stop(new DesktopDeviceError("POST_MESSAGE_FAILED", "Desktop device AI could not receive a request"));
        }
      };
      if (type === "load") { send(); return; }
      try {
        (options.createFrame ?? createImageBitmap)(video!).then(send, () => {
          if (pending === item) stop(new DesktopDeviceError("FRAME_CAPTURE_FAILED", "Desktop device AI could not prepare a frame"));
        });
      } catch {
        stop(new DesktopDeviceError("FRAME_CAPTURE_FAILED", "Desktop device AI could not prepare a frame"));
      }
    });
  }
  worker.onmessage = ({ data }) => {
    if (!pending || !data || data.id !== pending.id) return;
    const item = pending;
    if (data.error) {
      stop(new DesktopDeviceError(item.type === "load" ? "MODEL_LOAD_FAILED" : "INFERENCE_FAILED", "Desktop device AI failed"));
      return;
    }
    if (item.type === "load" ? data.loaded !== true : !isPredictions(data.predictions)) {
      stop(new DesktopDeviceError("WORKER_PROTOCOL_ERROR", "Desktop device AI returned an invalid response"));
      return;
    }
    pending = null;
    clearTimeout(item.timer);
    item.resolve(item.type === "load" ? [] : data.predictions);
  };
  worker.onerror = () => stop(new DesktopDeviceError("WORKER_ERROR", "Desktop device AI worker failed"));
  const ready = request("load");
  void ready.catch(() => {});
  return {
    ready, dispose,
    async detect(video: HTMLVideoElement) {
      if (busy) throw new DesktopDeviceError("BUSY", "Desktop device AI already scanning");
      busy = true;
      try {
        await ready;
        return await request("detect", video);
      } finally { busy = false; }
    },
  };
}

// A cold private window has no cached WASM/model assets. A single transient
// download or inference failure must not disable device checks for the exam.
type DeviceRuntimeStatus = "loading" | "retrying" | "ready" | "unavailable";
export function createRecoveringDesktopDeviceWorker(options: {
  createDetector?: () => ReturnType<typeof createDesktopDeviceWorker>;
  onStatus?: (status: DeviceRuntimeStatus) => void;
  retryDelayMs?: number;
} = {}) {
  let detector: ReturnType<typeof createDesktopDeviceWorker> | null = null;
  let disposed = false;
  let cancelDelay: (() => void) | null = null;
  let lastStatus: DeviceRuntimeStatus | null = null;
  const status = (value: DeviceRuntimeStatus) => {
    if (!disposed && lastStatus !== value) {
      lastStatus = value;
      options.onStatus?.(value);
    }
  };
  async function recover<T>(operation: (worker: ReturnType<typeof createDesktopDeviceWorker>) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (disposed) throw new DesktopDeviceError("STOPPED", "Desktop device AI stopped");
      try {
        detector ??= (options.createDetector ?? createDesktopDeviceWorker)();
        await detector.ready;
        const value = await operation(detector);
        if (disposed) throw new DesktopDeviceError("STOPPED", "Desktop device AI stopped");
        status("ready");
        return value;
      } catch (error) {
        detector?.dispose(); detector = null;
        if (disposed) throw new DesktopDeviceError("STOPPED", "Desktop device AI stopped");
        if (attempt >= 2) { status("unavailable"); throw error; }
        status("retrying");
        await new Promise<void>(resolve => {
          const timer = setTimeout(done, (options.retryDelayMs ?? 2_000) * (attempt + 1));
          function done() { clearTimeout(timer); cancelDelay = null; resolve(); }
          cancelDelay = done;
        });
      }
    }
  }
  status("loading");
  const ready = recover(async () => {});
  void ready.catch(() => {});
  return {
    ready,
    async detect(video: HTMLVideoElement) {
      await ready;
      return recover(worker => worker.detect(video));
    },
    dispose() {
      disposed = true;
      cancelDelay?.();
      detector?.dispose(); detector = null;
    },
  };
}
