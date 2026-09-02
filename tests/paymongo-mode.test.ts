import assert from "node:assert/strict";
import test from "node:test";
import {
  getPayMongoMode,
  getPayMongoSecretKey,
  isPayMongoEventModeAllowed,
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
