# Manual entitlement accounting

## Product rules

The two existing Admin PUT routes remain state toggles. Granting Pro while any
effective paid subscription is active is a no-op: no extension, adjustment or
subscription audit is created. Otherwise the existing 30-day manual duration is
granted. Repeating an unchanged grant or revoke is also a no-op.

Revoking Pro ends effective access immediately across active paid subscriptions.
It records a `revoke` adjustment that clears remaining baseline, manual and
provider contribution balances in replay. It does not modify Payment rows,
duration snapshots, payment acceptance dates, refunds or provider receipts.
Cleared access does not become debt and is not resurrected by a duplicate old
payment. A new legitimate payment after revoke contributes its own full duration
and can activate access again. Manual adjustments are never financial payments.

## Durable representation and transaction boundary

`manual_subscription_adjustments` is an append-only application ledger of grant
and revoke facts, with actor identity, effective UTC date, duration for grants,
and a per-subscription accounting sequence. The existing aggregate subscription
expiry is a checked materialized result of baseline, provider grants and manual
adjustments. Both Admin routes use `setManualSubscription` within their existing
transaction, so compound user status changes and Admin audit logs roll back with
the adjustment. The secondary Admin route now records subscription audits too.

Every manual mutation acquires advisory lock `(17002, hashtext(Teacher ID))`
before reading role/entitlement used for the mutation. Provider writers retain
payment lock `(17001, hashtext(payment ID))` followed by that same Teacher lock.
Manual writers never acquire payment locks after the Teacher lock. Multi-plan
revokes process subscriptions in sorted ID order. Lock waits are bounded to ten
seconds and subscription transactions to twenty seconds. No provider HTTP calls
occur within these transactions; Admin realtime remains after commit.

The Teacher lock protects sequence allocation. New provider grants and manual
adjustments snapshot it; existing tracked payments retain a null sequence and
their established deterministic tie order. Replay orders grant/revoke facts by
UTC day and sequence, with canonical payment-key FIFO retained between Admin
adjustment boundaries, then applies same-day payment-specific refunds. Refunds
commute with Admin revocation and cannot clear a manual contribution.

Concurrency means a linearizable sequence of the specified state toggles, not
identical output for different logical command orders:

| Accepted order | Expected effective result |
| --- | --- |
| Manual grant, then new payment | Manual 30 days plus the provider duration |
| New payment, then Admin active save | Provider duration; active save is a no-op |
| Revoke, then new payment | Only the new provider duration is active |
| New payment, then revoke | Access is ended, including that accepted purchase |

Payment/refund identities remain idempotent. An old paid webhook cannot reopen
revoked access because its payment is already recorded. Unrelated constraints,
audit failures or timeouts propagate and roll back the transaction.

## Historical treatment

The migration backfills no grants, acceptance dates, durations or revocations.
Existing expiry, financial state and baseline facts are unchanged. Before an
initialized subscription is adjusted, its existing consistency check must pass.
Unexplained historical expiry drift still requires reviewed reconciliation.

For a subscription without an initialized baseline, first accounting adoption
snapshots its currently persisted balance at today's UTC date, matching the
existing provider activation behavior. This is an opaque legacy balance, not a
claim about original manual/provider grant dates or durations. Existing valid
access is preserved. If a manual grant targets an already inactive row with a
future expiry, a current-date revoke fact records that observed inactive state
before the new 30-day grant; historical dates are not invented.

Unknown historical provider grants still fail closed on full refund. Only
authoritative evidence and a reviewed reconciliation can attribute them.
Read-only staging inspection for this implementation found zero `paid_manual`
subscriptions and one fully attributed provider payment. No staging rows were
modified.

## Deployment, rollback and verification

Apply `20261002000000_manual_entitlement_accounting` before the new application.
Use a coordinated write window covering both Admin subscription routes and
provider activation/refund/reconciliation. Drain all old writers before reopening
these routes; the previous application does not record manual adjustments or
new accounting sequences and is unsafe once this ledger is in use.

The additive ALTER TABLEs require DDL locks and CREATE INDEX uses ordinary index
creation. Choose migration lock/statement limits and an appropriate write window;
do not describe this as a universally nonblocking migration. Prisma migrate
deploy applies it once; a second deploy must report no pending migrations.

On an interrupted migration/app rollout, keep all entitlement writers blocked
until schema and application match. Roll back only to a compatible accounting
writer. Preserve the ledger and new columns; no destructive reverse migration is
provided. Use the coordinated backup/restore and provider-event reconciliation
procedure in `paymongo-grant-accounting.md` if a database recovery is required.

After recovery, replay baseline/payment/manual facts at the current UTC day and
require exact agreement with `max(today, stored expiry)`. Check sequence uniqueness,
unchanged payment attribution, duplicate processing, matching Admin audits and
fresh-client readback before reopening writes.
