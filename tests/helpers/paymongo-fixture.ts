import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { PrismaClient } from "@prisma/client";
import type { PaidCheckout, RefundedPayment } from "../../src/lib/paymongo-events.ts";

type Event = { id: string; type: string; source: string };
export type BillingModule = {
  activatePaidCheckout(paid: PaidCheckout, event: Event, client?: PrismaClient): Promise<"activated" | "already_processed" | "invalid">;
  refundPaidCheckout(refund: RefundedPayment, event: Event, client?: PrismaClient): Promise<"refunded" | "already_processed">;
};

// Load the production mutation functions without importing .env or opening
// the application's configured database. Tests must supply their own client.
export function loadBillingModule(client: PrismaClient): BillingModule {
  const exports = {};
  const entitlement = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/paymongo-entitlement.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: entitlement, Date, Error });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/paymongo-subscription.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    exports, Date, Promise, Number, Math, Error,
    require(name: string) {
      if (name === "@/lib/prisma") return { __esModule: true, default: client };
      if (name === "@/lib/paymongo-entitlement") return entitlement;
      throw new Error(`Unexpected billing dependency: ${name}`);
    },
  });
  return exports as BillingModule;
}

export const paidCheckout = (id: string, userId = "teacher", planId = 1): PaidCheckout => ({
  userId, planId, providerPaymentId: `pay-${id}`, reference: `ref-${id}`,
  amountCentavos: 50_000, paymentMethod: "card", paymentStatus: "paid",
});
export const billingEvent = (id: string, type = "checkout_session.payment.paid"): Event => ({
  id: `event-${id}`, type, source: "isolated-test",
});
