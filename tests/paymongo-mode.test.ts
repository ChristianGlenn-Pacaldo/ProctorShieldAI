import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createPayMongoReturnUrls,
  getPayMongoMode,
  getPayMongoSecretKey,
  isPayMongoEventModeAllowed,
  createPendingPayMongoCheckoutToken,
  resolvePayMongoReturnOrigin,
  verifyPendingPayMongoCheckoutToken,
} from "../src/lib/paymongo.ts";

test("PayMongo defaults to test mode", () => {
  assert.equal(getPayMongoMode({}), "test");
  assert.equal(isPayMongoEventModeAllowed(false, {}), true);
  assert.equal(isPayMongoEventModeAllowed(true, {}), false);
});

test("test mode accepts only test secret keys", () => {
  assert.equal(
    getPayMongoSecretKey({ PAYMONGO_MODE: "test", PAYMONGO_SECRET_KEY: "sk_test_example" }),
    "sk_test_example",
  );
  assert.throws(
    () => getPayMongoSecretKey({ PAYMONGO_MODE: "test", PAYMONGO_SECRET_KEY: "sk_live_example" }),
    /does not match/,
  );
});

test("an invalid PayMongo mode fails closed", () => {
  assert.throws(() => getPayMongoMode({ PAYMONGO_MODE: "sandbox" }), /must be either test or live/);
});

test("pending checkout tokens are signed, scoped, and expire", () => {
  const env = { NEXTAUTH_SECRET: "a-secure-test-secret-that-is-over-32-characters" };
  const checkout = { checkoutSessionId: "cs_test_123", userId: "teacher-1", planId: 2 };
  const token = createPendingPayMongoCheckoutToken(checkout, env, 1_000_000);

  assert.deepEqual(
    verifyPendingPayMongoCheckoutToken(token, env, 1_000_000),
    { ...checkout, expiresAt: 4_600 },
  );
  assert.equal(verifyPendingPayMongoCheckoutToken(`${token}x`, env, 1_000_000), null);
  assert.equal(verifyPendingPayMongoCheckoutToken(token, env, 4_601_000), null);
});

test("staging checkout return URLs use the configured HTTPS origin", () => {
  const env = { NEXT_PUBLIC_APP_URL: "  https://proctorshieldai-staging.up.railway.app/  ", NODE_ENV: "production" };
  assert.equal(resolvePayMongoReturnOrigin(env), "https://proctorshieldai-staging.up.railway.app");
  assert.deepEqual(createPayMongoReturnUrls(env), {
    successUrl: "https://proctorshieldai-staging.up.railway.app/dashboard/teacher/billing?payment=success",
    cancelUrl: "https://proctorshieldai-staging.up.railway.app/dashboard/teacher/billing?payment=cancelled",
  });
});

test("production checkout return URLs use the configured origin", () => {
  const env = { NEXT_PUBLIC_APP_URL: "https://PROCTORSHIELD.example:443", NODE_ENV: "production" };
  assert.equal(resolvePayMongoReturnOrigin(env), "https://proctorshield.example");
  for (const url of Object.values(createPayMongoReturnUrls(env))) {
    assert.equal(new URL(url).origin, "https://proctorshield.example");
  }
});

test("spoofed X-Forwarded-Host cannot affect checkout return URLs", () => {
  const route = readFileSync("src/app/api/billing/route.ts", "utf8");
  assert.match(route, /createPayMongoReturnUrls\(\)/);
  assert.match(route, /success_url:\s*returnUrls\.successUrl/);
  assert.match(route, /cancel_url:\s*returnUrls\.cancelUrl/);
  assert.doesNotMatch(route, /x-forwarded-host/i);
  assert.doesNotMatch(route, /x-forwarded-proto/i);
  assert.deepEqual(createPayMongoReturnUrls({
    NEXT_PUBLIC_APP_URL: "https://proctorshield.example",
    NODE_ENV: "production",
    "x-forwarded-host": "untrusted.example",
    "x-forwarded-proto": "https",
  }), {
    successUrl: "https://proctorshield.example/dashboard/teacher/billing?payment=success",
    cancelUrl: "https://proctorshield.example/dashboard/teacher/billing?payment=cancelled",
  });
});

test("spoofed Host and Origin cannot affect checkout return URLs", () => {
  const route = readFileSync("src/app/api/billing/route.ts", "utf8");
  assert.doesNotMatch(route, /req\.headers\.get\(["'](?:host|origin)["']\)/i);
  assert.deepEqual(createPayMongoReturnUrls({
    NEXT_PUBLIC_APP_URL: "https://proctorshield.example",
    NODE_ENV: "production",
    host: "untrusted.example",
    origin: "https://untrusted.example",
  }), {
    successUrl: "https://proctorshield.example/dashboard/teacher/billing?payment=success",
    cancelUrl: "https://proctorshield.example/dashboard/teacher/billing?payment=cancelled",
  });
});

test("checkout rejects missing or malformed configured origins", () => {
  for (const value of [
    undefined,
    "not-a-url",
    "https:proctorshield.example",
    "https://",
    "ftp://proctorshield.example",
    "https://user:password@proctorshield.example",
    "https://proctorshield.example/billing",
    "https://proctorshield.example/.",
    "https://proctorshield.example?next=other",
    "https://proctorshield.example#billing",
  ]) {
    assert.throws(() => resolvePayMongoReturnOrigin({ NEXT_PUBLIC_APP_URL: value, NODE_ENV: "production" }));
  }
});

test("checkout rejects HTTP origins in production, including localhost", () => {
  assert.throws(() => resolvePayMongoReturnOrigin({
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NODE_ENV: "production",
  }), /secure HTTPS/);
});

test("local development permits only an HTTP loopback origin", () => {
  const env = { NEXT_PUBLIC_APP_URL: "http://localhost:3000", NODE_ENV: "development" };
  assert.equal(resolvePayMongoReturnOrigin(env), "http://localhost:3000");
  assert.equal(createPayMongoReturnUrls(env).cancelUrl,
    "http://localhost:3000/dashboard/teacher/billing?payment=cancelled");
  assert.equal(resolvePayMongoReturnOrigin({ NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000", NODE_ENV: "development" }),
    "http://127.0.0.1:3000");
  assert.throws(() => resolvePayMongoReturnOrigin({
    NEXT_PUBLIC_APP_URL: "http://untrusted.example", NODE_ENV: "development",
  }), /secure HTTPS/);
});
