import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DESKTOP_DEVICE_MODEL_URL, DESKTOP_DEVICE_MODEL_SHA256, getDesktopDeviceAssetPath } from "@/lib/desktop-device-model";

export const runtime = "nodejs";
let modelPromise: Promise<Uint8Array> | null = null;
function loadModel() {
  modelPromise ??= (async () => {
    const response = await fetch(DESKTOP_DEVICE_MODEL_URL, { cache: "no-store", signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!response.ok) throw new Error("Model fetch failed");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== DESKTOP_DEVICE_MODEL_SHA256) throw new Error("Model integrity failed");
    return bytes;
  })().catch(error => { modelPromise = null; throw error; });
  return modelPromise;
}
export async function GET(_request: Request, {params}: {params: Promise<{file:string}>}) {
  const {file} = await params;
  const asset = getDesktopDeviceAssetPath(file);
  if (file !== "model.tflite" && !asset) return Response.json({error:"Model file not found"},{status:404});
  try {
    const bytes = file === "model.tflite" ? await loadModel() : new Uint8Array(await readFile(asset!));
    return new Response(new Uint8Array(bytes).buffer, {headers:{
      "Content-Type": file.endsWith(".js") ? "text/javascript; charset=utf-8" : file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream",
      "Cache-Control": file === "worker.js" ? "no-cache" : "public, max-age=86400",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      // Media frames stay in the worker. Block third-party metrics as well.
      "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'self'; worker-src 'none'",
    }});
  } catch {
    return Response.json({error:"Device AI assets temporarily unavailable"},{status:502,headers:{"Cache-Control":"no-store"}});
  }
}
