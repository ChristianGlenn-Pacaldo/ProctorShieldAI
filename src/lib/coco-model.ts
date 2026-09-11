const COCO_MODEL_ORIGIN = "https://storage.googleapis.com";
const COCO_MODEL_PATH = "/tfjs-models/savedmodel/ssdlite_mobilenet_v2";

const allowedFiles = new Set([
  "model.json",
  "group1-shard1of5",
  "group1-shard2of5",
  "group1-shard3of5",
  "group1-shard4of5",
  "group1-shard5of5",
]);

export const COCO_MODEL_BROWSER_URL = "/api/models/coco/model.json";

export function getCocoModelUpstreamUrl(file: string): string | null {
  if (!allowedFiles.has(file)) return null;
  return `${COCO_MODEL_ORIGIN}${COCO_MODEL_PATH}/${file}`;
}
