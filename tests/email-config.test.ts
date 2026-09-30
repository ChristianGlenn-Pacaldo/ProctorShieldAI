import assert from "node:assert/strict";
import test from "node:test";
import { resolveEmailConfiguration } from "../src/lib/email-config.ts";

const smtp = { NODE_ENV: "production", EMAIL_PROVIDER: "smtp", SMTP_EMAIL: "sender@example.test", SMTP_PASSWORD: "app-password" };
const resend = { NODE_ENV: "production", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_example_key", EMAIL_FROM: "ProctorShield AI <sender@example.test>" };

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
