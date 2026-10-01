const DAY_MS = 86_400_000;

export function entitlementDay(date: Date): Date {
  return new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS);
}

export type EntitlementGrant = {
  key: string;
  paidAt: Date;
  durationDays: number;
  revokedOn: Date | null;
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
): Date {
  const day = (date: Date) => entitlementDay(date).getTime() / DAY_MS;
  const today = day(now);
  let cursor = day(baselineAt);
  if (cursor > today) throw new Error("PayMongo entitlement baseline is in the future");
  const queue = [{ key: "legacy-baseline", remaining: Math.max(0, day(baselineEnd) - cursor) }];
  const identities = new Set<string>();
  const events: { day: number; kind: "purchase" | "refund"; key: string; duration: number }[] = [];
  for (const grant of grants) {
    const purchased = day(grant.paidAt);
    if (identities.has(grant.key) || !Number.isSafeInteger(grant.durationDays) || grant.durationDays <= 0
      || purchased < cursor || purchased > today) {
      throw new Error("Invalid PayMongo entitlement grant snapshot");
    }
    identities.add(grant.key);
    events.push({ day: purchased, kind: "purchase", key: grant.key, duration: grant.durationDays });
    if (grant.revokedOn) {
      const revoked = day(grant.revokedOn);
      if (revoked < purchased || revoked > today) throw new Error("Invalid PayMongo grant refund date");
      events.push({ day: revoked, kind: "refund", key: grant.key, duration: 0 });
    }
  }
  events.sort((a, b) => a.day - b.day || (a.kind === b.kind ? 0 : a.kind === "purchase" ? -1 : 1)
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
    } else {
      const entry = byKey.get(event.key);
      if (!entry) throw new Error("PayMongo refund has no entitlement grant");
      entry.remaining = 0;
    }
  }
  consumeUntil(today);
  return new Date((today + queue.reduce((total, entry) => total + entry.remaining, 0)) * DAY_MS);
}
