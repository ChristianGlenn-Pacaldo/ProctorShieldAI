# ProctorShield AI

ProctorShield AI is a Next.js proctoring application with live exam monitoring, webcam evidence, automated analysis, role-based dashboards, and PayMongo subscriptions.

## Local setup

Requirements: Node.js 24, PostgreSQL, Redis, private S3-compatible object storage, and the service credentials listed in `.env.example`. Docker Compose includes Redis and private MinIO services for a complete local stack.

```bash
npm ci
cp .env.example .env
npx prisma generate
npx prisma db push
npm run db:bootstrap
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Before bootstrapping, configure `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 14 characters. `db:bootstrap` creates only roles, plans, settings, and the configured administrator.

Demo data is explicitly opt-in and must be used only with a disposable development database. Set `SEED_DEMO_DATA=true`, optionally configure `DEMO_STUDENT_PASSWORD` and `DEMO_TEACHER_PASSWORD`, then run `npm run db:seed`. Demo student and teacher passwords have no source-code defaults.

## Required production configuration

- Use a unique `NEXTAUTH_SECRET` of at least 32 characters. Generate one with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`.
- Set `NEXT_PUBLIC_APP_URL` to the public HTTPS origin.
- Configure the database, Gemini, Google OAuth, Pusher, SMTP, and PayMongo variables in `.env.example`.
- Configure Redis for shared rate limits and live-snapshot state. Do not use the process-local fallback for a multi-instance production deployment.
- Configure a private S3-compatible bucket for evidence. Evidence is returned only through the authenticated `/api/evidence/[id]` endpoint; the bucket must never be public.
- Create a PayMongo webhook for the production URL `/api/billing/webhook` and set its dedicated signing secret as `PAYMONGO_WEBHOOK_SECRET`. A successful redirect never activates a subscription; only a verified webhook does.
- Do not expose `.env`, commit credentials, or reuse development secrets in production.
- Back up the database before applying schema changes. Existing duplicate quiz enrollments, answers, or user-plan subscriptions must be resolved before applying the new unique constraints.

PayMongo webhooks process paid checkout sessions idempotently and reconcile successful refunds. Subscribe the endpoint to `checkout_session.payment.paid`, `payment.refunded`, and `payment.refund.updated` when those events are available for the account.

## Scheduled maintenance

Run the following command daily from the deployment scheduler:

```bash
npm run maintenance
```

For the standalone container, schedule an authenticated `POST /api/internal/maintenance` request with `Authorization: Bearer <CRON_SECRET>`. `CRON_SECRET` must be a unique value of at least 32 characters.

It expires ended subscriptions, deletes expired OTPs, removes old webhook idempotency records, and enforces the configured evidence-retention window. The default evidence retention is 90 days.

## Verification and deployment

```bash
npm test
npm run test:e2e
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm audit --omit=dev
npm run preflight
docker compose up -d --build
```

The Docker build does not copy `.env` into the image. Supply production secrets through the deployment platform or Compose runtime environment. The `/api/health` readiness endpoint checks PostgreSQL, Redis, and evidence storage, and the container health check uses it.

The repository also includes a GitHub Actions workflow that runs dependency audit, tests, lint errors, type checking, Prisma validation, and the production build for pushes and pull requests.

## Seeded accounts

The production bootstrap creates only required platform records and the administrator specified by environment variables. The separate demo seed creates sample data and rotates seeded demo-user passwords every time it runs. There are intentionally no default account passwords.
