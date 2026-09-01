import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePaidCheckout,
  parsePaymongoEventEnvelope,
  parseRefundedPayment,
} from "../src/lib/paymongo-events.ts";

test("PayMongo event parsing rejects missing envelope fields", () => {
  assert.equal(parsePaymongoEventEnvelope({ data: { id: "evt_1" } }), null);
});

test("paid checkout parsing preserves provider payment identity and amount", () => {
  const paid = parsePaidCheckout({
    id: "cs_1",
    attributes: {
      reference_number: "PS-123",
      metadata: { userId: "user-1", planId: "2" },
      payments: [{
        id: "pay_1",
        attributes: { amount: 50000, source: { type: "gcash" } },
      }],
    },
  });
  assert.deepEqual(paid, {
    userId: "user-1",
    planId: 2,
    providerPaymentId: "pay_1",
    reference: "PS-123",
    amountCentavos: 50000,
    paymentMethod: "gcash",
  });
});

test("refund parsing requires a provider payment id and positive amount", () => {
  assert.deepEqual(
    parseRefundedPayment({ id: "pay_1", attributes: { amount_refunded: 50000 } }),
    { providerPaymentId: "pay_1", refundedCentavos: 50000 },
  );
  assert.equal(parseRefundedPayment({ id: "pay_1", attributes: { amount: 0 } }), null);
});
