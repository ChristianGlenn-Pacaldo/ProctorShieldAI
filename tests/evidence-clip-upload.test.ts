import assert from "node:assert/strict";
import test from "node:test";
import { uploadEvidenceClip } from "../src/lib/evidence-clip-upload.ts";

const clip = { blob: new Blob(["original-turn-and-return"], { type: "video/webm" }), durationMs: 3_800, extension: "webm" as const };

for (const failure of ["network", "timeout-response", "storage"] as const) {
  test(`a ${failure} failure retries the same incident and original video`, async () => {
    const requests: Array<{ url: string; duration: string; bytes: string }> = [];
    const request: typeof fetch = async (url, init) => {
      const form = init!.body as FormData;
      requests.push({ url: String(url), duration: String(form.get("durationMs")), bytes: await (form.get("evidence") as File).text() });
      if (requests.length === 1) {
        if (failure === "network") throw new TypeError("connection lost");
        return Response.json({ error: "temporary" }, { status: failure === "storage" ? 503 : 408 });
      }
      return Response.json({ success: true });
    };
    assert.equal(await uploadEvidenceClip("105", clip, request), true);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(requests[0].bytes, "original-turn-and-return");
    assert.equal(requests[0].duration, "3800");
  });
}

test("authorization, validation and rate-limit failures are not retried", async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    let calls = 0;
    assert.equal(await uploadEvidenceClip("105", clip, async () => { calls++; return Response.json({ error: "rejected" }, { status }); }), false);
    assert.equal(calls, 1);
  }
});

test("permanent failure is reported after two attempts and invalid ids never upload", async () => {
  let calls = 0;
  const request: typeof fetch = async () => { calls++; throw Error("offline"); };
  assert.equal(await uploadEvidenceClip("105", clip, request), false);
  assert.equal(calls, 2);
  assert.equal(await uploadEvidenceClip("../105", clip, request), false);
  assert.equal(calls, 2);
});
