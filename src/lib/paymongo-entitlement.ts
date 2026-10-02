const DAY_MS = 86_400_000;

export function entitlementDay(date: Date): Date {
  return new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS);
}

export type EntitlementGrant = {
  key: string;
  paidAt: Date;
  durationDays: number;
  revokedOn: Date | null;
  sequence?: bigint | null;
};

export type ManualEntitlementAdjustment = {
  key: string;
  sequence: bigint;
  kind: string;
  durationDays: number | null;
  effectiveOn: Date;
};

// DATE expiry has always used whole UTC calendar days. Purchases contribute
// FIFO access; a full refund discards only its own unconsumed contribution.
// Replaying the dated facts, rather than adjusting aggregate expiry, makes
// same-day purchase/refund processing independent of transaction/event order.
export function rebuildEntitlement(
  baselineAt: Date,
  baselineEnd: Date,
  grants: EntitlementGrant[],
  now: Date,
  adjustments: ManualEntitlementAdjustment[] = [],
): Date {
  const day = (date: Date) => entitlementDay(date).getTime() / DAY_MS;
  const today = day(now);
  let cursor = day(baselineAt);
  if (cursor > today) throw new Error("PayMongo entitlement baseline is in the future");
  const queue = [{ key: "legacy-baseline", remaining: Math.max(0, day(baselineEnd) - cursor) }];
  const identities = new Set<string>();
  const events: { day: number; kind: "purchase" | "refund" | "revoke"; key: string; duration: number; sequence: bigint; manual: boolean; position: number }[] = [];
  const sequences = new Set<bigint>();
  const claimSequence = (sequence: bigint | null | undefined) => {
    if (sequence == null) return BigInt(0); // Existing tracked payments precede new adjustments on the same day.
    if (sequence <= BigInt(0) || sequences.has(sequence)) throw new Error("Invalid entitlement accounting sequence");
    sequences.add(sequence);
    return sequence;
  };
  for (const grant of grants) {
    const purchased = day(grant.paidAt);
    if (identities.has(grant.key) || !Number.isSafeInteger(grant.durationDays) || grant.durationDays <= 0
      || purchased < cursor || purchased > today) {
      throw new Error("Invalid PayMongo entitlement grant snapshot");
    }
    identities.add(grant.key);
    const sequence = claimSequence(grant.sequence);
    events.push({ day: purchased, kind: "purchase", key: grant.key, duration: grant.durationDays, sequence, manual: false, position: 0 });
    if (grant.revokedOn) {
      const revoked = day(grant.revokedOn);
      if (revoked < purchased || revoked > today) throw new Error("Invalid PayMongo grant refund date");
      events.push({ day: revoked, kind: "refund", key: grant.key, duration: 0, sequence, manual: false, position: 0 });
    }
  }
  for (const adjustment of adjustments) {
    const effective = day(adjustment.effectiveOn);
    if (effective < cursor || effective > today || identities.has(adjustment.key)
      || !["grant", "revoke"].includes(adjustment.kind)
      || (adjustment.kind === "grant" ? !Number.isSafeInteger(adjustment.durationDays) || adjustment.durationDays! <= 0 : adjustment.durationDays !== null)) {
      throw new Error("Invalid manual entitlement adjustment");
    }
    identities.add(adjustment.key);
    events.push({ day: effective, kind: adjustment.kind === "grant" ? "purchase" : "revoke",
      key: adjustment.key, duration: adjustment.durationDays ?? 0, sequence: claimSequence(adjustment.sequence), manual: true, position: 0 });
  }
  const boundaries = new Map<number, bigint[]>();
  for (const event of events) if (event.manual) {
    const sequences = boundaries.get(event.day) ?? [];
    sequences.push(event.sequence);
    boundaries.set(event.day, sequences);
  }
  for (const sequences of boundaries.values()) sequences.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  for (const event of events) {
    const sequences = boundaries.get(event.day) ?? [];
    let lower = 0, upper = sequences.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (sequences[middle] < event.sequence) lower = middle + 1;
      else upper = middle;
    }
    event.position = lower * 2 + (event.manual ? 1 : 0);
  }
  // Refunds clear only their payment's balance and commute with same-day
  // adjustments. Admin facts separate provider groups in their serialized
  // order. Within each group retain the existing canonical payment-key FIFO,
  // independent of which concurrent provider transaction acquired the lock.
  events.sort((a, b) => a.day - b.day || (a.kind === "refund" ? 1 : 0) - (b.kind === "refund" ? 1 : 0)
    || (a.kind === "refund" && b.kind === "refund" ? 0 : a.position - b.position)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let head = 0;
  const byKey = new Map<string, { key: string; remaining: number }>();
  const consumeUntil = (until: number) => {
    let elapsed = until - cursor;
    while (elapsed > 0 && head < queue.length) {
      const entry = queue[head];
      const consumed = Math.min(elapsed, entry.remaining);
      entry.remaining -= consumed;
      elapsed -= consumed;
      if (entry.remaining === 0) head++;
    }
    cursor = until;
  };
  for (const event of events) {
    consumeUntil(event.day);
    if (event.kind === "purchase") {
      const entry = { key: event.key, remaining: event.duration };
      queue.push(entry);
      byKey.set(event.key, entry);
    } else if (event.kind === "revoke") {
      for (const entry of queue) entry.remaining = 0;
      head = queue.length;
    } else {
      const entry = byKey.get(event.key);
      if (!entry) throw new Error("PayMongo refund has no entitlement grant");
      entry.remaining = 0;
    }
  }
  consumeUntil(today);
  return new Date((today + queue.reduce((total, entry) => total + entry.remaining, 0)) * DAY_MS);
}
