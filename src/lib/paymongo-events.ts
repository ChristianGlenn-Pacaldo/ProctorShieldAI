export type PaymongoEventEnvelope = {
  id: string;
  type: string;
  livemode: boolean;
  resource: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

export function parsePaymongoEventEnvelope(value: unknown): PaymongoEventEnvelope | null {
  const root = asRecord(value);
  const data = asRecord(root?.data);
  const attributes = asRecord(data?.attributes);
  const resource = asRecord(attributes?.data);
  if (
    typeof data?.id !== "string"
    || typeof attributes?.type !== "string"
    || typeof attributes.livemode !== "boolean"
    || !resource
  ) return null;
  return { id: data.id, type: attributes.type, livemode: attributes.livemode, resource };
}

export type PaidCheckout = {
  userId: string;
  planId: number;
  providerPaymentId: string;
  reference: string;
  amountCentavos: number;
  paymentMethod: string;
  paymentStatus: string;
};

export function parsePaidCheckout(resource: Record<string, unknown>): PaidCheckout | null {
  const checkout = asRecord(resource.attributes);
  const metadata = asRecord(checkout?.metadata);
  const payments = Array.isArray(checkout?.payments) ? checkout.payments : [];
  const payment = payments
    .map(asRecord)
    .find((candidate) => asRecord(candidate?.attributes)?.status === "paid")
    ?? asRecord(payments[0]);
  const paymentAttributes = asRecord(payment?.attributes);
  const source = asRecord(paymentAttributes?.source);
  const planId = Number(metadata?.planId);
  const amountCentavos = Number(paymentAttributes?.amount);
  if (
    typeof metadata?.userId !== "string"
    || !Number.isInteger(planId)
    || typeof payment?.id !== "string"
    || paymentAttributes?.currency !== "PHP"
    || !Number.isSafeInteger(amountCentavos)
    || amountCentavos <= 0
  ) return null;
  return {
    userId: metadata.userId,
    planId,
    providerPaymentId: payment.id,
    reference: typeof checkout?.reference_number === "string" ? checkout.reference_number : payment.id,
    amountCentavos,
    paymentMethod: typeof source?.type === "string" ? source.type : "paymongo",
    paymentStatus: typeof paymentAttributes?.status === "string" ? paymentAttributes.status : "unknown",
  };
}

// A paid webhook can carry a checkout snapshot taken before PayMongo attaches its payment.
// Only use a fresh provider lookup when it matches the signed event's checkout and metadata.
export function parsePaidCheckoutFromCurrentSession(
  eventResource: Record<string, unknown>,
  currentResource: Record<string, unknown>,
  eventIsLive: boolean,
): PaidCheckout | null {
  const eventAttributes = asRecord(eventResource.attributes);
  const eventMetadata = asRecord(eventAttributes?.metadata);
  const currentAttributes = asRecord(currentResource.attributes);
  const currentMetadata = asRecord(currentAttributes?.metadata);
  if (
    typeof eventResource.id !== "string"
    || !eventResource.id.startsWith("cs_")
    || eventResource.type !== "checkout_session"
    || currentResource.id !== eventResource.id
    || currentResource.type !== "checkout_session"
    || currentAttributes?.livemode !== eventIsLive
    || typeof eventMetadata?.userId !== "string"
    || !Number.isInteger(Number(eventMetadata.planId))
    || currentMetadata?.userId !== eventMetadata.userId
    || Number(currentMetadata?.planId) !== Number(eventMetadata.planId)
  ) return null;

  const paid = parsePaidCheckout(currentResource);
  return paid?.paymentStatus === "paid" ? paid : null;
}

export type RefundedPayment = { providerPaymentId: string; refundedCentavos: number };

export function parseRefundedPayment(resource: Record<string, unknown>): RefundedPayment | null {
  const attributes = asRecord(resource.attributes);
  const amount = Number(attributes?.amount_refunded ?? attributes?.amount);
  if (typeof resource.id !== "string" || !Number.isSafeInteger(amount) || amount <= 0) return null;
  return { providerPaymentId: resource.id, refundedCentavos: amount };
}
