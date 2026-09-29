# Railway staging runbook

This is a **manual, gated** deployment of the unified Next.js application. It does not deploy from this document. Use a dedicated staging Railway environment and staging-only provider accounts. Record the exact Git commit SHA, Railway project/environment IDs, database host/name, and an approved database backup or snapshot before starting. Never point either service at the normal or demo database.

## Services and ownership

| Resource | Staging setup |
| --- | --- |
| Web | One Railway service from the repository's `Dockerfile`, public HTTPS domain, `PORT` supplied by Railway, healthcheck path `/api/health`. Disable GitHub autodeploy until the migration gate is automated and verified. |
| PostgreSQL | Dedicated staging database (Railway PostgreSQL or isolated Neon branch). Web and migration services reference this same staging `DATABASE_URL`; record host and database name without logging credentials. Keep backups/snapshots. |
| Redis | Dedicated staging Redis. The web service references its `REDIS_URL`; do not share the demo or normal cache. |
| Evidence | Dedicated private S3-compatible bucket or Railway storage bucket. Grant the web service HeadBucket, PutObject, GetObject, and DeleteObject. Do not use local evidence fallback. |
| Migration | Private Railway service from the **same repository commit**, with `RAILWAY_DOCKERFILE_PATH=Dockerfile.migrate`, one replica, no domain, no cron, no healthcheck, and GitHub autodeploy disabled. Its idle command does not migrate anything. Stop or scale it down between migration windows if desired. |

The migration image installs repository dependencies (including the development dependency that supplies Prisma CLI), copies Prisma schema/migrations and the existing bootstrap script, and generates Prisma Client at image build. It has no Next.js server. The web runtime image remains standalone and has no Prisma CLI. Railway pre-deploy commands execute inside the service image, so do **not** configure `prisma migrate deploy` as the web service's pre-deploy command.

## Railway variables

Set the following four **public build-time variables** on the web service before building. The Dockerfile declares them as build arguments; Next.js freezes them into browser assets. Rebuild after any change:

`NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`, `NEXT_PUBLIC_APP_URL`.

Set the following **runtime variables** on the web service. Use Railway reference variables for PostgreSQL and Redis, and sealed/secret values where appropriate. Public variables used by server routes must match the build-time values:

| Group | Variables |
| --- | --- |
| Database/cache/session | `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_SECRET` |
| Private evidence | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| Google/Pusher | `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`, `PUSHER_APP_ID`, `PUSHER_SECRET` |
| AI/email | `GEMINI_API_KEY`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (verified staging sender) |
| Sandbox billing/maintenance | `PAYMONGO_MODE=test`, `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `CRON_SECRET` |
| Public origin | `NEXT_PUBLIC_APP_URL` (the final staging HTTPS origin) |

Optional web variables: `GEMINI_MODEL`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_SERVER_SIDE_ENCRYPTION`. Railway supplies `PORT`; Docker sets `HOSTNAME=0.0.0.0` and `NODE_ENV=production`. Leave `FRONTEND_ONLY` and `EVIDENCE_LOCAL_FALLBACK` unset. Do not put `PUSHER_SECRET`, database credentials, email API keys, billing keys, JWT secret, or S3 credentials in any `NEXT_PUBLIC_*` value or Docker build argument. `NEXT_PUBLIC_PAYMONGO_PUBLIC_KEY` is present in the example environment but is not used by current application code.

Set only these variables on the migration service: the **same staging** `DATABASE_URL`, `STAGING_RAILWAY_ENVIRONMENT_ID` (the exact staging environment ID), `STAGING_DATABASE_HOST`, and `STAGING_DATABASE_NAME`. Railway supplies `RAILWAY_ENVIRONMENT_ID`; the guard compares it and the parsed database host/name before any migration command. For a brand-new empty database only, temporarily add `ADMIN_EMAIL` and `ADMIN_PASSWORD` to that private service for the explicit bootstrap step, then remove them. Do not expose or print variable values.

## External provider setup

1. **Google:** authorize the final staging HTTPS origin for the public Google client ID. The browser obtains an ID token and posts it to `/api/auth/google`; there is no separate server OAuth callback URL in this code path. Verify login for the intended Teacher and Student roles.
2. **Pusher:** use a staging Pusher app. Its public key and cluster must be identical in the web build and runtime; `PUSHER_APP_ID` and `PUSHER_SECRET` belong only in runtime variables. Confirm a browser subscription and a server-triggered event.
3. **PayMongo:** use only `PAYMONGO_MODE=test` with matching sandbox secret and webhook signing secret. Configure the public HTTPS webhook URL `https://<staging-host>/api/billing/webhook` for `checkout_session.payment.paid`, `payment.refunded`, and `payment.refund.updated` where available. Checkout success/cancel URLs use only the configured `NEXT_PUBLIC_APP_URL` origin; request `Origin`, `Host`, and forwarded headers are ignored. The configured URL must be an HTTPS origin with no path, query, or fragment. In a sandbox checkout, inspect the created session's return URLs in PayMongo and confirm they use the intended staging origin, including when the checkout request carries a deliberately different `X-Forwarded-Host` or `Host`. Never send live payment traffic to staging.
4. **Email/Gemini:** verify a staging sending domain with Resend, set `EMAIL_PROVIDER=resend`, a staging-only `RESEND_API_KEY`, and `EMAIL_FROM` on that domain. Email is sent through Resend's HTTPS API; missing credentials or provider errors fail visibly in application logs without falling back to SMTP. Local development still defaults to Gmail SMTP through `SMTP_EMAIL`/`SMTP_PASSWORD`. Verify one OTP email and one Gemini-backed request without logging credentials or sensitive content.

Evidence media retention uses the `evidence_retention_days` database setting (90 days by default, valid range 1–3650). A Teacher's bulk deletion request is rejected if any owned media is still within retention. Eligible files are marked for deletion in PostgreSQL before maintenance deletes private S3 objects; violation rows and file audit metadata remain. Run the `20260929160000_evidence_retention_queue` migration before deploying the matching web code. Schedule authenticated maintenance regularly and alert on failures: a failed S3 delete or database finalization leaves the file marked for retry. Each run handles up to 20 pending files, so large backlogs need repeated runs. Back up the private evidence bucket as well as PostgreSQL before changing retention settings or performing a restore.

The migration is additive: existing file rows have null deletion markers, and the previous web revision can read the expanded schema. If rolling the web back to a revision before this fix, disable Teacher evidence purge and scheduled maintenance until safe code is restored; that revision still deletes S3 first. Do not drop the marker columns while requests are pending. Restoring media after a completed retention deletion requires an evidence-bucket backup, not only a database restore.

## Controlled deployment sequence

1. Provision the staging environment, database, Redis, and private evidence bucket. Confirm database isolation from normal/demo and take a recoverable snapshot before schema changes. Choose the final HTTPS web hostname before building.
2. Set web and migration variables as above, plus external provider settings. Disable autodeploy on **both** services. Configure the web domain and `/api/health` Railway healthcheck, but do not deploy the web service yet. Use the same reviewed Git commit SHA for migration and web.
3. Build/deploy the private migration service using `Dockerfile.migrate`. Its default process only waits; image creation and service deployment make **no schema changes**. Verify its commit SHA and staging environment ID in Railway before proceeding.
4. Run the read-only target guard through Railway SSH:

   ```text
   railway ssh --service <migration-service> --environment staging -- node scripts/railway-staging-migrate.mjs --check-target
   ```

   For a private service without a public domain, use Railway's **Copy SSH Command** or its service instance ID if the CLI cannot resolve the target. Compare the printed host/database with the approved staging target. A missing or mismatched environment ID, host, or database name must stop the release. Optionally inspect pending migrations with `railway ssh --service <migration-service> --environment staging -- ./node_modules/.bin/prisma migrate status`; pending migrations may make this status command exit nonzero.
5. Review every pending `prisma/migrations/*/migration.sql` against the staging snapshot and approve its effects. Only after that review, snapshot, and target check, run the explicit schema migration:

   ```text
   railway ssh --service <migration-service> --environment staging -- node scripts/railway-staging-migrate.mjs --apply
   ```

   The wrapper runs **only** `prisma migrate deploy` and propagates its exit status. On any failure, stop: do not deploy web, do not use `prisma db push` or `migrate reset`, and investigate against the snapshot. Confirm `prisma migrate status` is current afterward.
6. If the staging database was **brand-new and empty**, use the guarded `--bootstrap-empty` mode once, after migrations and before web deployment. It refuses any rows in public application tables (excluding Prisma migration history) and invokes the repository's existing bootstrap to create reference rows and an Admin. Supply `ADMIN_EMAIL`/`ADMIN_PASSWORD` only to the private migration service for this step and remove them afterward:

   ```text
   railway ssh --service <migration-service> --environment staging -- node scripts/railway-staging-migrate.mjs --bootstrap-empty
   ```

   If bootstrap fails, stop and inspect partial rows; the empty-database guard will refuse a blind retry. If using a reviewed database clone with retained reference data, **skip bootstrap** and verify the existing Admin/roles/plans/settings instead. Never run `db:seed` or demo-data generation as part of deployment.
7. Build and manually deploy the web service from the **same commit SHA** with the four staging public values. Confirm Railway selected the root `Dockerfile`, used the intended `PORT`, and received the runtime variables. The web start command remains `node server.js`; it never applies schema changes.
8. Wait for Railway's `/api/health` check to return HTTP 200 before directing users to staging. If it fails, leave the deploy inactive and investigate the dependency logs. Run the manual smoke checks below. Mark the environment ready only after they pass.

Keep web autodeploy disabled until this migration-before-web gate is enforced in an automated pipeline. Railway's “Wait for CI” alone does not guarantee a migration ran before every deploy.

## Health and failure interpretation

`GET /api/health` is intentionally strict: HTTP 200 with `{"status":"ok"}` requires PostgreSQL `SELECT 1`, Redis `PING` returning `PONG`, and an S3 bucket check plus temporary object write/read/delete. It returns HTTP 503 with `{"status":"unavailable"}` if **any** dependency fails. The response does not disclose credentials or the failing component; inspect Railway application logs for the database query error, “Shared cache unavailable,” or “Evidence storage unavailable”/S3 error. Missing S3 settings cannot fall back to the filesystem in production. Do not weaken this check to pass deployment. Railway's healthcheck is a deployment gate, not continuous monitoring; add separate uptime monitoring after launch.

## Manual staging smoke checks

- Public `/login` loads over HTTPS; `/api/health` returns 200.
- Admin, Teacher, and Student logins work with staging accounts; secure session cookies persist and role redirects are correct. If the database was empty, create Teacher/Student accounts through normal registration after the explicit Admin bootstrap.
- Google sign-in works from the authorized staging origin.
- Create and read a quiz and confirm PostgreSQL writes/reads; have a Student join it. Exercise a Redis-backed live/session or rate-limit path and confirm the staging Redis connection is used.
- Trigger and receive a Pusher event in a separate browser session. Upload an evidence clip/image and read it through the authorized evidence endpoint; confirm it resides in the private staging bucket.
- Invoke one Gemini-backed feature and one HTTPS-provider OTP email using staging credentials.
- Complete a PayMongo **sandbox** checkout; verify the webhook reaches `/api/billing/webhook`, signature/mode acceptance, idempotent subscription activation, and correct HTTPS return URLs. Do not use a live key or real charge.
- Safe monitored quiz flow: Teacher creates a Proctored quiz → Student joins → Teacher starts → Student saves an answer → one controlled violation/evidence event → Student submits → Student result and Teacher report agree. Confirm no stuck attempt or duplicate completion.
- Recheck `/api/health`, application logs for unexpected 500s, and absence of unexpected writes to normal/demo resources.

No Railway resources, variables, databases, or provider accounts are changed by this runbook itself.
