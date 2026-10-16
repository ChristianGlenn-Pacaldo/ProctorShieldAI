import type * as TensorFlow from "@tensorflow/tfjs-core";

// Avoid WebGL shader compilation and shared-GPU contention on older laptops.
// Single-thread SIMD WASM leaves CPU room for camera encoding and the UI.
export async function initializeProctoringFaceRuntime(tf: typeof TensorFlow, lowPower: boolean) {
  tf.enableProdMode();
  if (lowPower) {
    try {
      const wasm = await import("@tensorflow/tfjs-backend-wasm");
      tf.env().set("WASM_HAS_MULTITHREAD_SUPPORT", false);
      wasm.setThreadsCount(1);
      wasm.setWasmPaths("/api/models/device/");
      if (!await tf.setBackend("wasm")) throw new Error("WASM backend unavailable");
    } catch {
      // A missing WASM asset should not send the laptop back to its GPU driver.
      await tf.setBackend("cpu");
    }
  }
  await tf.ready();
}
