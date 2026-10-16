import assert from "node:assert/strict";
import { createServer } from "node:http";
import test, { type TestContext } from "node:test";
import { GoogleGenAI } from "@google/genai";
import { loadArenaModule } from "./helpers/arena-fixture.ts";

const generatedQuestions = Array.from({ length: 3 }, (_, index) => ({
  questionText: `Plant biology question ${index + 1}`,
  choices: [
    { choiceText: "Correct plant fact", isCorrect: true },
    { choiceText: "Incorrect fact A", isCorrect: false },
    { choiceText: "Incorrect fact B", isCorrect: false },
    { choiceText: "Incorrect fact C", isCorrect: false },
  ],
}));

// Exercise the installed SDK's real retry transport against an isolated local
// server. This fixture never uses the configured provider or application data.
async function providerFixture(t: TestContext, statuses: number[], output = JSON.stringify({ questions: generatedQuestions }), retryDelay?: string) {
  const requests: any[] = [];
  const paths: string[] = [];
  const diagnostics: unknown[][] = [];
  let receipts = 0;
  let retryOptions: any;
  const provider = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    requests.push(JSON.parse(body));
    paths.push(request.url || "");
    const status = statuses[Math.min(requests.length - 1, statuses.length - 1)];
    if (status === 0) return; // Deliberately stalled provider; cancelled by deadline test.
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(status === 200
      ? { candidates: [{ content: { role: "model", parts: [{ text: output }] }, finishReason: "STOP" }] }
      : { error: { code: status, status: "UNAVAILABLE", message: "Provider details with fixture-secret must stay private",
        details: retryDelay ? [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }] : [] } }));
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    provider.close((error) => error ? reject(error) : resolve());
    provider.closeAllConnections();
  }));
  const address = provider.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  class LocalProviderClient extends GoogleGenAI {
    constructor(options: ConstructorParameters<typeof GoogleGenAI>[0]) {
      retryOptions = options?.httpOptions?.retryOptions;
      super({
        ...options,
        httpOptions: {
          ...options?.httpOptions,
          baseUrl,
          // Keep the route's retry count and status policy; omit waits in tests.
          ...(retryOptions ? { retryOptions: { ...retryOptions, initialDelay: 0, maxDelay: 0, jitter: 0 } } : {}),
        },
      });
    }
  }
  const route = loadArenaModule("src/app/api/ai/create/route.ts", {
    __process: { env: { GEMINI_API_KEY: "fixture-secret" } },
    __diagnostics: diagnostics,
    "@/lib/backup-write-gate": { withBackupWriteGate: (handler: unknown) => handler },
    "next/server": { NextResponse: { json: (body: unknown, init: any = {}) => ({ body, status: init.status ?? 200, headers: init.headers ?? {} }) } },
    "@/lib/auth": { getSession: async () => ({ userId: "teacher", role: "teacher" }) },
    "@/lib/security": { consumeRateLimitGroup: async () => ({ allowed: true }), getClientIp: () => "local" },
    "@/lib/maintenance": { expireSubscriptions: async () => {} },
    "@/lib/teacher-entitlements": { getTeacherEntitlements: async () => ({ isSubscribed: true }) },
    "@/lib/ai-quiz-provenance": { createAiQuizReceipt: () => { receipts++; return "signed-test-receipt"; } },
    "@google/genai": { GoogleGenAI: LocalProviderClient },
  });
  return {
    requests, diagnostics, paths,
    get receipts() { return receipts; },
    get retryOptions() { return retryOptions; },
    post: (body: unknown) => route.POST({ json: async () => body, headers: { get: () => null } }),
  };
}

test("image generation recovers from one provider 503 with unchanged source and one receipt", async (t) => {
  const setup = await providerFixture(t, [503, 200]);
  const response = await setup.post({ imageBase64: "QUJD", mimeType: "image/jpeg", numQuestions: 3 });
  assert.equal(response.status, 200);
  assert.equal(setup.requests.length, 2);
  assert.deepEqual(setup.requests[0], setup.requests[1]);
  assert.deepEqual(setup.requests[0].contents[0].parts[0].inlineData, { data: "QUJD", mimeType: "image/jpeg" });
  assert.match(setup.requests[0].contents[0].parts[1].text, /Generate 3 multiple-choice/);
  assert.deepEqual(JSON.parse(JSON.stringify(response.body.questions)), generatedQuestions);
  assert.equal(setup.receipts, 1);
  assert.equal(response.body.aiGenerationReceipt, "signed-test-receipt");
  assert.ok(setup.retryOptions.initialDelay > 0);
  assert.ok(setup.retryOptions.expBase > 1);
  assert.ok(setup.retryOptions.jitter > 0);
});

test("text generation can recover on the final bounded attempt", async (t) => {
  const setup = await providerFixture(t, [503, 503, 200]);
  const response = await setup.post({ sourceText: "Plant biology notes", numQuestions: 3 });
  assert.equal(response.status, 200);
  assert.equal(setup.requests.length, 3);
  assert.match(setup.paths[0], /gemini-3\.6-flash/);
  assert.equal(setup.paths[1], setup.paths[0]);
  assert.match(setup.paths[2], /gemini-3\.5-flash/);
  for (const request of setup.requests) {
    assert.match(request.contents[0].parts[0].text, /Plant biology notes/);
    assert.match(request.contents[0].parts[0].text, /Generate 3 multiple-choice/);
  }
  assert.equal(setup.receipts, 1);
});

test("persistent provider 503 stops after three calls and reports a safe retryable failure", async (t) => {
  const setup = await providerFixture(t, [503]);
  const response = await setup.post({ topic: "Biology", numQuestions: 3 });
  assert.equal(setup.requests.length, 3);
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "AI_PROVIDER_UNAVAILABLE");
  assert.match(response.body.error, /temporarily busy/);
  assert.ok(Number(response.headers["Retry-After"]) > 0);
  assert.equal(response.body.questions, undefined);
  assert.equal(response.body.aiGenerationReceipt, undefined);
  assert.equal(setup.receipts, 0);
  assert.doesNotMatch(JSON.stringify({ response, diagnostics: setup.diagnostics }), /fixture-secret|Provider details/);
  assert.match(JSON.stringify(setup.diagnostics), /503/);
});

test("invalid credentials, bad requests and quota errors are not retried", async (t) => {
  for (const status of [400, 401, 403, 404, 429]) {
    const setup = await providerFixture(t, [status]);
    const response = await setup.post({ topic: "Biology", numQuestions: 3 });
    assert.equal(setup.requests.length, 1, `HTTP ${status} must not retry`);
    assert.equal(response.status, status === 400 ? 500 : 503);
    if (status === 429) assert.equal(response.body.code, "AI_PROVIDER_QUOTA");
    else if (status !== 400) assert.equal(response.body.code, "AI_PROVIDER_CONFIGURATION");
    assert.equal(setup.receipts, 0);
    assert.doesNotMatch(JSON.stringify({ response, diagnostics: setup.diagnostics }), /fixture-secret|Provider details/);
  }
});

test("provider quota reports its actual bounded retry delay without leaking provider details or issuing another call", async t => {
  for (const [delay, expected] of [["29843s", "29843"], ["999999999s", "86400"], ["-1s", "60"], ["12.4s", "13"]]) {
    const setup = await providerFixture(t, [429], undefined, delay);
    const response = await setup.post({ imageBase64: "QUJD", mimeType: "image/jpeg", numQuestions: 3 });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, "AI_PROVIDER_QUOTA");
    assert.equal(response.headers["Retry-After"], expected);
    assert.equal(setup.requests.length, 1);
    assert.equal(setup.receipts, 0);
    assert.match(response.body.error, /usage quota/);
    assert.doesNotMatch(JSON.stringify({ response, diagnostics: setup.diagnostics }), /fixture-secret|Provider details/);
  }
});

test("provider request timeout reports a safe actionable response", async t => {
  const setup = await providerFixture(t, [504]);
  const response = await setup.post({ topic: "Biology" });
  assert.equal(response.status, 504);
  assert.equal(response.body.code, "AI_PROVIDER_TIMEOUT");
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.receipts, 0);
});

test("the total deadline aborts a stalled real SDK request instead of leaving generation pending", async t => {
  const original = AbortSignal.timeout;
  AbortSignal.timeout = () => original(100);
  t.after(() => { AbortSignal.timeout = original; });
  const setup = await providerFixture(t, [0]);
  const response = await setup.post({ topic: "Biology" });
  assert.equal(response.status, 504);
  assert.equal(response.body.code, "AI_PROVIDER_TIMEOUT");
  assert.ok(setup.requests.length <= 1);
  assert.equal(setup.receipts, 0);
});

test("malformed successful provider output is not retried or signed", async (t) => {
  const setup = await providerFixture(t, [200], "not valid JSON");
  const response = await setup.post({ topic: "Biology", numQuestions: 3 });
  assert.equal(response.status, 500);
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.receipts, 0);
  assert.match(response.body.error, /Invalid format/);
});
