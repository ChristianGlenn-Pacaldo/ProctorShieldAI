import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { VALID_VIOLATION_TYPES } from "../src/lib/proctoring-detection.ts";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=";
const event = { quizId: 7, studentQuizId: "attempt-1", violationType: "no_face", confidenceScore: 100 };
const url = "https://app.example/api/live/violation";
const json = (body: unknown) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function videoForm(options: { type?: string; bytes?: Uint8Array; duration?: string; omitFile?: boolean } = {}) {
  const bytes = options.bytes ?? new Uint8Array(1_000);
  if (!options.bytes) bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  const form = new FormData();
  if (!options.omitFile) form.set("evidence", new File([Uint8Array.from(bytes).buffer], "clip.webm", { type: options.type ?? "video/webm" }));
  form.set("durationMs", options.duration ?? "4000");
  return new Request(`${url}/1/evidence`, { method: "POST", body: form });
}

function fixture(options: { session?: any; owned?: boolean; stored?: boolean } = {}) {
  let reads = 0, writes = 0, uploads = 0;
  const violation = { id: BigInt(1), studentQuizId: "attempt-1", violationType: "no_face", timestamp: new Date() };
  const db: any = {
    studentQuiz: {
      findFirst: async ({ where }: any) => { reads++; assert.equal(where.studentId, "student"); return options.owned === false ? null : { id: "attempt-1", quizId: 7, quiz: { teacherId: "teacher", title: "Exam", quizMode: "proctored" } }; },
      updateMany: async () => { writes++; return { count: 1 }; },
    },
    violation: {
      findFirst: async ({ where }: any) => { reads++; assert.equal(where.studentQuiz.studentId, "student"); return options.owned === false ? null : violation; },
      count: async () => 0,
      create: async () => { writes++; return violation; },
      update: async () => { writes++; return violation; },
    },
    evidenceFile: { create: async () => { writes++; return {}; } },
    $executeRaw: async () => {},
    $transaction: async (arg: any) => typeof arg === "function" ? arg(db) : Promise.all(arg),
  };
  const exports: any = {};
  const dependencies: Record<string, any> = {
    "next/server": { NextResponse: { json: (body: any, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/backup-write-gate": { withBackupWriteGate: (handler: any) => handler },
    "@/lib/auth": { getSession: async () => options.session === undefined ? { userId: "student", role: "student" } : options.session },
    "@/lib/prisma": { __esModule: true, default: db },
    "@/lib/security": { consumeRateLimitGroup: async () => ({ allowed: true }), getClientIp: () => "local" },
    "@/lib/proctoring-detection": { VALID_VIOLATION_TYPES },
    "@/lib/pusher": { pusherServer: { trigger: async () => {} } },
    "@/lib/evidence-storage": { uploadEvidence: upload, uploadEvidenceBytes: upload },
  };
  async function upload() { uploads++; return options.stored === false ? null : { key: "private-key", contentType: "video/webm" }; }
  function load(video = false) {
    const file = video ? "src/app/api/live/violation/[id]/evidence/route.ts" : "src/app/api/live/violation/route.ts";
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, {
      exports, Buffer, File, FormData, Uint8Array, process: { env: { NODE_ENV: "production" } }, console: { error() {}, warn() {} },
      require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
    });
    return exports.POST;
  }
  return { load, dependencies, counters: () => ({ reads, writes, uploads }), video: (request: any, id: any = "1") => load(true)(request, { params: Promise.resolve({ id }) }) };
}
function assertUntouched(f: ReturnType<typeof fixture>) { assert.deepEqual(f.counters(), { reads: 0, writes: 0, uploads: 0 }); }

test("exact staging octet-stream probe returns 400 instead of parser HTTP 500", async () => {
  const f = fixture();
  const response = await f.video(new Request(`${url}/1/evidence`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: "probe" }));
  assert.equal(response.status, 400);
  assertUntouched(f);
  assert.deepEqual(await response.json(), { error: "Invalid evidence request body" });
});

test("malformed multipart and unreadable file bodies return 400 without mutation", async () => {
  for (const request of [
    new Request(url, { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=missing" }, body: "broken" }),
    { headers: new Headers(), formData: async () => { const form = await videoForm().formData(); const file = form.get("evidence") as File; file.arrayBuffer = async () => { throw new Error("unreadable"); }; return form; } },
  ]) {
    const f = fixture(); assert.equal((await f.video(request)).status, 400); assertUntouched(f);
  }
});

test("video identifiers are positive bounded PostgreSQL bigints", async () => {
  for (const id of [null, {}, 1, "", "0", "-1", "1.5", "9223372036854775808", "1".repeat(100)]) {
    const f = fixture(); assert.equal((await f.video(videoForm(), id)).status, 400); assertUntouched(f);
  }
  const f = fixture(); assert.equal((await f.load(true)(videoForm(), { params: Promise.resolve({}) })).status, 400); assertUntouched(f);
});

test("video fields, MIME type, size, and signature are validated before DB/storage", async () => {
  for (const [request, status] of [
    [videoForm({ omitFile: true }), 400], [videoForm({ duration: "" }), 400],
    [videoForm({ duration: "NaN" }), 400], [videoForm({ duration: "6000" }), 400],
    [videoForm({ type: "image/png" }), 400], [videoForm({ bytes: new Uint8Array(10) }), 400],
    [videoForm({ bytes: new Uint8Array(6_000_001) }), 413], [videoForm({ bytes: new Uint8Array(1_000) }), 400],
  ] as const) {
    const f = fixture(); assert.equal((await f.video(request)).status, status); assertUntouched(f);
  }
});

test("malformed JSON and non-object violation bodies return controlled 400", async () => {
  for (const request of [new Request(url, { method: "POST", body: "{" }), json(null), json([]), json("bad")]) {
    const f = fixture(); assert.equal((await f.load()(request)).status, 400); assertUntouched(f);
  }
});

test("missing identifiers and invalid violation field types return 400", async () => {
  for (const body of [{}, { ...event, quizId: null }, { ...event, quizId: [] }, { ...event, quizId: { toString: null } }, { ...event, quizId: true },
    { ...event, quizId: 0 }, { ...event, quizId: 2147483648 }, { ...event, quizId: 1.5 },
    { ...event, studentQuizId: undefined }, { ...event, studentQuizId: {} }, { ...event, studentQuizId: "../bad" },
    { ...event, violationType: {} }, { ...event, violationType: "invalid" },
    { ...event, confidenceScore: {} }, { ...event, confidenceScore: "NaN" }, { ...event, incidentId: [] }]) {
    const f = fixture(); assert.equal((await f.load()(json(body))).status, 400); assertUntouched(f);
  }
});

test("invalid base64, media signatures, and either image field are rejected before violation writes", async () => {
  for (const screenshot of [42, {}, "data:image/jpeg;base64,YQ==", "data:image/png;base64,====", "data:image/png;base64,AAA", "data:image/png;base64,AB==", "data:text/html;base64,QQ==", "data:image/jpeg;base64,/9j/"] ) {
    const f = fixture(); assert.equal((await f.load()(json({ ...event, screenshot }))).status, 400); assertUntouched(f);
  }
  const f = fixture(); assert.equal((await f.load()(json({ ...event, screenshot: png, snapshot: {} }))).status, 400); assertUntouched(f);
});

test("oversized image is 413 without evidence or violation mutation", async () => {
  // The first byte over the decoded limit shares the allowed encoded length.
  const bytes = Buffer.alloc(2_000_001); bytes.set([0xff, 0xd8, 0xff]); bytes.set([0xff, 0xd9], bytes.length - 2);
  for (const screenshot of [`data:image/png;base64,${"A".repeat(2_800_001)}`, `data:image/jpeg;base64,${bytes.toString("base64")}`]) {
    const f = fixture(); assert.equal((await f.load()(json({ ...event, screenshot }))).status, 413); assertUntouched(f);
  }
});

test("unauthenticated and nonstudent requests retain 401 before parsing", async () => {
  for (const session of [null, { userId: "teacher", role: "teacher" }, { userId: "admin", role: "admin" }]) {
    for (const video of [false, true]) {
      const f = fixture({ session }); const request = new Request(url, { method: "POST", body: "{" });
      assert.equal((await (video ? f.video(request) : f.load()(request))).status, 401); assertUntouched(f);
    }
  }
});

test("other student's violation or attempt remains inaccessible", async () => {
  for (const video of [false, true]) {
    const f = fixture({ owned: false }); assert.equal((await (video ? f.video(videoForm()) : f.load()(json(event)))).status, 404);
    assert.equal(f.counters().uploads, 0); assert.equal(f.counters().writes, 0);
  }
});

test("valid video upload and image-bearing violation still store evidence", async () => {
  for (const video of [false, true]) {
    const f = fixture(); assert.equal((await (video ? f.video(videoForm()) : f.load()(json({ ...event, screenshot: png })))).status, 200);
    assert.equal(f.counters().uploads, 1); assert.ok(f.counters().writes > 0);
  }
});

test("unavailable production upload storage retains controlled 503", async () => {
  const f = fixture({ stored: false }); assert.equal((await f.video(videoForm())).status, 503); assert.equal(f.counters().writes, 0);
});

test("real provider errors remain generic server failures rather than malformed input", async () => {
  const f = fixture(); f.dependencies["@/lib/evidence-storage"].uploadEvidenceBytes = async () => { throw new Error("private provider details"); };
  const response = await f.video(videoForm()); assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Failed to store evidence video" }); assert.equal(f.counters().writes, 0);
});
