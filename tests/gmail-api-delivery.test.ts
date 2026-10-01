import assert from "node:assert/strict";
import test from "node:test";
import { loadEmail } from "./helpers/email-harness.ts";

const scope = "https://www.googleapis.com/auth/gmail.send";
const environment = {
  NODE_ENV: "production" as const, EMAIL_PROVIDER: "gmail-api", GMAIL_SENDER_EMAIL: "sender@gmail.com",
  GMAIL_OAUTH_CLIENT_ID: "123456-test.apps.googleusercontent.com",
  GMAIL_OAUTH_CLIENT_SECRET: "client-secret-private", GMAIL_OAUTH_REFRESH_TOKEN: "refresh-token-private",
  RESEND_API_KEY: "re_dormant_test_key", SMTP_EMAIL: "unused@gmail.com", SMTP_PASSWORD: "unused-password",
};
const validToken = { access_token: "access-token-private", token_type: "Bearer", expires_in: 3600, scope };

function fixture(responses: Array<Response | Error>) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const errors: unknown[][] = [];
  const email = loadEmail({ environment, console: { log: () => {}, error: (...args: unknown[]) => errors.push(args) },
    fetch: (async (url, init) => {
      requests.push({ url: String(url), init });
      const result = responses.shift();
      if (!result) throw new Error("Unexpected network call");
      if (result instanceof Error) throw result;
      return result;
    }) as typeof fetch,
  });
  return { ...email, requests, errors };
}

test("Gmail API sends existing OTP MIME to the intended recipient through two HTTPS requests", async () => {
  const setup = fixture([Response.json(validToken), Response.json({ id: "abcdef123456" })]);
  assert.equal(await setup.sendOtpEmail("recipient@gmail.com", "123456"), true);
  assert.deepEqual(setup.requests.map(r => r.url), ["https://oauth2.googleapis.com/token", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"]);
  const tokenRequest = new URLSearchParams(String(setup.requests[0].init?.body));
  assert.equal(tokenRequest.get("grant_type"), "refresh_token");
  assert.equal(tokenRequest.get("scope"), scope);
  assert.equal(tokenRequest.get("client_id"), environment.GMAIL_OAUTH_CLIENT_ID);
  assert.equal(tokenRequest.get("client_secret"), environment.GMAIL_OAUTH_CLIENT_SECRET);
  assert.equal(tokenRequest.get("refresh_token"), environment.GMAIL_OAUTH_REFRESH_TOKEN);
  const send = setup.requests[1].init!;
  assert.equal((send.headers as Record<string, string>).Authorization, `Bearer ${validToken.access_token}`);
  const raw = JSON.parse(String(send.body)).raw;
  assert.match(raw, /^[A-Za-z0-9_-]+$/);
  const mime = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(mime, /From: ProctorShield AI <sender@gmail.com>/);
  assert.match(mime, /To: recipient@gmail.com\r\n/);
  assert.match(mime, /Subject: Your ProctorShield AI Verification Code/);
  assert.match(mime, /Content-Type: text\/html; charset=utf-8/);
  assert.match(mime, /123456/);
  assert.match(mime, /10 minutes/);
  assert.doesNotMatch(mime, /client-secret-private|refresh-token-private|access-token-private/);
  for (const request of setup.requests) {
    assert.equal(request.init?.method, "POST");
    assert.equal(request.init?.redirect, "error");
    assert.equal(request.init?.cache, "no-store");
    assert.ok(request.init?.signal instanceof AbortSignal);
  }
});

test("token refresh rejection stops delivery without fallback or sensitive provider error logging", async () => {
  const setup = fixture([Response.json({ error_description: "refresh-token-private 123456" }, { status: 400 })]);
  assert.equal(await setup.sendOtpEmail("recipient@gmail.com", "123456"), false);
  assert.equal(setup.requests.length, 1);
  assert.match(String(setup.errors[0][1]), /HTTP 400/);
  assert.doesNotMatch(String(setup.errors[0][1]), /refresh-token-private|123456/);
});

test("Gmail send rejection stops without SMTP/Resend fallback or automatic duplicate retries", async () => {
  const setup = fixture([Response.json(validToken), Response.json({ error: "access-token-private 123456" }, { status: 403 })]);
  assert.equal(await setup.sendOtpEmail("recipient@gmail.com", "123456"), false);
  assert.equal(setup.requests.length, 2);
  assert.match(String(setup.errors[0][1]), /HTTP 403/);
  assert.doesNotMatch(String(setup.errors[0][1]), /access-token-private|123456/);
});

for (const [index, token] of [
  {}, { ...validToken, access_token: "" }, { ...validToken, access_token: "unsafe\r\nvalue" },
  { ...validToken, token_type: "invalid" }, { ...validToken, expires_in: 0 },
  { ...validToken, scope: "https://mail.google.com/" }, { ...validToken, scope: `${scope} openid` },
  { ...validToken, scope: undefined },
].entries()) {
  test(`Gmail transport fails closed for invalid token metadata case ${index + 1}`, async () => {
    const setup = fixture([Response.json(token)]);
    assert.equal(await setup.sendOtpEmail("recipient@gmail.com", "123456"), false);
    assert.equal(setup.requests.length, 1);
  });
}

test("network errors and malformed JSON are sanitized", async () => {
  for (const response of [new Error("refresh-token-private client-secret-private access-token-private 123456"), new Response("not JSON")]) {
    const setup = fixture([response]);
    assert.equal(await setup.sendOtpEmail("recipient@gmail.com", "123456"), false);
    assert.equal(setup.requests.length, 1);
    assert.doesNotMatch(String(setup.errors[0][1]), /refresh-token-private|client-secret-private|access-token-private|123456/);
  }
});

test("Gmail transport rejects invalid recipients before requesting a token", async () => {
  for (const to of ["bad", "one@gmail.com,two@gmail.com", "one@gmail.com\r\nBcc: two@gmail.com"]) {
    const setup = fixture([]);
    assert.equal(await setup.sendOtpEmail(to, "123456"), false);
    assert.equal(setup.requests.length, 0);
  }
});

test("missing Gmail message ID is a failure", async () => {
  const setup = fixture([Response.json(validToken), Response.json({})]);
  assert.equal(await setup.sendOtpEmail("recipient@gmail.com", "123456"), false);
  assert.equal(setup.requests.length, 2);
});

test("welcome and verdict templates use the selected Gmail API transport too", async () => {
  const setup = fixture([Response.json(validToken), Response.json({ id: "welcome" }), Response.json(validToken), Response.json({ id: "verdict" })]);
  assert.equal(await setup.sendWelcomeEmail("recipient@gmail.com", "Teacher", "teacher"), true);
  assert.equal(await setup.sendVerdictEmail("recipient@gmail.com", "Student", "Quiz", 80, "clean", "No issue"), true);
  assert.equal(setup.requests.length, 4);
});
