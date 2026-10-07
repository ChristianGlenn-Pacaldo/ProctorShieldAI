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
async function providerFixture(t: TestContext, statuses: number[], output = JSON.stringify({ questions: generatedQuestions })) {
  const requests: any[] = [];
  const diagnostics: unknown[][] = [];
  let receipts = 0;
  let retryOptions: any;
  const provider = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    requests.push(JSON.parse(body));
    const status = statuses[Math.min(requests.length - 1, statuses.length - 1)];
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(status === 200
      ? { candidates: [{ content: { role: "model", parts: [{ text: output }] }, finishReason: "STOP" }] }
      : { error: { code: status, status: "UNAVAILABLE", message: "Provider details with fixture-secret must stay private" } }));
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
    requests, diagnostics,
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
  for (const status of [400, 401, 403, 429]) {
    const setup = await providerFixture(t, [status]);
    const response = await setup.post({ topic: "Biology", numQuestions: 3 });
    assert.equal(setup.requests.length, 1, `HTTP ${status} must not retry`);
    assert.equal(response.status, 500);
    assert.equal(setup.receipts, 0);
    assert.doesNotMatch(JSON.stringify({ response, diagnostics: setup.diagnostics }), /fixture-secret|Provider details/);
  }
});

test("malformed successful provider output is not retried or signed", async (t) => {
  const setup = await providerFixture(t, [200], "not valid JSON");
  const response = await setup.post({ topic: "Biology", numQuestions: 3 });
  assert.equal(response.status, 500);
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.receipts, 0);
  assert.match(response.body.error, /Invalid format/);
});
