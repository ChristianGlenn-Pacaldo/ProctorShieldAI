# PayMongo grant accounting

## Rules and durable facts

The previous refund implementation subtracted a plan duration from aggregate
expiry. After part of an old payment's access had been consumed, that could
subtract access contributed by a later payment. Clamping expiry to today made
the result depend on whether renewal or refund acquired the Teacher lock first.

New PayMongo purchases snapshot `Payment.grantDurationDays`. Their existing
`paidAt` is the local acceptance time, as before; it is not reinterpreted as a
provider timestamp. The first transition to a full cumulative refund snapshots
`grantRevokedOn`. These facts persist alongside the financial refund state.
The duration snapshot is independent of subsequent plan edits.

Expiry uses UTC calendar days, matching the existing PostgreSQL DATE expiry.
Replay starts with the historical baseline, then sorts accepted purchases and
full refunds by day, with deterministic payment identity ordering for ties.
Access is consumed FIFO between event days. A full refund clears only the
remaining balance of its own grant. Consumed access never becomes debt, and
another grant's balance is never cleared by that refund. Same-day purchases
precede refunds in replay; no access elapses between same-day facts.

Partial cumulative refunds retain access until the refund is full. This is the
existing rule: there was no proportional partial-refund entitlement deduction.
Increasing partial amounts update financial state and audit records only.
The first full refund records one revocation; duplicates and lower snapshots
neither change that date nor deduct again.

For the same durable dated facts, replay has one canonical event sequence and
therefore one expiry, independent of database lock acquisition or delivery
order. Calendar time still consumes access normally. Dates are acceptance and
first-full-refund dates, not fabricated provider-effective dates.

## Transactions

Activation, reconciliation and refunds use the same payment-then-Teacher lock
order. All grant facts, subscription expiry, financial changes, event receipts
and audits commit together. Provider HTTP remains outside transactions. Lock
waits are bounded to 10 seconds and transaction lifetime to 20 seconds.

Once accounting is initialized, a discrepancy between replay and stored expiry
causes an atomic failure requiring reviewed reconciliation. This protects
manual grants or other out-of-band changes from being silently overwritten.
Maintenance's conditional expiry status update remains compatible; it does not
alter grant facts or expiry.

## Migration and historical ambiguity

`20261001000000_paymongo_grant_accounting` adds four nullable columns, with
consistency constraints. It performs no entitlement changes or inferred
backfill. Existing payments keep null grant snapshots. Current payment amounts,
processing dates, mutable plan durations, generic audits and event receipts
cannot prove the original grant schedule or recover previously lost access.

On the next legitimate activation, the exact existing aggregate expiry is
captured as `grantBaselineEndDate`, with the current day as `grantBaselineAt`.
This preserves all existing access as an explicitly unattributed baseline.
Only new purchases receive attributable grants. A refund of a new purchase
cannot deduct that baseline. An unknown historical full refund fails and rolls
back every payment/event/audit/expiry write; it is never acknowledged as an
idempotent success. Historical partial refunds can still update financial state
without reducing access. Already-applied full refunds remain idempotent.

Before enabling historical full-refund processing, an operator must review a
complete, evidenced history for that subscription:

1. Use reliable original activation snapshots, receipts or reviewed records to
   establish original durations, acceptance dates, full-refund dates and any
   separate baseline/manual grants. Current plan values alone are insufficient.
2. Prepare a per-payment manifest with evidence references. Unknown portions
   remain unattributed; do not divide current expiry across payments by guesswork.
3. With writes paused for the affected Teacher, acquire payment locks in sorted
   identity order, then the Teacher lock, and re-read current financial state.
4. Establish a baseline preceding the evidenced grants, preserving any separate
   access. Populate only proven snapshots and full-refund dates in one transaction.
   Ensure a full-refunded tracked payment has its proven revocation date.
   If a provider refund occurred while legacy processing was blocked, reconcile
   its financial refund, grant, event receipt and audit together from the verified
   manifest; never seed a revocation without matching financial refund state.
5. Replay the proposed facts at the current day. Require exact agreement with
   current expiry (or a separately approved, evidenced correction) before commit.
   Record the manifest/review in an audit entry in that same transaction.
6. Verify fresh-client readback and retain the evidence manifest securely.

No backfill or migration has been applied to Railway or any application database
as part of this development task. The migration and regressions are exercised
only in the dedicated local disposable PostgreSQL database. Deployment requires
migration before the new application code, and an explicit operational plan for
unproven historical refunds. Provider retries must not be mistaken for resolution
of an ambiguous historical grant.

## Deployment order and compatibility

Use an identified environment and a reviewed release artifact. Before migration,
inventory historical PayMongo payments and resolve unsupported historical full
refunds without guessing grant facts. An approved disposable staging fixture may
be removed instead of backfilled; this does not resolve production history.

1. Capture and verify a recoverable database backup and its manifest, migration
   history, application SHA, and accounting inventory. Keep provider payment/event
   evidence secure for reconciliation of activity after the recovery point.
2. Pause billing writers and drain in-flight work: checkout creation, checkout
   reconciliation (including billing GET), payment/refund webhooks, and direct
   operator billing writes. Return retryable failures for unprocessed webhooks;
   do not acknowledge successful processing during the pause. If a billing-only
   admission gate is unavailable, use a planned maintenance window with writers
   stopped. A gate is effective only if every writer participates; stopping web
   traffic alone does not stop background or direct database writers.
3. Apply the reviewed migration with `prisma migrate deploy` to the verified
   target. Confirm its successful `_prisma_migrations` entry, all four columns,
   all four validated constraints, and the valid subscription/payment-date index.
   Compare historical expiry and financial values with the pre-migration snapshot.
4. Activate only an application artifact containing both this migration's Prisma
   client/schema and the grant-aware activation/refund primitives. Replace all old
   instances before reopening billing; do not run mixed billing writer versions.
5. Verify health, fresh-client accounting readback, duplicate processing, and
   purchase/refund acceptance with disposable fixtures. Reopen billing only after
   these checks pass and reconcile queued provider events through the same locked
   primitives. A provider retry is not proof that a payment was applied.

The new app requires the accounting schema. The old app can read the additive
schema, but its aggregate-expiry billing writers are not compatible once tracked
grants exist. Old activation can extend expiry without recording a duration;
old full-refund updates omit the revocation date and can violate the new CHECK
constraint. They can also subtract another grant's access or introduce drift.
Do not roll back to old writers while leaving billing enabled.

## Abort, rollback, and partially deployed releases

Prefer a compatible forward fix or a previously validated grant-aware artifact.
Keep billing paused during recovery and preserve the new columns, constraints,
baseline, grant durations, and first-full-refund dates. Do not drop accounting
columns or create a destructive reverse migration to make old code run.

| Observed state | Safe response |
| --- | --- |
| Migration not applied; old app active | Abort before rollout or resume the verified old release only after confirming no accounting changes occurred. |
| Migration successful; new app not active | Keep billing paused. Complete a compatible rollout. If aborting, old code may serve safe reads with billing writers blocked; do not automatically reopen old billing. Preserve the additive schema for the next attempt. |
| New app active; migration absent or incomplete | Block billing immediately. Confirm the exact schema and migration state, then repair/apply the reviewed migration before running the new writers. |
| Mixed old/new instances | Keep writers blocked and drain old instances. Establish a single compatible version, then check for unsnapshotted payments or expiry drift before reopening. |
| Tracked grants committed; app rollback required | Use a validated grant-aware version or forward fix. Preserve committed ledger facts and replay from them; an old aggregate-expiry writer is not a safe rollback target. |
| Migration command failed/interrupted | Inspect actual columns, constraints/index validity, and `_prisma_migrations`; do not assume either a complete rollback or complete success. Repair the proven schema state with a reviewed procedure. Use `prisma migrate resolve` only after verifying the actual state agrees with the chosen resolution. Never blindly mark a failed migration applied or repeatedly run raw DDL. |

If no compatible app can be activated, leave billing unavailable with retryable
responses rather than discard facts or acknowledge unapplied provider events.
Document the interruption and outstanding payment/refund identities securely.

## Database restore and recovery

Use the existing backup/recovery procedure and verified recovery set. The helper
`scripts/backup-restore.mjs` verifies/downloads a recovery set on an isolated
recovery runner; it intentionally refuses live Railway environments and does not
restore a live database itself. Restore and validate in isolation first. A live
database replacement requires a separate approved recovery operation with writers
quiesced and the target identity checked; this guide does not authorize one.

A pre-migration backup does not contain later accepted grants or refunds. Retain
the current database/ledger and verified provider records before replacing it.
Reconcile every post-backup accepted payment, cumulative refund, receipt and audit
from authoritative evidence in locked transactions. Use actual duration snapshots
and acceptance/revocation dates, never today's plan duration as a substitute.
Do not silently lose a paid grant or allow a replay to grant it twice. If needed
facts cannot be recovered, keep affected billing paused for reviewed resolution.

Before reopening after migration, repair, or restore:

- Verify application/schema compatibility, migration checksums/state, the paired
  nullable baseline, positive snapshotted durations with acceptance dates, and
  full-refund/revocation consistency; ensure the index is valid.
- Inventory all PayMongo rows. No supported full-refund candidate may have unknown
  attribution without an explicit reviewed operational resolution.
- Rebuild each initialized subscription from its baseline and payment facts at
  the current UTC day. Require agreement with `max(today, stored endDate)`; do not
  force expiry to match by deleting facts. Review discrepancies and manual access.
- Confirm unique payment/event identities, nonregressing cumulative refunds,
  matching entitlement/payment/audit/receipt state, and fresh independent-client
  readback. Exercise duplicate payment/refund and refund-order regressions with
  disposable fixtures, then check health and unexpected errors.
- Preserve the recovery manifest, comparisons, reconciled event identities and
  approval record securely. Open writers only after these checks pass.

## DDL and write window

The migration adds nullable columns and constraints without backfill or expiry
updates. `ALTER TABLE` requires locks; CHECK validation scans existing rows. The
ordinary `CREATE INDEX` can block payment writes and consume disk/I/O. It is not
a concurrent index build and must not be described as universally nonblocking.
Plan the window from the target's row counts and active transactions, drain long
transactions, and allow enough disk space. Configure migration-session lock and
statement limits deliberately; the application's 10-second lock timeout does not
automatically apply to the migration CLI. Abort on lock contention and inspect
the actual schema before retrying. Do not edit an already applied migration to
change index strategy; use a separately reviewed follow-up migration if needed.
