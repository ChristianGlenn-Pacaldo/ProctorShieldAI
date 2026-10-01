import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { billingEvent, loadBillingModule, paidCheckout } from "./helpers/paymongo-fixture.ts";
import type { PrismaClient } from "@prisma/client";

function webhookFixture(options: { refundResult?: string; failure?: Error; stale?: boolean } = {}) {
  const order: string[] = [];
  const calls: unknown[][] = [];
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  const response = { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/app/api/billing/webhook/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    exports, Buffer, Response, console: { error() {} }, process: { env: { PAYMONGO_WEBHOOK_SECRET: "test-only" } },
    fetch: async () => { order.push("provider-http"); return Response.json({ data: { id: "cs_test" } }); },
    require(name: string) {
      if (name === "@/lib/backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler };
      if (name === "next/server") return { NextResponse: response };
      if (name === "@/lib/paymongo") return { verifyPayMongoSignature: () => "te", isPayMongoEventModeAllowed: () => true, getPayMongoSecretKey: () => "sk_test_only" };
      if (name === "@/lib/paymongo-events") return {
        parsePaymongoEventEnvelope: (body: unknown) => body,
        parsePaidCheckout: () => options.stale ? null : paidCheckout("one"),
        parsePaidCheckoutFromCurrentSession: () => paidCheckout("one"),
        parseRefundedPayment: () => ({ providerPaymentId: "pay-one", refundedCentavos: 50_000 }),
      };
      if (name === "@/lib/paymongo-subscription") return {
        activatePaidCheckout: async (...args: unknown[]) => { order.push("activation-transaction"); calls.push(args); return "activated"; },
        refundPaidCheckout: async (...args: unknown[]) => { order.push("refund-transaction"); calls.push(args); if (options.failure) throw options.failure; return options.refundResult ?? "refunded"; },
      };
      throw new Error(`Unexpected webhook dependency ${name}`);
    },
  });
  return {
    order, calls,
    post: (type: string) => exports.POST!(new Request("http://localhost/api/billing/webhook", {
      method: "POST", headers: { "paymongo-signature": "test-only" },
      body: JSON.stringify({ id: "event-test", type, livemode: false, resource: { id: "cs_test" } }),
    })),
  };
}

test("signed refund route uses the shared mutation primitive and confirms only its duplicate result", async () => {
  for (const refundResult of ["refunded", "already_processed"]) {
    const f = webhookFixture({ refundResult }); const res = await f.post("payment.refunded");
    assert.equal(res.status, 200); assert.equal(f.calls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])), [{ providerPaymentId: "pay-one", refundedCentavos: 50_000 }, { id: "event-test", type: "payment.refunded", source: "paymongo-webhook" }]);
    assert.equal((await res.json()).message, refundResult === "already_processed" ? "Already processed" : undefined);
  }
});

test("unrelated refund uniqueness failure is a retryable server error, never a success acknowledgement", async () => {
  const failure = Object.assign(new Error("injected unrelated constraint"), { code: "P2002" });
  const res = await webhookFixture({ failure }).post("payment.refund.updated");
  assert.equal(res.status, 500); assert.equal((await res.json()).error, "Internal Error");
});

test("stale paid webhook verifies with provider before entering activation transaction", async () => {
  const f = webhookFixture({ stale: true }); assert.equal((await f.post("checkout_session.payment.paid")).status, 200);
  assert.deepEqual(f.order, ["provider-http", "activation-transaction"]);
});

test("activation acquires payment then Teacher lock before any authoritative read", async () => {
  const order: string[] = [];
  const client = { $transaction: async (work: (tx: unknown) => Promise<unknown>, options: object) => {
    assert.deepEqual(JSON.parse(JSON.stringify(options)), { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 20_000 });
    return work({
      $executeRaw: async (sql: TemplateStringsArray) => {
        const statement = sql.join("");
        order.push(statement.includes("lock_timeout") ? "bounded-lock-wait" : statement.includes("17001") ? "payment-lock" : "teacher-lock");
      },
      user: { findFirst: async () => { order.push("user-read"); return null; } },
      subscriptionPlan: { findUnique: async () => { order.push("plan-read"); return null; } },
    });
  } } as unknown as PrismaClient;
  assert.equal(await loadBillingModule(client).activatePaidCheckout(paidCheckout("one"), billingEvent("one")), "invalid");
  assert.deepEqual(order, ["bounded-lock-wait", "payment-lock", "teacher-lock", "user-read", "plan-read"]);
});

test("checkout reconciliation still uses the same authoritative activation primitive", () => {
  const route = fs.readFileSync("src/app/api/billing/route.ts", "utf8");
  assert.match(route, /import \{ activatePaidCheckout \} from "@\/lib\/paymongo-subscription"/);
  assert.match(route, /await activatePaidCheckout\(paid,/);
});
