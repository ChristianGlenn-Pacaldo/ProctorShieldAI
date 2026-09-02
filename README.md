# ProctorShield AI

ProctorShield AI is a Next.js proctoring application with live exam monitoring, webcam evidence, automated analysis, role-based dashboards, and PayMongo subscriptions.

## Local setup

Requirements: Node.js 24, PostgreSQL, Redis, private S3-compatible object storage, and the service credentials listed in `.env.example`. Docker Compose includes Redis and private MinIO services for a complete local stack.

```bash
npm ci
cp .env.example .env
npx prisma generate
npm run db:migrate:deploy
npm run db:bootstrap
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Before bootstrapping, configure `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 14 characters. `db:bootstrap` creates only roles, plans, settings, and the configured administrator.

Demo data is explicitly opt-in and must be used only with a disposable development database. Set `SEED_DEMO_DATA=true`, optionally configure `DEMO_STUDENT_PASSWORD` and `DEMO_TEACHER_PASSWORD`, then run `npm run db:seed`. Demo student and teacher passwords have no source-code defaults.

## Mobile student testing

Mobile Compatible Mode requires a public or locally trusted HTTPS URL because phone browsers block camera and microphone access on plain LAN HTTP addresses. Use an HTTPS staging deployment or trusted HTTPS tunnel, then open the same URL on the teacher laptop and student phone.

1. Sign in as a Pro teacher on the laptop and open Live Monitor.
2. Join the quiz with a student account on the phone.
3. Run **Test Camera & Device** in the student lobby and allow camera/microphone access.
4. Start the quiz from the teacher portal, then enter it from the phone.
5. Confirm the teacher sees `Mobile · Reduced`, live snapshots, and connection state.
6. Select answers, temporarily disconnect the phone, reconnect, and confirm autosave recovery.

Mobile mode intentionally does not claim reliable screenshot or fullscreen enforcement. It uses front-camera AI, visibility/app-switch checks, adaptive 1–2 second snapshots, local answer recovery, and a Reduced Assurance label visible to the teacher.

Authenticated Playwright contracts are opt-in. Point `E2E_DATABASE_URL` at a disposable database or branch containing an active teacher and student, set `RUN_AUTHENTICATED_E2E=true`, and run `npm run test:e2e`. The tests use those accounts only for read-only session validation and mock all quiz/subscription mutations.

## Required production configuration

- Use a unique `NEXTAUTH_SECRET` of at least 32 characters. Generate one with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`.
- Set `NEXT_PUBLIC_APP_URL` to the public HTTPS origin.
- Configure the database, Gemini, Google OAuth, Pusher, SMTP, and PayMongo variables in `.env.example`.
- Keep `PAYMONGO_MODE=test` with `sk_test_`/`pk_test_` keys until live payments are explicitly approved. Test mode rejects live keys and live webhook events.
- Configure Redis for shared rate limits and live-snapshot state. Do not use the process-local fallback for a multi-instance production deployment.
- Configure a private S3-compatible bucket for evidence. Evidence is returned only through the authenticated `/api/evidence/[id]` endpoint; the bucket must never be public.
- Create a PayMongo webhook for the production URL `/api/billing/webhook` and set its dedicated signing secret as `PAYMONGO_WEBHOOK_SECRET`. A successful redirect never activates a subscription; only a verified webhook does.
- Do not expose `.env`, commit credentials, or reuse development secrets in production.
- Back up the database, run `npm run db:migrate:check`, and then use `npm run db:migrate:deploy` for schema changes. Never use `prisma db push` against staging or production.

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
npm run db:migrate:check
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
