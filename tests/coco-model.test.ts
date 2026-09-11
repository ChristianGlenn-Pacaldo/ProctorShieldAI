import test from "node:test";
import assert from "node:assert/strict";
import { getCocoModelUpstreamUrl } from "../src/lib/coco-model.ts";

test("COCO model proxy only permits the fixed official model files", () => {
  assert.match(getCocoModelUpstreamUrl("model.json") || "", /^https:\/\/storage\.googleapis\.com\//);
  assert.match(getCocoModelUpstreamUrl("group1-shard5of5") || "", /group1-shard5of5$/);
  assert.equal(getCocoModelUpstreamUrl("../model.json"), null);
  assert.equal(getCocoModelUpstreamUrl("untrusted.bin"), null);
});
