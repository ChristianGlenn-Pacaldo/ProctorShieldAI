import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { billingEvent, loadBillingModule, paidCheckout } from "./helpers/paymongo-fixture.ts";
import { rebuildEntitlement } from "../src/lib/paymongo-entitlement.ts";
import { isTrustedAuthOrigin } from "../src/lib/auth-origin.ts";

const configured = process.env.PAYMONGO_CONCURRENCY_TEST_DATABASE_URL;
const day = 86_400_000;
const future = new Date("2035-01-01T00:00:00Z");

test("PayMongo atomic mutations with independent PostgreSQL connections", {
  skip: !configured ? "Dedicated disposable local PayMongo PostgreSQL is not configured" : false,
  timeout: 120_000,
}, async (t) => {
  // Never read DATABASE_URL, .env, Railway, or any application/test database.
  const url = new URL(configured!);
  assert.equal(process.env.PAYMONGO_CONCURRENCY_TEST_DATABASE_APPROVED, "true");
  assert.equal(url.protocol, "postgresql:");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/proctorshield_paymongo_atomic_test");
  const schema = `paymongo_atomic_${crypto.randomBytes(8).toString("hex")}`;
  const admin = new Client({ connectionString: configured });
  const newClient = () => new PrismaClient({ adapter: new PrismaPg({ connectionString: configured, max: 1 }, { schema }) });
  const one = newClient(), two = newClient();
  const billing = loadBillingModule(one);
  let created = false;
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    await admin.query(`SET search_path TO "${schema}"`);
    await admin.query(`
      CREATE TABLE roles(id SERIAL PRIMARY KEY,role_name TEXT UNIQUE NOT NULL,description TEXT,created_at TIMESTAMP NOT NULL DEFAULT now());
      CREATE TABLE users(id TEXT PRIMARY KEY,full_name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,google_id TEXT UNIQUE,profile_image TEXT,role_id INTEGER NOT NULL REFERENCES roles(id),status TEXT NOT NULL DEFAULT 'active',is_online BOOLEAN NOT NULL DEFAULT false,last_seen_at TIMESTAMP,created_at TIMESTAMP NOT NULL DEFAULT now(),updated_at TIMESTAMP NOT NULL DEFAULT now(),session_version INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE subscription_plans(id SERIAL PRIMARY KEY,plan_name TEXT NOT NULL,yearly_price DECIMAL(10,2),features TEXT,duration_days INTEGER,created_at TIMESTAMP NOT NULL DEFAULT now());
      CREATE TABLE user_subscriptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),start_date DATE NOT NULL,end_date DATE NOT NULL,payment_status TEXT,subscription_status TEXT,UNIQUE(user_id,plan_id));
      CREATE TABLE payments(id TEXT PRIMARY KEY,subscription_id TEXT NOT NULL REFERENCES user_subscriptions(id),amount DECIMAL(10,2) NOT NULL,payment_method TEXT,payment_status TEXT,transaction_reference TEXT UNIQUE,provider_payment_id TEXT UNIQUE,refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0,refunded_at TIMESTAMP,paid_at TIMESTAMP);
      CREATE TABLE webhook_events(id TEXT PRIMARY KEY,provider TEXT NOT NULL,event_id TEXT UNIQUE NOT NULL,event_type TEXT NOT NULL,processed_at TIMESTAMP NOT NULL DEFAULT now());
      CREATE TABLE activity_logs(id BIGSERIAL PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),activity TEXT NOT NULL,ip_address TEXT,created_at TIMESTAMP NOT NULL DEFAULT now());
      INSERT INTO roles(role_name) VALUES('teacher'),('admin');
      INSERT INTO users(id,full_name,email,password,role_id) VALUES('teacher','Disposable Teacher','disposable@example.invalid','unused',1),('other','Other Teacher','other@example.invalid','unused',1);
      INSERT INTO users(id,full_name,email,password,role_id) VALUES('admin','Disposable Admin','admin@example.invalid','unused',2);
      INSERT INTO subscription_plans(plan_name,yearly_price,duration_days) VALUES('Premium Monthly',500,30),('Alternate',500,45);
    `);
    await admin.query("INSERT INTO user_subscriptions(id,user_id,plan_id,start_date,end_date,payment_status,subscription_status) VALUES('migration-sub','teacher',1,CURRENT_DATE-15,CURRENT_DATE+15,'paid','active')");
    await admin.query("INSERT INTO payments(id,subscription_id,amount,provider_payment_id,payment_status,paid_at) VALUES('migration-payment','migration-sub',500,'pay-migration','paid',now()-interval '15 days')");
    const originalExpiry = (await admin.query("SELECT end_date::text FROM user_subscriptions WHERE id='migration-sub'")).rows[0].end_date;
    // Apply the actual additive migration against existing rows. Never use
    // prisma migrate commands that could load the application's .env URL.
    await admin.query(fs.readFileSync("prisma/migrations/20261001000000_paymongo_grant_accounting/migration.sql", "utf8"));
    await admin.query(fs.readFileSync("prisma/migrations/20261002000000_manual_entitlement_accounting/migration.sql", "utf8"));
    await t.test("additive migration preserves historical expiry and leaves attribution explicitly unknown", async () => {
      const subscription = await one.userSubscription.findUniqueOrThrow({ where: { id: "migration-sub" } });
      const payment = await one.payment.findUniqueOrThrow({ where: { id: "migration-payment" } });
      assert.equal(subscription.endDate.toISOString().slice(0, 10), originalExpiry);
      assert.equal(subscription.grantBaselineAt, null); assert.equal(subscription.grantBaselineEndDate, null);
      assert.equal(payment.grantDurationDays, null); assert.equal(payment.grantRevokedOn, null);
      assert.equal(Number(payment.amount), 500);
      await assert.rejects(one.payment.update({ where: { id: payment.id }, data: { grantDurationDays: 30, refundedAmount: 500 } }));
      await assert.rejects(one.payment.update({ where: { id: payment.id }, data: { grantDurationDays: 30, grantRevokedOn: new Date() } }));
      assert.equal((await one.payment.findUniqueOrThrow({ where: { id: payment.id } })).grantDurationDays, null);
    });
    const reset = async (expiry: Date | null = future) => {
      await admin.query("TRUNCATE activity_logs,webhook_events,payments,manual_subscription_adjustments,user_subscriptions");
      if (expiry) await admin.query("INSERT INTO user_subscriptions(id,user_id,plan_id,start_date,end_date,payment_status,subscription_status) VALUES('sub','teacher',1,CURRENT_DATE,$1,'paid','active')", [expiry]);
    };
    const expiry = async () => (await one.userSubscription.findUniqueOrThrow({ where: { userId_planId: { userId: "teacher", planId: 1 } } })).endDate;
    const counts = async () => ({ subscriptions: await one.userSubscription.count(), payments: await one.payment.count(), events: await one.webhookEvent.count(), audits: await one.activityLog.count() });
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const seedConsumedGrant = async () => {
      await reset(null);
      await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
      // Proven fixture history: the tracked 30-day grant was accepted 15 days
      // ago. This is not an inference/backfill of unknown historical data.
      const purchased = new Date(today.getTime() - 15 * day);
      await one.payment.update({ where: { providerPaymentId: "pay-old" }, data: { paidAt: purchased } });
      await one.userSubscription.update({
        where: { userId_planId: { userId: "teacher", planId: 1 } },
        data: { startDate: purchased, grantBaselineAt: purchased, grantBaselineEndDate: purchased,
          endDate: new Date(today.getTime() + 15 * day) },
      });
    };

    // Pause the first real transaction after taking the Teacher lock; observe
    // the second connection in pg_locks before releasing the first. This is
    // genuinely overlapping work, not Promise.all over sequential mocks.
    const overlap = async <A, B>(first: (client: PrismaClient) => Promise<A>, second: (client: PrismaClient) => Promise<B>, pauseAfterUpsert = false) => {
      let entered!: () => void, rejectHeld!: (error: unknown) => void, release!: () => void;
      const held = new Promise<void>((resolve, reject) => { entered = resolve; rejectHeld = reject; });
      const resume = new Promise<void>((resolve) => { release = resolve; });
      const gated = new Proxy(one, {
        get(target, key) {
          if (key !== "$transaction") return Reflect.get(target, key);
          return (work: (tx: Prisma.TransactionClient) => Promise<A>, options: object) => target.$transaction(async (tx) => work(new Proxy(tx, {
            get(transaction, field) {
              if (field === "userSubscription" && pauseAfterUpsert) return new Proxy(transaction.userSubscription, {
                get(delegate, method) {
                  if (method !== "upsert") return Reflect.get(delegate, method);
                  return async (args: Prisma.UserSubscriptionUpsertArgs) => {
                    const result = await delegate.upsert(args); entered(); await resume; return result;
                  };
                },
              });
              if (field !== "$executeRaw") return Reflect.get(transaction, field);
              return async (sql: TemplateStringsArray, ...values: unknown[]) => {
                const result = await transaction.$executeRaw(sql, ...values);
                if (!pauseAfterUpsert && sql.join("").includes("17002")) {
                  const timeout = await transaction.$queryRaw<{ lock_timeout: string }[]>`SHOW lock_timeout`;
                  assert.equal(timeout[0].lock_timeout, "10s");
                  entered(); await resume;
                }
                return result;
              };
            },
          })), options);
        },
      });
      const a = first(gated); void a.catch(rejectHeld);
      await held;
      // This client's pool has max=1: identify the exact independent backend
      // whose transaction must wait, even if another test schema is active.
      const [backend] = await two.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      const b = second(two);
      void b.catch(() => {});
      let observationFailure: unknown;
      try {
        let waiting = false;
        for (let i = 0; i < 200; i++) {
          const locks = await admin.query("SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted AND (locktype='transactionid' OR (locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())))", [backend.pid]);
          if (locks.rowCount) { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(waiting, true, "second PostgreSQL connection must actually wait for serialization");
      } catch (error) { observationFailure = error; } finally { release(); }
      const result = await Promise.all([a, b]);
      if (observationFailure !== undefined) throw observationFailure;
      return result;
    };
    await t.test("two distinct concurrent renewals retain both paid grants", async () => {
      await reset();
      assert.deepEqual(await overlap(c => billing.activatePaidCheckout(paidCheckout("one"), billingEvent("one"), c), c => billing.activatePaidCheckout(paidCheckout("two"), billingEvent("two"), c)), ["activated", "activated"]);
      assert.equal((await expiry()).getTime(), future.getTime() + 60 * day);
      assert.deepEqual(await counts(), { subscriptions: 1, payments: 2, events: 2, audits: 2 });
    });
    await t.test("concurrent first-time activation retains both payments and sixty days", async () => {
      await reset(null);
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      assert.deepEqual(await overlap(c => billing.activatePaidCheckout(paidCheckout("first"), billingEvent("first"), c), c => billing.activatePaidCheckout(paidCheckout("second"), billingEvent("second"), c)), ["activated", "activated"]);
      assert.equal((await expiry()).getTime(), today.getTime() + 60 * day);
      assert.deepEqual(await counts(), { subscriptions: 1, payments: 2, events: 2, audits: 2 });
    });
    await t.test("webhook/reconciliation and exact event replay extend once", async () => {
      await reset();
      const payment = paidCheckout("duplicate");
      assert.deepEqual(await overlap(c => billing.activatePaidCheckout(payment, billingEvent("webhook"), c), c => billing.activatePaidCheckout(payment, billingEvent("reconcile", "checkout_session.payment.confirmed"), c)), ["activated", "already_processed"]);
      assert.equal(await billing.activatePaidCheckout(payment, billingEvent("webhook"), two), "already_processed");
      assert.equal((await expiry()).getTime(), future.getTime() + 30 * day);
      assert.deepEqual(await counts(), { subscriptions: 1, payments: 1, events: 2, audits: 1 });
    });
    await t.test("legitimate purchase plus full refund preserves net entitlement in both orders", async () => {
      for (const refundFirst of [false, true]) {
        await reset(); await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
        const purchase = (c: PrismaClient) => billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"), c);
        const refund = (c: PrismaClient) => billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 50_000 }, billingEvent("refund", "payment.refunded"), c);
        await overlap(refundFirst ? refund : purchase, refundFirst ? purchase : refund);
        assert.equal((await expiry()).getTime(), future.getTime() + 30 * day);
        assert.deepEqual(await counts(), { subscriptions: 1, payments: 2, events: 3, audits: 3 });
      }
    });
    await t.test("duplicate and out-of-order refunds never subtract twice", async () => {
      await reset(); await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
      const refund = { providerPaymentId: "pay-old", refundedCentavos: 50_000 };
      assert.deepEqual(await overlap(c => billing.refundPaidCheckout(refund, billingEvent("refund-one", "payment.refunded"), c), c => billing.refundPaidCheckout(refund, billingEvent("refund-two", "payment.refund.updated"), c)), ["refunded", "already_processed"]);
      assert.equal(await billing.refundPaidCheckout(refund, billingEvent("refund-one", "payment.refunded"), two), "already_processed");
      assert.equal(await billing.refundPaidCheckout({ ...refund, refundedCentavos: 10_000 }, billingEvent("late-partial", "payment.refund.updated"), two), "already_processed");
      assert.equal(await billing.refundPaidCheckout(refund, billingEvent("full-again", "payment.refunded"), two), "already_processed");
      assert.equal((await expiry()).getTime(), future.getTime());
      assert.equal(Number((await one.payment.findUniqueOrThrow({ where: { providerPaymentId: "pay-old" } })).refundedAmount), 500);
      assert.equal(await one.activityLog.count(), 2);
    });
    await t.test("two distinct concurrent full refunds retain both entitlement deductions", async () => {
      await reset();
      await billing.activatePaidCheckout(paidCheckout("one"), billingEvent("one"));
      await billing.activatePaidCheckout(paidCheckout("two"), billingEvent("two"));
      assert.deepEqual(await overlap(
        c => billing.refundPaidCheckout({ providerPaymentId: "pay-one", refundedCentavos: 50_000 }, billingEvent("refund-one", "payment.refunded"), c),
        c => billing.refundPaidCheckout({ providerPaymentId: "pay-two", refundedCentavos: 50_000 }, billingEvent("refund-two", "payment.refunded"), c),
      ), ["refunded", "refunded"]);
      assert.equal((await expiry()).getTime(), future.getTime());
      assert.equal(await one.payment.count({ where: { paymentStatus: "refunded" } }), 2);
      assert.deepEqual(await counts(), { subscriptions: 1, payments: 2, events: 4, audits: 4 });
    });
    await t.test("partial refund preserves access and a later full refund subtracts one duration", async () => {
      await reset(); await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
      await billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 10_000 }, billingEvent("partial", "payment.refund.updated"));
      assert.equal((await expiry()).getTime(), future.getTime() + 30 * day);
      await billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 50_000 }, billingEvent("full", "payment.refunded"));
      assert.equal((await expiry()).getTime(), future.getTime());
    });
    await t.test("unrelated uniqueness failures roll back and are not acknowledged as duplicates", async () => {
      await reset(); await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
      const before = await counts(), beforeExpiry = await expiry();
      await assert.rejects(billing.activatePaidCheckout({ ...paidCheckout("new"), reference: "ref-old" }, billingEvent("new")), (e: unknown) => (e as { code: string }).code === "P2002");
      assert.deepEqual(await counts(), before); assert.equal((await expiry()).getTime(), beforeExpiry.getTime());
      await assert.rejects(billing.activatePaidCheckout(paidCheckout("new"), billingEvent("old")), /receipt has no matching payment/);
      await assert.rejects(billing.activatePaidCheckout(paidCheckout("old", "other"), billingEvent("other")), /identity conflicts/);
      assert.deepEqual(await counts(), before);
    });
    await t.test("audit failure rolls back every activation and refund write", async () => {
      for (const initialExpiry of [future, null]) {
        await reset(initialExpiry);
        await admin.query("ALTER TABLE activity_logs ADD CONSTRAINT injected_failure CHECK (activity = 'forced failure')");
        try {
          await assert.rejects(billing.activatePaidCheckout(paidCheckout("failed"), billingEvent("failed")));
          if (initialExpiry) assert.equal((await expiry()).getTime(), initialExpiry.getTime());
          assert.deepEqual(await counts(), { subscriptions: initialExpiry ? 1 : 0, payments: 0, events: 0, audits: 0 });
        } finally { await admin.query("ALTER TABLE activity_logs DROP CONSTRAINT injected_failure"); }
      }
      await reset();
      await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
      const before = await counts(), beforeExpiry = await expiry();
      await admin.query("ALTER TABLE activity_logs ADD CONSTRAINT injected_failure CHECK (activity NOT LIKE 'PayMongo refund%')");
      try {
        await assert.rejects(billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 50_000 }, billingEvent("failed-refund", "payment.refunded")));
        assert.equal((await expiry()).getTime(), beforeExpiry.getTime()); assert.deepEqual(await counts(), before);
        assert.equal(Number((await one.payment.findUniqueOrThrow({ where: { providerPaymentId: "pay-old" } })).refundedAmount), 0);
      } finally { await admin.query("ALTER TABLE activity_logs DROP CONSTRAINT injected_failure"); }
    });
    await t.test("configured pricing, duration, expired base and exhausted refund semantics remain intact", async () => {
      await reset(null);
      assert.equal(await billing.activatePaidCheckout({ ...paidCheckout("invalid"), amountCentavos: 1 }, billingEvent("invalid")), "invalid");
      assert.deepEqual(await counts(), { subscriptions: 0, payments: 0, events: 0, audits: 0 });
      await billing.activatePaidCheckout(paidCheckout("alternate", "teacher", 2), billingEvent("alternate"));
      const sub = await one.userSubscription.findUniqueOrThrow({ where: { userId_planId: { userId: "teacher", planId: 2 } } });
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      assert.equal(sub.endDate.getTime(), today.getTime() + 45 * day);
      await billing.refundPaidCheckout({ providerPaymentId: "pay-alternate", refundedCentavos: 50_000 }, billingEvent("refund", "payment.refunded"));
      const cancelled = await one.userSubscription.findUniqueOrThrow({ where: { id: sub.id } });
      assert.equal(cancelled.subscriptionStatus, "cancelled"); assert.equal(cancelled.endDate.getTime(), today.getTime());
    });
    await t.test("maintenance expiry cannot overwrite renewed active access", async () => {
      await reset(new Date("2000-01-01T00:00:00Z"));
      await overlap(c => billing.activatePaidCheckout(paidCheckout("renew"), billingEvent("renew"), c), async c => {
        // Maintenance does not calculate or replace expiry. PostgreSQL rechecks
        // this conditional row update after waiting for a concurrent updater.
        return c.userSubscription.updateMany({ where: { subscriptionStatus: "active", endDate: { lt: new Date() } }, data: { subscriptionStatus: "expired" } });
      }, true);
      assert.equal((await one.userSubscription.findUniqueOrThrow({ where: { id: "sub" } })).subscriptionStatus, "active");
    });
    for (const [name, amount, expectedDays] of [["full", 50_000, 30], ["partial", 10_000, 45]] as const) {
      await t.test(`partially consumed grant plus concurrent renewal/${name} refund converges in both lock orders`, async () => {
        const outcomes: number[] = [];
        for (const refundFirst of [false, true]) {
          await seedConsumedGrant();
          const purchase = (c: PrismaClient) => billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"), c);
          const refund = (c: PrismaClient) => billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: amount }, billingEvent("refund", "payment.refunded"), c);
          await overlap(refundFirst ? refund : purchase, refundFirst ? purchase : refund);
          outcomes.push(((await expiry()).getTime() - today.getTime()) / day);
          assert.deepEqual(await counts(), { subscriptions: 1, payments: 2, events: 3, audits: 3 });
          const newPayment = await one.payment.findUniqueOrThrow({ where: { providerPaymentId: "pay-new" } });
          assert.equal(newPayment.grantDurationDays, 30); assert.equal(newPayment.grantRevokedOn, null);
        }
        assert.deepEqual(outcomes, [expectedDays, expectedDays]);
        console.log(JSON.stringify({ regression: `${name}-refund-order`, purchaseFirstDays: outcomes[0], refundFirstDays: outcomes[1] }));
      });
    }
    await t.test("refunding either of two existing grants preserves the other grant", async () => {
      for (const refunded of ["old", "other"]) {
        await seedConsumedGrant();
        await billing.activatePaidCheckout(paidCheckout("other"), billingEvent("other"));
        await overlap(c => billing.refundPaidCheckout({ providerPaymentId: `pay-${refunded}`, refundedCentavos: 50_000 }, billingEvent("refund", "payment.refunded"), c), c => billing.activatePaidCheckout(paidCheckout("other"), billingEvent("replay"), c));
        assert.equal((await expiry()).getTime(), today.getTime() + (refunded === "old" ? 30 : 15) * day);
        const survivor = await one.payment.findUniqueOrThrow({ where: { providerPaymentId: refunded === "old" ? "pay-other" : "pay-old" } });
        assert.equal(survivor.grantRevokedOn, null); assert.equal(survivor.grantDurationDays, 30);
      }
    });
    await t.test("sequential refund then renewal and renewal then refund also converge", async () => {
      const outcomes = [];
      for (const refundFirst of [false, true]) {
        await seedConsumedGrant();
        const purchase = () => billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"), two);
        const refund = () => billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 50_000 }, billingEvent("refund", "payment.refunded"), one);
        if (refundFirst) { await refund(); await purchase(); } else { await purchase(); await refund(); }
        outcomes.push((await expiry()).getTime());
      }
      assert.deepEqual(outcomes, [today.getTime() + 30 * day, today.getTime() + 30 * day]);
    });
    await t.test("fully consumed refunded grant never creates debt against a new renewal", async () => {
      for (const refundFirst of [false, true]) {
        await seedConsumedGrant();
        const purchased = new Date(today.getTime() - 35 * day);
        await one.payment.update({ where: { providerPaymentId: "pay-old" }, data: { paidAt: purchased } });
        await one.userSubscription.update({ where: { userId_planId: { userId: "teacher", planId: 1 } }, data: {
          grantBaselineAt: purchased, grantBaselineEndDate: purchased, endDate: new Date(today.getTime() - 5 * day), subscriptionStatus: "expired",
        } });
        const purchase = (c: PrismaClient) => billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"), c);
        const refund = (c: PrismaClient) => billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 50_000 }, billingEvent("refund", "payment.refunded"), c);
        await overlap(refundFirst ? refund : purchase, refundFirst ? purchase : refund);
        assert.equal((await expiry()).getTime(), today.getTime() + 30 * day);
      }
    });
    await t.test("snapshotted duration remains correct after a plan duration edit", async () => {
      await seedConsumedGrant(); await billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"));
      await one.subscriptionPlan.update({ where: { id: 1 }, data: { durationDays: 45 } });
      try {
        await billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 50_000 }, billingEvent("refund", "payment.refunded"));
        assert.equal((await expiry()).getTime(), today.getTime() + 30 * day);
        assert.equal((await one.payment.findUniqueOrThrow({ where: { providerPaymentId: "pay-new" } })).grantDurationDays, 30);
      } finally { await one.subscriptionPlan.update({ where: { id: 1 }, data: { durationDays: 30 } }); }
    });
    await t.test("increasing, duplicate and older cumulative refunds leave one immutable revocation", async () => {
      await seedConsumedGrant(); await billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"));
      await overlap(c => billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 10_000 }, billingEvent("partial-one", "payment.refund.updated"), c), c => billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 40_000 }, billingEvent("partial-two", "payment.refund.updated"), c));
      assert.equal((await expiry()).getTime(), today.getTime() + 45 * day);
      await billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 50_000 }, billingEvent("full", "payment.refunded"));
      const before = await one.payment.findUniqueOrThrow({ where: { providerPaymentId: "pay-old" } });
      await overlap(c => billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 50_000 }, billingEvent("full", "payment.refunded"), c), c => billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 20_000 }, billingEvent("late", "payment.refund.updated"), c));
      const after = await one.payment.findUniqueOrThrow({ where: { id: before.id } });
      assert.equal(after.grantRevokedOn?.getTime(), before.grantRevokedOn?.getTime());
      assert.equal(Number(after.refundedAmount), 500); assert.equal((await expiry()).getTime(), today.getTime() + 30 * day);
    });
    await t.test("refund audit failure rolls back grant revocation and all other transaction state", async () => {
      await seedConsumedGrant(); await billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"));
      const before = { payments: await one.payment.findMany({ orderBy: { id: "asc" } }), subscription: await one.userSubscription.findFirst(), counts: await counts() };
      await admin.query("ALTER TABLE activity_logs ADD CONSTRAINT injected_failure CHECK (activity NOT LIKE 'PayMongo refund%')");
      try {
        await assert.rejects(billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 50_000 }, billingEvent("failed", "payment.refunded"), two));
        assert.deepEqual({ payments: await one.payment.findMany({ orderBy: { id: "asc" } }), subscription: await one.userSubscription.findFirst(), counts: await counts() }, before);
      } finally { await admin.query("ALTER TABLE activity_logs DROP CONSTRAINT injected_failure"); }
    });
    await t.test("fresh independent client reconstructs committed refund entitlement from durable facts", async () => {
      await seedConsumedGrant();
      await overlap(c => billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"), c), c => billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 50_000 }, billingEvent("refund", "payment.refunded"), c));
      const fresh = newClient();
      try {
        const sub = await fresh.userSubscription.findFirstOrThrow();
        const payments = await fresh.payment.findMany();
        const rebuilt = rebuildEntitlement(sub.grantBaselineAt!, sub.grantBaselineEndDate!, payments.map(p => ({ key: p.providerPaymentId!, paidAt: p.paidAt!, durationDays: p.grantDurationDays!, revokedOn: p.grantRevokedOn })), today);
        assert.equal(sub.endDate.getTime(), today.getTime() + 30 * day); assert.equal(rebuilt.getTime(), sub.endDate.getTime());
        assert.equal(payments.length, 2);
      } finally { await fresh.$disconnect(); }
    });
    await t.test("unknown legacy grants preserve expiry and cannot claw back a new tracked purchase", async () => {
      await reset(new Date(today.getTime() + 15 * day));
      await one.payment.create({ data: { subscriptionId: "sub", amount: 500, providerPaymentId: "pay-legacy", paymentStatus: "paid", paidAt: new Date(today.getTime() - 15 * day) } });
      await billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"));
      assert.equal((await expiry()).getTime(), today.getTime() + 45 * day);
      const before = await counts();
      await assert.rejects(billing.refundPaidCheckout({ providerPaymentId: "pay-legacy", refundedCentavos: 50_000 }, billingEvent("legacy-full", "payment.refunded")), /verified entitlement grant backfill/);
      assert.deepEqual(await counts(), before); assert.equal((await expiry()).getTime(), today.getTime() + 45 * day);
      await billing.refundPaidCheckout({ providerPaymentId: "pay-new", refundedCentavos: 50_000 }, billingEvent("new-refund", "payment.refunded"));
      assert.equal((await expiry()).getTime(), today.getTime() + 15 * day);
      assert.equal((await one.payment.findUniqueOrThrow({ where: { providerPaymentId: "pay-legacy" } })).grantDurationDays, null);
    });
    await t.test("out-of-band entitlement changes fail atomically instead of overwriting manual access", async () => {
      await seedConsumedGrant();
      await one.userSubscription.update({ where: { userId_planId: { userId: "teacher", planId: 1 } }, data: { endDate: new Date(today.getTime() + 20 * day) } });
      const before = { counts: await counts(), payments: await one.payment.findMany(), subscription: await one.userSubscription.findFirst() };
      await assert.rejects(billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"), two), /outside grant accounting/);
      await assert.rejects(billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 50_000 }, billingEvent("refund", "payment.refunded"), two), /outside grant accounting/);
      assert.deepEqual({ counts: await counts(), payments: await one.payment.findMany(), subscription: await one.userSubscription.findFirst() }, before);
    });
    let manualEvents = 0;
    const manual = async (client: PrismaClient, action: "grant" | "revoke", secondary = false, status?: string) => {
      const route: { PUT?: (request: Request, context: object) => Promise<Response> } = {};
      vm.runInNewContext(ts.transpileModule(fs.readFileSync(secondary ? "src/app/api/users/[id]/route.ts" : "src/app/api/dashboard/admin/users/[id]/route.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText, { exports: route, Date, console: { error() {} }, require(name: string) {
        if (name === "@/lib/backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler };
        if (name === "next/server") return { NextResponse: { json: (body: unknown, options?: ResponseInit) => Response.json(body, options) } };
        if (name === "@/lib/auth") return { getAdminSession: async () => ({ userId: "admin", role: "admin" }) };
        if (name === "@/lib/auth-origin") return { isTrustedAuthOrigin };
        if (name === "@/lib/prisma") return { __esModule: true, default: client };
        if (name === "@/lib/paymongo-subscription") return billing;
        if (name === "@/lib/pusher") return { pusherServer: { trigger: async () => { manualEvents++; } } };
        throw new Error(name);
      } });
      const body = secondary ? { plan: action === "grant" ? "Premium" : "Free Tier", ...(status ? { status } : {}) }
        : { subscriptionStatus: action === "grant" ? "active" : "expired", ...(status ? { status } : {}) };
      return route.PUT!(new Request("https://test.invalid/api/users/teacher", { method: "PUT", headers: { Origin: "https://test.invalid" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "teacher" }) });
    };
    const adjustmentCount = () => one.manualSubscriptionAdjustment.count();
    const fullRefund = (client: PrismaClient) => billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 50_000 }, billingEvent("refund", "payment.refunded"), client);
    const readFacts = async (client = one) => ({ subscription: await client.userSubscription.findFirst({ where: { userId: "teacher" } }),
      payments: await client.payment.findMany({ orderBy: { id: "asc" } }),
      adjustments: await client.manualSubscriptionAdjustment.findMany({ orderBy: { sequence: "asc" } }),
      events: await client.webhookEvent.count(), audits: await client.activityLog.count() });
    await t.test("both Admin routes leave effective provider access unchanged without a manual grant/audit", async () => {
      await reset(null); await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
      const before = await readFacts();
      assert.equal((await manual(two, "grant")).status, 200);
      assert.equal((await manual(two, "grant", true)).status, 200);
      assert.deepEqual(await readFacts(), before);
    });
    await t.test("manual grant without paid access is thirty days, repeated saves are no-ops, later payment preserves it", async () => {
      for (const secondary of [false, true]) {
        await reset(null);
        assert.equal((await manual(one, "grant", secondary)).status, 200);
        assert.equal((await expiry()).getTime(), today.getTime() + 30 * day);
        assert.equal(await one.payment.count(), 0); assert.equal(await adjustmentCount(), 1);
        assert.equal(await one.activityLog.count(), 1);
        const before = await readFacts();
        assert.equal((await manual(two, "grant", secondary)).status, 200); assert.deepEqual(await readFacts(), before);
        await billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"), two);
        assert.equal((await expiry()).getTime(), today.getTime() + 60 * day);
        assert.equal(await adjustmentCount(), 1);
      }
    });
    await t.test("Admin revoke ends access, preserves provider facts, and a new payment adds only new access", async () => {
      await reset(null); await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
      const before = await one.payment.findMany();
      assert.equal((await manual(two, "revoke")).status, 200);
      assert.equal((await expiry()).getTime(), today.getTime());
      assert.equal((await one.userSubscription.findFirst())?.subscriptionStatus, "expired");
      assert.deepEqual(await one.payment.findMany(), before);
      const revoked = await readFacts();
      await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("duplicate"), two);
      assert.deepEqual((await readFacts()).subscription, revoked.subscription);
      await billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"), two);
      assert.equal((await expiry()).getTime(), today.getTime() + 30 * day);
      assert.equal((await one.userSubscription.findFirst())?.subscriptionStatus, "active");
      assert.equal(await one.payment.count(), 2);
    });
    await t.test("manual revoke versus new activation follows the authoritative serialization order", async () => {
      for (const revokeFirst of [false, true]) {
        await reset(null); await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
        const revoke = async (c: PrismaClient) => { assert.equal((await manual(c, "revoke")).status, 200); };
        const purchase = async (c: PrismaClient) => { assert.equal(await billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"), c), "activated"); };
        await overlap(revokeFirst ? revoke : purchase, revokeFirst ? purchase : revoke);
        assert.equal((await expiry()).getTime(), today.getTime() + (revokeFirst ? 30 : 0) * day);
        assert.equal(await one.payment.count(), 2); assert.equal(await adjustmentCount(), 1);
      }
    });
    await t.test("manual grant versus activation is serialized; provider-first grant is a no-op", async () => {
      for (const manualFirst of [false, true]) {
        await reset(null);
        const grant = async (c: PrismaClient) => { assert.equal((await manual(c, "grant")).status, 200); };
        const purchase = async (c: PrismaClient) => { assert.equal(await billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"), c), "activated"); };
        await overlap(manualFirst ? grant : purchase, manualFirst ? purchase : grant);
        assert.equal((await expiry()).getTime(), today.getTime() + (manualFirst ? 60 : 30) * day);
        assert.equal(await adjustmentCount(), manualFirst ? 1 : 0);
      }
    });
    await t.test("manual revoke and full refund never rewrite payment ownership or fabricate manual refunds", async () => {
      for (const revokeFirst of [false, true]) {
        // The manual grant remains after refund, making the revoke a real
        // transition in either ordering rather than an already-expired no-op.
        await reset(null); assert.equal((await manual(one, "grant")).status, 200);
        await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
        const revoke = async (c: PrismaClient) => { assert.equal((await manual(c, "revoke")).status, 200); };
        const refund = async (c: PrismaClient) => { await fullRefund(c); };
        await overlap(revokeFirst ? revoke : refund, revokeFirst ? refund : revoke);
        assert.equal((await expiry()).getTime(), today.getTime());
        const payment = await one.payment.findUniqueOrThrow({ where: { providerPaymentId: "pay-old" } });
        assert.equal(Number(payment.refundedAmount), 500); assert.equal(payment.grantDurationDays, 30);
        assert.equal(await adjustmentCount(), 2); assert.equal(await one.payment.count(), 1);
      }
    });
    await t.test("refund after a new manual grant cannot deduct manual-only access", async () => {
      await reset(null); await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
      assert.equal((await manual(one, "revoke")).status, 200);
      assert.equal((await manual(one, "grant")).status, 200);
      await fullRefund(two);
      assert.equal((await expiry()).getTime(), today.getTime() + 30 * day);
      assert.equal((await one.userSubscription.findFirst())?.subscriptionStatus, "active");
      assert.equal(await adjustmentCount(), 2);
      await billing.refundPaidCheckout({ providerPaymentId: "pay-old", refundedCentavos: 50_000 }, billingEvent("refund-replay", "payment.refunded"), two);
      assert.equal((await expiry()).getTime(), today.getTime() + 30 * day);
    });
    await t.test("two simultaneous manual grants create exactly one accounting fact and audit", async () => {
      await reset(null);
      await overlap(async c => { assert.equal((await manual(c, "grant")).status, 200); }, async c => { assert.equal((await manual(c, "grant", true)).status, 200); });
      assert.equal((await expiry()).getTime(), today.getTime() + 30 * day);
      assert.equal(await adjustmentCount(), 1); assert.equal(await one.activityLog.count(), 1);
    });
    await t.test("two simultaneous manual revokes create one adjustment and cannot remove history twice", async () => {
      await reset(null); await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
      const payments = await one.payment.findMany();
      await overlap(async c => { assert.equal((await manual(c, "revoke")).status, 200); }, async c => { assert.equal((await manual(c, "revoke", true)).status, 200); });
      assert.equal((await expiry()).getTime(), today.getTime());
      assert.equal(await adjustmentCount(), 1); assert.equal(await one.activityLog.count(), 2);
      assert.deepEqual(await one.payment.findMany(), payments);
    });
    await t.test("manual grant overlapping a consumed provider refund retains manual access in both lock orders", async () => {
      for (const grantFirst of [false, true]) {
        await reset(null); await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
        const accepted = new Date(today.getTime() - 45 * day);
        await one.payment.update({ where: { providerPaymentId: "pay-old" }, data: { paidAt: accepted } });
        await one.userSubscription.update({ where: { userId_planId: { userId: "teacher", planId: 1 } }, data: {
          startDate: accepted, grantBaselineAt: accepted, grantBaselineEndDate: accepted, endDate: new Date(today.getTime() - 15 * day),
        } });
        const grant = async (c: PrismaClient) => { assert.equal((await manual(c, "grant")).status, 200); };
        const refund = async (c: PrismaClient) => { await fullRefund(c); };
        await overlap(grantFirst ? grant : refund, grantFirst ? refund : grant);
        assert.equal((await expiry()).getTime(), today.getTime() + 30 * day);
        assert.equal(await adjustmentCount(), 1); assert.equal(await one.payment.count(), 1);
      }
    });
    await t.test("manual grant audit/constraint failure rolls back adjustment, balance, status and post-commit event", async () => {
      for (const secondary of [false, true]) {
        await reset(null);
        await admin.query("ALTER TABLE activity_logs ADD CONSTRAINT injected_manual_failure CHECK (activity NOT LIKE 'Admin manually%')");
        const events = manualEvents;
        try {
          assert.equal((await manual(two, "grant", secondary, "suspended")).status, 500);
          assert.deepEqual(await readFacts(), { subscription: null, payments: [], adjustments: [], events: 0, audits: 0 });
          assert.equal((await one.user.findUniqueOrThrow({ where: { id: "teacher" } })).status, "active");
          assert.equal(manualEvents, events);
        } finally { await admin.query("ALTER TABLE activity_logs DROP CONSTRAINT injected_manual_failure"); }
      }
    });
    await t.test("manual revoke audit failure rolls back all facts and preserves paid access", async () => {
      await reset(null); await billing.activatePaidCheckout(paidCheckout("old"), billingEvent("old"));
      const before = await readFacts(), events = manualEvents;
      await admin.query("ALTER TABLE activity_logs ADD CONSTRAINT injected_manual_failure CHECK (activity NOT LIKE 'Admin manually%')");
      try { assert.equal((await manual(two, "revoke")).status, 500); assert.deepEqual(await readFacts(), before); assert.equal(manualEvents, events); }
      finally { await admin.query("ALTER TABLE activity_logs DROP CONSTRAINT injected_manual_failure"); }
    });
    await t.test("unrelated manual ledger uniqueness failure rolls back rather than becoming a duplicate success", async () => {
      await reset(null); await manual(one, "grant"); await manual(one, "revoke");
      const before = await readFacts(), events = manualEvents;
      const collision = before.adjustments[0].id;
      const faulted = new Proxy(two, { get(client, property) {
        if (property !== "$transaction") return Reflect.get(client, property);
        return (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => client.$transaction(tx => work(new Proxy(tx, {
          get(transaction, field) {
            if (field !== "manualSubscriptionAdjustment") return Reflect.get(transaction, field);
            return new Proxy(transaction.manualSubscriptionAdjustment, { get(delegate, method) {
              if (method !== "create") return Reflect.get(delegate, method);
              return (args: Prisma.ManualSubscriptionAdjustmentCreateArgs) => delegate.create({ ...args, data: { ...args.data, id: collision } });
            } });
          },
        })), options);
      } });
      assert.equal((await manual(faulted, "grant")).status, 500);
      assert.deepEqual(await readFacts(), before); assert.equal(manualEvents, events);
    });
    await t.test("unknown historical manual balance is preserved without fabricating original grant facts", async () => {
      await reset(new Date(today.getTime() + 17 * day));
      await one.userSubscription.update({ where: { id: "sub" }, data: { paymentStatus: "paid_manual" } });
      const before = await one.userSubscription.findUniqueOrThrow({ where: { id: "sub" } });
      assert.equal((await manual(two, "grant")).status, 200);
      assert.deepEqual(await one.userSubscription.findUniqueOrThrow({ where: { id: "sub" } }), before);
      await billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"), two);
      await billing.refundPaidCheckout({ providerPaymentId: "pay-new", refundedCentavos: 50_000 }, billingEvent("refund-new", "payment.refunded"), two);
      assert.equal((await expiry()).getTime(), before.endDate.getTime());
      assert.equal(await adjustmentCount(), 0);
      assert.equal((await one.userSubscription.findUniqueOrThrow({ where: { id: "sub" } })).grantBaselineEndDate?.getTime(), before.endDate.getTime());
    });
    await t.test("adopting an inactive future-expiry legacy row does not resurrect disabled entitlement", async () => {
      await reset(new Date(today.getTime() + 17 * day));
      await one.userSubscription.update({ where: { id: "sub" }, data: { subscriptionStatus: "cancelled" } });
      assert.equal((await manual(two, "grant")).status, 200);
      assert.equal((await expiry()).getTime(), today.getTime() + 30 * day);
      assert.deepEqual((await one.manualSubscriptionAdjustment.findMany({ orderBy: { sequence: "asc" } })).map(a => a.kind), ["revoke", "grant"]);
    });
    await t.test("fresh client reads the same manual adjustment/provider facts and effective expiry", async () => {
      await reset(null); await manual(one, "grant"); await billing.activatePaidCheckout(paidCheckout("new"), billingEvent("new"));
      const before = await readFacts(), fresh = newClient();
      try { assert.deepEqual(await readFacts(fresh), before); } finally { await fresh.$disconnect(); }
    });
    await t.test("fresh client readback retains all committed concurrent grants", async () => {
      await reset(); await overlap(c => billing.activatePaidCheckout(paidCheckout("one"), billingEvent("one"), c), c => billing.activatePaidCheckout(paidCheckout("two"), billingEvent("two"), c));
      await Promise.all([one.$disconnect(), two.$disconnect()]);
      const fresh = newClient();
      try {
        assert.equal((await fresh.userSubscription.findUniqueOrThrow({ where: { id: "sub" } })).endDate.getTime(), future.getTime() + 60 * day);
        assert.equal(await fresh.payment.count(), 2); assert.equal(await fresh.webhookEvent.count(), 2); assert.equal(await fresh.activityLog.count(), 2);
      } finally { await fresh.$disconnect(); }
    });
  } finally {
    await Promise.allSettled([one.$disconnect(), two.$disconnect()]);
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
