import assert from "node:assert/strict";
import test from "node:test";
import { rebuildEntitlement, type ManualEntitlementAdjustment, type EntitlementGrant } from "../src/lib/paymongo-entitlement.ts";

const day = 86_400_000;
const start = new Date("2030-01-01T00:00:00Z");
const at = (days: number) => new Date(start.getTime() + days * day);
const adjustment = (sequence: number, kind: "grant" | "revoke", days = 0): ManualEntitlementAdjustment => ({
  key: `manual:${sequence}`, sequence: BigInt(sequence), kind, durationDays: kind === "grant" ? 30 : null, effectiveOn: at(days),
});
const purchase = (sequence: number, days = 0, refundDay: number | null = null): EntitlementGrant => ({
  key: `provider:${sequence}`, sequence: BigInt(sequence), paidAt: at(days), durationDays: 30, revokedOn: refundDay === null ? null : at(refundDay),
});

test("same-day Admin revoke and new purchase replay their persisted serialization order", () => {
  assert.equal(rebuildEntitlement(start, at(10), [purchase(1)], start, [adjustment(2, "revoke")]).getTime(), start.getTime());
  assert.equal(rebuildEntitlement(start, at(10), [purchase(2)], start, [adjustment(1, "revoke")]).getTime(), at(30).getTime());
});
test("provider refund clears only that provider contribution, preserving manual access", () => {
  assert.equal(rebuildEntitlement(start, start, [purchase(2, 0, 0)], start, [adjustment(1, "grant")]).getTime(), at(30).getTime());
});
test("revoke preserves historical facts but old grants cannot revive after a later new payment", () => {
  const grants = [purchase(1), purchase(3, 5)];
  const facts = structuredClone(grants);
  assert.equal(rebuildEntitlement(start, at(15), grants, at(5), [adjustment(2, "revoke", 2)]).getTime(), at(35).getTime());
  assert.deepEqual(grants, facts);
});
test("post-revoke manual grant cannot be deducted by an old provider refund", () => {
  const adjustments = [adjustment(2, "revoke", 2), adjustment(3, "grant", 3)];
  assert.equal(rebuildEntitlement(start, start, [purchase(1, 0, 4)], at(4), adjustments).getTime(), at(33).getTime());
});
test("manual access participates in FIFO consumption across calendar days", () => {
  assert.equal(rebuildEntitlement(start, start, [purchase(2, 10, 20)], at(20), [adjustment(1, "grant")]).getTime(), at(30).getTime());
});
test("physical DB input order cannot change manual/provider replay", () => {
  const grants = [purchase(1), purchase(4, 3)];
  const adjustments = [adjustment(2, "revoke", 1), adjustment(3, "grant", 2)];
  assert.equal(rebuildEntitlement(start, start, grants, at(5), adjustments).getTime(),
    rebuildEntitlement(start, start, grants.reverse(), at(5), adjustments.reverse()).getTime());
});
test("provider-only same-day FIFO remains canonical by payment identity, not new sequence", () => {
  const grants = [{ ...purchase(2, 0, 15), key: "a" }, { ...purchase(1), key: "z" }];
  assert.equal(rebuildEntitlement(start, start, grants, at(15)).getTime(), at(45).getTime());
  assert.equal(rebuildEntitlement(start, start, grants.map(g => ({ ...g, sequence: null })), at(15)).getTime(), at(45).getTime());
});
test("legacy tracked payments without sequence remain before new same-day Admin overrides", () => {
  assert.equal(rebuildEntitlement(start, start, [{ ...purchase(1), sequence: null }], start, [adjustment(1, "revoke")]).getTime(), start.getTime());
});
test("inconsistent manual facts and duplicate sequence identities fail closed", () => {
  for (const invalid of [
    { ...adjustment(1, "grant"), durationDays: 0 },
    { ...adjustment(1, "revoke"), durationDays: 30 },
    { ...adjustment(1, "grant"), sequence: BigInt(0) },
    { ...adjustment(1, "grant"), kind: "unknown" },
    adjustment(1, "grant", 1),
  ]) assert.throws(() => rebuildEntitlement(start, start, [], start, [invalid]));
  assert.throws(() => rebuildEntitlement(start, start, [purchase(1)], start, [adjustment(1, "grant")]));
});
