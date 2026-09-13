import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("checkout returns to the actual secure request origin behind a tunnel", () => {
  assert.equal(
    resolvePayMongoReturnOrigin({
      originHeader: "https://current-tunnel.trycloudflare.com",
      forwardedHost: "current-tunnel.trycloudflare.com",
      host: "localhost:3000",
      forwardedProto: "https",
      requestUrl: "http://localhost:3000/api/billing",
      nodeEnv: "production",
    }),
    "https://current-tunnel.trycloudflare.com",
  );
});

test("checkout rejects insecure production return URLs", () => {
  assert.throws(() => resolvePayMongoReturnOrigin({
    host: "localhost:3000",
    requestUrl: "http://localhost:3000/api/billing",
    nodeEnv: "production",
  }), /secure HTTPS/);
});
