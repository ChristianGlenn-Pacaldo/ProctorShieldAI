import assert from "node:assert/strict";
import test from "node:test";
import { rebuildEntitlement, type EntitlementGrant } from "../src/lib/paymongo-entitlement.ts";

const date = (day: number) => new Date(Date.UTC(2026, 0, day));
const grant = (key: string, purchased: number, duration: number, revoked: number | null = null): EntitlementGrant => ({
  key, paidAt: date(purchased), durationDays: duration, revokedOn: revoked === null ? null : date(revoked),
});

test("partially consumed refund cannot deduct another purchase's access in either fact order", () => {
  const facts = [grant("old", 1, 30, 16), grant("new", 16, 30)];
  for (const order of [facts, [...facts].reverse()]) {
    assert.equal(rebuildEntitlement(date(1), date(1), order, date(16)).getTime(), date(46).getTime());
  }
});

test("fully consumed refunded access creates no retroactive debt for a later purchase", () => {
  assert.equal(rebuildEntitlement(date(1), date(1), [grant("old", 1, 30, 40), grant("new", 40, 30)], date(40)).getTime(), date(70).getTime());
});

test("refunding a queued grant preserves the older grant's unused contribution", () => {
  assert.equal(rebuildEntitlement(date(1), date(1), [grant("a", 1, 30), grant("b", 10, 30, 16)], date(16)).getTime(), date(31).getTime());
});

test("canonical grant order and dated replay preserve overlapping grants through multiple refunds", () => {
  const facts = [grant("a", 1, 30, 16), grant("b", 1, 30, 20), grant("c", 16, 45)];
  const expected = rebuildEntitlement(date(1), date(1), facts, date(21));
  for (const order of [facts.slice().reverse(), [facts[1], facts[2], facts[0]]]) {
    assert.equal(rebuildEntitlement(date(1), date(1), order, date(21)).getTime(), expected.getTime());
  }
  assert.equal(expected.getTime(), date(65).getTime());
});

test("opaque historical baseline remains intact when a new tracked grant is refunded", () => {
  assert.equal(rebuildEntitlement(date(16), date(31), [grant("new", 16, 30, 16)], date(16)).getTime(), date(31).getTime());
});

test("invalid or future facts are rejected instead of fabricating entitlement", () => {
  assert.throws(() => rebuildEntitlement(date(1), date(1), [grant("a", 1, 30), grant("a", 1, 30)], date(16)));
  assert.throws(() => rebuildEntitlement(date(1), date(1), [grant("a", 20, 30)], date(16)));
  assert.throws(() => rebuildEntitlement(date(1), date(1), [grant("a", 2, 30, 1)], date(16)));
});
