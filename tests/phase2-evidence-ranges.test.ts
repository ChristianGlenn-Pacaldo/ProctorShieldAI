import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture(options: { role?: string | null; owner?: string; pro?: boolean; size?: number; inline?: boolean; contentType?: string; missing?: boolean; expired?: boolean; offline?: boolean } = {}) {
  const bytes = Uint8Array.from({ length: options.size ?? 1000 }, (_, i) => i % 251);
  const contentType = options.contentType ?? "video/mp4";
  let reads = 0, queries = 0;
  const route: { GET?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } = {};
  const code = ts.transpileModule(fs.readFileSync("src/app/api/evidence/[id]/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports: route, URL, Buffer, require(name: string) {
    if (name === "next/server") return { NextResponse: Response };
    if (name === "@/lib/auth") return { getSession: async () => options.role === null ? null : { role: options.role ?? "teacher", userId: "teacher-owner" } };
    if (name === "@/lib/prisma") return { __esModule: true, default: { violation: { findUnique: async () => {
      queries++; return options.missing ? null : { evidenceFiles: options.inline || options.expired ? [] : [{ filePath: "synthetic-only" }], screenshotPath: options.inline ? `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}` : null, studentQuiz: { quiz: { teacherId: options.owner ?? "teacher-owner" } } };
    } } } };
    if (name === "@/lib/evidence-storage") return { readEvidence: async () => { reads++; return options.offline ? null : { bytes, contentType }; } };
    if (name === "@/lib/maintenance") return { expireSubscriptions: async () => {} };
    if (name === "@/lib/teacher-entitlements") return { hasActiveProSubscription: async () => options.pro !== false };
    throw Error(`Unexpected dependency ${name}`);
  } });
  return { bytes, counts: () => ({ reads, queries }), get: (range?: string, id = "1", download = false) => route.GET!(new Request(`https://app.example.test/api/evidence/${id}${download ? "?download=1" : ""}`, { headers: range === undefined ? {} : { Range: range } }), { params: Promise.resolve({ id }) }) };
}
for (const [range, start, end] of [[undefined, 0, 999], ["bytes=0-99", 0, 99], ["bytes=100-", 100, 999], ["bytes=-100", 900, 999], ["bytes=-2000", 0, 999], ["bytes=900-2000", 900, 999], ["bytes=999-999", 999, 999], ["bytes=000-009", 0, 9], ["bytes=-9999999999999999999999999", 0, 999], ["bytes=0-9999999999999999999999999", 0, 999]] as const) {
  test(`synthetic media ${range ?? "full response"}: exact bytes and headers`, async () => {
    const s = fixture(); const r = await s.get(range); assert.equal(r.status, range ? 206 : 200);
    assert.equal(r.headers.get("Accept-Ranges"), "bytes"); assert.equal(r.headers.get("Content-Length"), String(end - start + 1));
    assert.equal(r.headers.get("Content-Range"), range ? `bytes ${start}-${end}/1000` : null);
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), s.bytes.slice(start, end + 1));
    assert.equal(r.headers.get("Cache-Control"), "private, no-store"); assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff"); assert.match(r.headers.get("Content-Security-Policy")!, /sandbox/);
    assert.equal(s.counts().reads, 1);
  });
}
for (const range of ["bytes=1000-", "bytes=1001-1002", "bytes=100-50", "bytes=-0", "bytes=-", "bytes=", "bytes=oops", "bytes=0-1,3-4", "items=0-99", "bytes=0-1junk", "bytes=1.5-9", "bytes=999999999999999999999999999-"]) test(`invalid/unsatisfiable range ${range} is empty 416`, async () => {
  const r = await fixture().get(range); assert.equal(r.status, 416); assert.equal(r.headers.get("Content-Range"), "bytes */1000"); assert.equal(r.headers.get("Content-Length"), "0"); assert.equal((await r.arrayBuffer()).byteLength, 0);
});
test("empty media returns empty 200 without Range and 416 with any Range", async () => {
  const s = fixture({ size: 0 }); assert.equal((await s.get()).status, 200);
  for (const range of ["bytes=0-", "bytes=-1"]) { const r = await s.get(range); assert.equal(r.status, 416); assert.equal(r.headers.get("Content-Range"), "bytes */0"); }
});
for (const [options, status, queries] of [[{ role: null }, 401, 0], [{ role: "student" }, 401, 0], [{ pro: false }, 403, 0], [{ owner: "other-teacher" }, 403, 1], [{ missing: true }, 404, 1], [{ expired: true }, 404, 1]] as const) test(`authorization/content denial ${JSON.stringify(options)} never reads storage`, async () => {
  const s = fixture(options); assert.equal((await s.get("bytes=-100")).status, status); assert.deepEqual(s.counts(), { reads: 0, queries });
});
test("Admin may read across ownership without Teacher subscription; downloads retain safe headers", async () => {
  const s = fixture({ role: "admin", pro: false, owner: "other-teacher" }); const r = await s.get("bytes=-100", "1", true);
  assert.equal(r.status, 206); assert.equal(r.headers.get("Content-Disposition"), 'attachment; filename="evidence-1.mp4"');
});
test("legacy inline media uses same range rules; image behavior and outages remain unchanged", async () => {
  const inline = fixture({ inline: true }); const r = await inline.get("bytes=-100"); assert.equal(r.headers.get("Content-Range"), "bytes 900-999/1000"); assert.equal(inline.counts().reads, 0);
  assert.equal((await fixture({ contentType: "image/png" }).get("bytes=-100")).status, 200);
  assert.equal((await fixture({ offline: true }).get()).status, 503);
  const invalid = fixture(); assert.equal((await invalid.get(undefined, "bad")).status, 400); assert.deepEqual(invalid.counts(), { reads: 0, queries: 0 });
});
