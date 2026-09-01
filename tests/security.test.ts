import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { consumeRateLimit, consumeRateLimitGroup, hashOtp, isStrongPassword } from "../src/lib/security.ts";
import { verifyPayMongoSignature } from "../src/lib/paymongo.ts";

test("password policy rejects weak values", () => {
  assert.equal(isStrongPassword("short1"), false);
  assert.equal(isStrongPassword("onlyletterslong"), false);
  assert.equal(isStrongPassword("StrongPass123"), true);
});

test("OTP hashes are scoped by user and purpose", () => {
  process.env.NEXTAUTH_SECRET = "test-secret-that-is-longer-than-thirty-two-characters";
  const login = hashOtp("user-a", "123456", "login");
  assert.notEqual(login, "123456");
  assert.notEqual(login, hashOtp("user-b", "123456", "login"));
  assert.notEqual(login, hashOtp("user-a", "123456", "password-reset"));
});

test("PayMongo signatures require a valid HMAC and recent timestamp", () => {
  const nowMs = 1_800_000_000_000;
  const timestamp = String(nowMs / 1000);
  const body = JSON.stringify({ data: { id: "evt_test" } });
  const secret = "whsk_test_secret";
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  assert.equal(
    verifyPayMongoSignature(body, `t=${timestamp},te=${signature},li=`, secret, nowMs),
    "te"
  );
  assert.equal(
    verifyPayMongoSignature(`${body}x`, `t=${timestamp},te=${signature},li=`, secret, nowMs),
    null
  );
  assert.equal(
    verifyPayMongoSignature(body, `t=${Number(timestamp) - 301},te=${signature},li=`, secret, nowMs),
    null
  );
});

test("rate limiting rejects requests beyond the configured local limit", async () => {
  const key = `test:${crypto.randomUUID()}`;
  assert.equal((await consumeRateLimit(key, 2, 60_000)).allowed, true);
  assert.equal((await consumeRateLimit(key, 2, 60_000)).allowed, true);
  assert.equal((await consumeRateLimit(key, 2, 60_000)).allowed, false);
});

test("grouped rate limits protect an account independently of the IP key", async () => {
  const accountKey = `account:${crypto.randomUUID()}`;
  assert.equal((await consumeRateLimitGroup([accountKey, `ip:${crypto.randomUUID()}`], 1, 60_000)).allowed, true);
  assert.equal((await consumeRateLimitGroup([accountKey, `ip:${crypto.randomUUID()}`], 1, 60_000)).allowed, false);
});
