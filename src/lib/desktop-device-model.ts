export const DESKTOP_DEVICE_ASSET_PREFIX = "/api/models/device/";
export const DESKTOP_DEVICE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite";
export const DESKTOP_DEVICE_MODEL_SHA256 = "b3f50554cb0ea559e90328845f7d9ba4d13c8bff372914d24e06bc8bb72fa896";

// No request-controlled paths or URLs enter the filesystem or model fetch.
const files = new Map<string, string>([
  ["worker.js", "public/desktop-device-worker.js"],
  ["vision_bundle.js", "node_modules/@mediapipe/tasks-vision/vision_bundle.js"],
]);
for (const name of ["vision_wasm_internal", "vision_wasm_nosimd_internal", "vision_wasm_module_internal"]) {
  for (const extension of ["js", "wasm"]) files.set(`${name}.${extension}`, `node_modules/@mediapipe/tasks-vision/wasm/${name}.${extension}`);
}
for (const file of ["tfjs-backend-wasm.wasm", "tfjs-backend-wasm-simd.wasm", "tfjs-backend-wasm-threaded-simd.wasm"]) {
  files.set(file, `node_modules/@tensorflow/tfjs-backend-wasm/dist/${file}`);
}
export function getDesktopDeviceAssetPath(file: string) { return files.get(file) ?? null; }
