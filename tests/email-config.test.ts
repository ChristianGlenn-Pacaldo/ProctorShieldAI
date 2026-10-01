import assert from "node:assert/strict";
import test from "node:test";
import { resolveEmailConfiguration } from "../src/lib/email-config.ts";

const smtp = { NODE_ENV: "production", EMAIL_PROVIDER: "smtp", SMTP_EMAIL: "sender@example.test", SMTP_PASSWORD: "app-password" };
const resend = { NODE_ENV: "production", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_example_key", EMAIL_FROM: "ProctorShield AI <sender@example.test>" };
const gmail = {
  NODE_ENV: "production", EMAIL_PROVIDER: "gmail-api", GMAIL_SENDER_EMAIL: "sender@gmail.com",
  GMAIL_OAUTH_CLIENT_ID: "123456-test.apps.googleusercontent.com",
  GMAIL_OAUTH_CLIENT_SECRET: "test-client-secret", GMAIL_OAUTH_REFRESH_TOKEN: "test-refresh-token",
};

test("production preflight accepts Gmail API without SMTP or Resend credentials", () => {
  assert.deepEqual(resolveEmailConfiguration(gmail, true), {
    provider: "gmail-api", sender: gmail.GMAIL_SENDER_EMAIL, clientId: gmail.GMAIL_OAUTH_CLIENT_ID,
    clientSecret: gmail.GMAIL_OAUTH_CLIENT_SECRET, refreshToken: gmail.GMAIL_OAUTH_REFRESH_TOKEN,
  });
});

for (const name of ["GMAIL_SENDER_EMAIL", "GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN"] as const) {
  test(`Gmail API preflight rejects missing ${name} despite populated other providers`, () => {
    assert.throws(() => resolveEmailConfiguration({ ...smtp, ...resend, ...gmail, [name]: "" }, true), new RegExp(name));
    assert.throws(() => resolveEmailConfiguration({ ...gmail, [name]: "   " }, true), new RegExp(name));
  });
}

test("Gmail API preflight rejects malformed sender/client ID and credential line breaks", () => {
  for (const sender of ["invalid", "sender@gmail.com\r\nBcc: other@gmail.com", "one@gmail.com,two@gmail.com"]) {
    assert.throws(() => resolveEmailConfiguration({ ...gmail, GMAIL_SENDER_EMAIL: sender }), /GMAIL_SENDER_EMAIL/);
  }
  assert.throws(() => resolveEmailConfiguration({ ...gmail, GMAIL_OAUTH_CLIENT_ID: "invalid" }), /GMAIL_OAUTH_CLIENT_ID/);
  assert.throws(() => resolveEmailConfiguration({ ...gmail, GMAIL_OAUTH_CLIENT_SECRET: "secret\nvalue" }), /GMAIL_OAUTH_CLIENT_SECRET/);
  assert.throws(() => resolveEmailConfiguration({ ...gmail, GMAIL_OAUTH_REFRESH_TOKEN: "token\nvalue" }), /GMAIL_OAUTH_REFRESH_TOKEN/);
});

test("Resend credentials never select Resend implicitly or override Gmail API", () => {
  assert.equal(resolveEmailConfiguration({ ...resend, ...gmail }).provider, "gmail-api");
  assert.equal(resolveEmailConfiguration({ ...resend, ...smtp }).provider, "smtp");
  assert.equal(resolveEmailConfiguration({ ...resend, EMAIL_PROVIDER: "resend" }).provider, "resend");
  assert.throws(() => resolveEmailConfiguration({ ...resend, EMAIL_PROVIDER: undefined }, true), /explicitly set/);
});

test("production preflight accepts explicitly selected SMTP without Resend credentials", () => {
  assert.deepEqual(resolveEmailConfiguration(smtp, true), {
    provider: "smtp", email: "sender@example.test", password: "app-password",
  });
});

test("production preflight accepts explicitly selected Resend without SMTP credentials", () => {
  assert.deepEqual(resolveEmailConfiguration(resend, true), {
    provider: "resend", apiKey: "re_example_key", from: "ProctorShield AI <sender@example.test>",
  });
});

test("production preflight rejects an unset or unknown provider", () => {
  assert.throws(
    () => resolveEmailConfiguration({ ...resend, EMAIL_PROVIDER: undefined }, true),
    /EMAIL_PROVIDER must be explicitly set/,
  );
  assert.throws(
    () => resolveEmailConfiguration({ ...resend, EMAIL_PROVIDER: "unknown" }, true),
    /Unsupported EMAIL_PROVIDER/,
  );
});

test("production preflight rejects missing or invalid selected-provider credentials", () => {
  assert.throws(() => resolveEmailConfiguration({ ...smtp, SMTP_EMAIL: "bad-address" }, true), /SMTP_EMAIL/);
  assert.throws(() => resolveEmailConfiguration({ ...smtp, SMTP_PASSWORD: " " }, true), /SMTP_PASSWORD/);
  assert.throws(() => resolveEmailConfiguration({ ...resend, RESEND_API_KEY: "wrong_key" }, true), /RESEND_API_KEY/);
  assert.throws(() => resolveEmailConfiguration({ ...resend, EMAIL_FROM: "sender@example.test\r\nBcc: attacker@example.test" }, true), /EMAIL_FROM/);
  assert.throws(() => resolveEmailConfiguration({ ...resend, EMAIL_FROM: "invalid sender" }, true), /EMAIL_FROM/);
});

test("only local development may default to SMTP when provider is unset", () => {
  assert.equal(resolveEmailConfiguration({ ...smtp, NODE_ENV: "development", EMAIL_PROVIDER: undefined }).provider, "smtp");
  assert.throws(
    () => resolveEmailConfiguration({ ...smtp, EMAIL_PROVIDER: undefined }),
    /EMAIL_PROVIDER must be explicitly set/,
  );
});
