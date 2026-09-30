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
| AI/email | `GEMINI_API_KEY`; staging email delivery is currently waived. Resend is optional and disabled. For a future email-enabled environment, explicitly select `EMAIL_PROVIDER=smtp` with `SMTP_EMAIL`/`SMTP_PASSWORD`, or `EMAIL_PROVIDER=resend` with `RESEND_API_KEY`/`EMAIL_FROM`. |
| Sandbox billing/maintenance | `PAYMONGO_MODE=test`, `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `CRON_SECRET` |
| Public origin | `NEXT_PUBLIC_APP_URL` (the final staging HTTPS origin) |

Optional web variables: `GEMINI_MODEL`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_SERVER_SIDE_ENCRYPTION`. Railway supplies `PORT`; Docker sets `HOSTNAME=0.0.0.0` and `NODE_ENV=production`. Leave `FRONTEND_ONLY` and `EVIDENCE_LOCAL_FALLBACK` unset. Do not put `PUSHER_SECRET`, database credentials, email API keys, billing keys, JWT secret, or S3 credentials in any `NEXT_PUBLIC_*` value or Docker build argument. `NEXT_PUBLIC_PAYMONGO_PUBLIC_KEY` is present in the example environment but is not used by current application code.

Set only these variables on the migration service: the **same staging** `DATABASE_URL`, `STAGING_RAILWAY_ENVIRONMENT_ID` (the exact staging environment ID), `STAGING_DATABASE_HOST`, and `STAGING_DATABASE_NAME`. Railway supplies `RAILWAY_ENVIRONMENT_ID`; the guard compares it and the parsed database host/name before any migration command. For a brand-new empty database only, temporarily add `ADMIN_EMAIL` and `ADMIN_PASSWORD` to that private service for the explicit bootstrap step, then remove them. Do not expose or print variable values.

## External provider setup

1. **Google:** authorize the final staging HTTPS origin for the public Google client ID. The browser obtains an ID token and posts it to `/api/auth/google`; there is no separate server OAuth callback URL in this code path. Verify login for the intended Teacher and Student roles.
2. **Pusher:** use a staging Pusher app. Its public key and cluster must be identical in the web build and runtime; `PUSHER_APP_ID` and `PUSHER_SECRET` belong only in runtime variables. Confirm a browser subscription and a server-triggered event.
3. **PayMongo:** use only `PAYMONGO_MODE=test` with matching sandbox secret and webhook signing secret. Configure the public HTTPS webhook URL `https://<staging-host>/api/billing/webhook` for `checkout_session.payment.paid`, `payment.refunded`, and `payment.refund.updated` where available. Checkout success/cancel URLs use only the configured `NEXT_PUBLIC_APP_URL` origin; request `Origin`, `Host`, and forwarded headers are ignored. The configured URL must be an HTTPS origin with no path, query, or fragment. In a sandbox checkout, inspect the created session's return URLs in PayMongo and confirm they use the intended staging origin, including when the checkout request carries a deliberately different `X-Forwarded-Host` or `Host`. Never send live payment traffic to staging.
4. **Email/Gemini:** staging email delivery remains waived. Do not configure or activate Resend for this staging release. Resend is optional and disabled unless `EMAIL_PROVIDER=resend` is explicitly selected. Production preflight requires an explicit provider and validates only its credentials: `smtp` needs `SMTP_EMAIL`/`SMTP_PASSWORD`; `resend` needs `RESEND_API_KEY`/`EMAIL_FROM`. Missing, invalid, or unknown provider settings fail preflight; delivery never falls back to another provider. Local development may default to Gmail SMTP when the provider is unset. Verify one Gemini-backed request without logging credentials or sensitive content. OTP delivery and Google sign-in remain unverified while the email waiver is in effect.

Evidence media retention uses the `evidence_retention_days` database setting (90 days by default, valid range 1–3650). A Teacher's bulk deletion request is rejected if any owned media is still within retention. Eligible files are marked for deletion in PostgreSQL before maintenance deletes private S3 objects; violation rows and file audit metadata remain. Run the `20260929160000_evidence_retention_queue` migration before deploying the matching web code. Schedule authenticated maintenance regularly and alert on failures: a failed S3 delete or database finalization leaves the file marked for retry. Each run handles up to 20 pending files, so large backlogs need repeated runs. Back up the private evidence bucket as well as PostgreSQL before changing retention settings or performing a restore.

The migration is additive: existing file rows have null deletion markers, and the previous web revision can read the expanded schema. If rolling the web back to a revision before this fix, disable Teacher evidence purge and scheduled maintenance until safe code is restored; that revision still deletes S3 first. Do not drop the marker columns while requests are pending. Restoring media after a completed retention deletion requires an evidence-bucket backup, not only a database restore.

## Controlled deployment sequence

1. Provision the staging environment, database, Redis, and private evidence bucket. Confirm database isolation from normal/demo and take a recoverable snapshot before schema changes. Choose the final HTTPS web hostname before building.
2. Set web and migration variables as above, plus enabled external provider settings. Keep the staging email waiver in force; do not add Resend settings. Disable autodeploy on **both** services. Configure the web domain and `/api/health` Railway healthcheck, but do not deploy the web service yet. Use the same reviewed Git commit SHA for migration and web.
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
- Google sign-in remains blocked on OTP delivery under the staging email waiver; verify it after an email provider is deliberately enabled.
- Create and read a quiz and confirm PostgreSQL writes/reads; have a Student join it. Exercise a Redis-backed live/session or rate-limit path and confirm the staging Redis connection is used.
- Trigger and receive a Pusher event in a separate browser session. Upload an evidence clip/image and read it through the authorized evidence endpoint; confirm it resides in the private staging bucket.
- Invoke one Gemini-backed feature. OTP email delivery is waived on staging until a provider is deliberately enabled and tested.
- Complete a PayMongo **sandbox** checkout; verify the webhook reaches `/api/billing/webhook`, signature/mode acceptance, idempotent subscription activation, and correct HTTPS return URLs. Do not use a live key or real charge.
- Safe monitored quiz flow: Teacher creates a Proctored quiz → Student joins → Teacher starts → Student saves an answer → one controlled violation/evidence event → Student submits → Student result and Teacher report agree. Confirm no stuck attempt or duplicate completion.
- Recheck `/api/health`, application logs for unexpected 500s, and absence of unexpected writes to normal/demo resources.

No Railway resources, variables, databases, or provider accounts are changed by this runbook itself.

## Backup and disaster recovery

For the proposed production schedules, alert thresholds, guarded offsite backup helper, and remaining launch gates, see [Production operations readiness](production-operations-runbook.md).

**Current state (2026-09-30):** this procedure is manual. The staging Postgres service has no Railway-native backup listed and PITR is disabled. A local logical dump and one disposable object restore have been tested; neither is an automated, offsite production backup. Railway [volume backups](https://docs.railway.com/volumes/backups) can be scheduled daily, weekly, and monthly, but restore into the same project/environment. Railway [Postgres PITR](https://docs.railway.com/volumes/point-in-time-recovery) is a separate option and is not enabled here. Railway [Storage Buckets](https://docs.railway.com/storage-buckets) currently have no object versioning, object lock, lifecycle policy, or native bucket backup. Do not rely on bucket deletion's short recovery window as an evidence backup.

### Recovery set, cadence, and custody

#### Staging backup write gate (requires deployment and live verification)

The staging-only gate is **off by default**. It uses the existing PostgreSQL `settings` table, so no migration is needed. Configure only the staging web service with `BACKUP_WRITE_GATE_STAGING_TEST=true` and a new server-only `BACKUP_WRITE_GATE_SECRET` of at least 32 bytes. The code also pins the Railway staging project, environment, and web service IDs. Never use a `NEXT_PUBLIC_*` variable for the secret, set these variables in production, or include the secret in command output. Keep the Ops service's `BACKUP_WRITES_PAUSED` and `BACKUP_MAINTENANCE_PAUSED` unset until the sequence below succeeds.

1. Deploy the reviewed gate commit to the staging web service and confirm the exact deployed SHA, `/api/health` HTTP 200, and that the prior web deployment has drained. Verify maintenance is not scheduled and no migration/bootstrap job is being run. Only an operator holding `BACKUP_WRITE_GATE_SECRET` may call `POST /api/internal/backup-write-gate` with `Authorization: Bearer <secret>`; that atomically blocks new mutating requests. PayMongo webhooks receive retryable HTTP 503 while paused and are not recorded as processed.
2. Poll authenticated `GET /api/internal/backup-write-gate` until `paused=true`, `activeMutations=0`, and `safeForBackup=true`. There is no fixed sleep and no automatic deletion of stalled markers. If PostgreSQL/status is unavailable or a marker remains, **do not start the backup**. Investigate the request or failed release. The gate also blocks direct `runMaintenance` calls; do not start a separate migration/bootstrap command during the window.
3. Record the UTC activation and drain times and set the Ops service's `BACKUP_APP_COMMIT` to that exact newly deployed web SHA. Only then set both pause assertion flags on the guarded staging Ops job, run one complete encrypted backup, and verify its completion marker. Keep the gate active until the database dump and evidence export/readback are finished. A failed backup does not justify using an incomplete set.
4. Unset both Ops pause flags after the job ends, call authenticated `DELETE /api/internal/backup-write-gate`, confirm `paused=false`, and verify a normal staging write, `/api/health` HTTP 200, and application logs. Record the UTC release time. If a job fails, release the gate through this same sequence after preserving its diagnostics. A paused gate is durable across web restarts and must be explicitly released; do not delete its `settings` rows to bypass the drain check.

The gate rejects every current API `POST`/`PUT`/`PATCH`/`DELETE` handler except its own protected control endpoint. Billing and Arena GET routes that can reconcile persistent state are also gated. Ordinary reads remain available; incidental session-presence and subscription-expiry writes are counted or skipped while paused. In-flight handlers are recorded before work begins and removed after completion, including maintenance and deferred writes. The gate does not authorize the backup by itself: verify its status and the absence of independent migration/bootstrap writers before setting the Ops assertion flags.

- Treat a PostgreSQL dump and a private evidence-object export as **one recovery set**. Record a UTC set ID, source environment, application commit, migration status, dump SHA-256, object count, per-object SHA-256 manifest, and the time writes and maintenance were paused. Keep the manifest with the encrypted backup, since storage keys can disclose internal identifiers. A database-only restore can leave active `evidence_files.file_path` references without media; a bucket-only restore cannot reconstruct ownership, violation history, or deletion markers.
- Before every migration or risky retention change, take and validate a recovery set. For production, plan at least daily logical dumps and daily evidence exports, with a separately controlled destination outside the source Railway project; retain daily sets for a proposed 30 days, then adjust to the approved audit/privacy policy. This gives an approximately 24-hour recovery-point target only after scheduling, independent storage, monitoring, and repeat drills exist. Backup copies may extend the effective life of expired evidence by up to their retention window; restrict access and expire them deliberately.
- Consider Railway daily/weekly/monthly Postgres volume snapshots for faster local recovery and PITR for a shorter database recovery point, subject to cost and plan support. They complement an independently stored logical dump; same-project snapshots do not cover loss of the whole Railway project. Do not claim an automated backup until its schedule, latest successful run, restore test, and alert are recorded.
- The source bucket cannot produce a point-in-time object snapshot. For a consistent set today, stop new evidence uploads and scheduled retention deletion during the export and database dump, or maintain and replay a complete change journal. Resume only after both copies and manifests verify. A future backup destination with versioning/immutability protects the backup copy, but does not add versioning to the source bucket. Use separate, least-privilege credentials and encryption at rest/in transit.
- Dumps contain account data, password hashes, payment metadata, and audit evidence references. Never put database URLs/passwords, S3 keys, session cookies, OTPs, provider tokens, raw dump contents, or evidence media in this runbook, Git, CI logs, or deployment messages. Keep local drill output under ignored `.data/staging-backups/` and `.data/evidence-backups/`; move production sets to the approved encrypted offsite store and verify the transferred hashes.

### Logical PostgreSQL backup and disposable restore

1. Confirm the Railway project, `staging` environment ID, Postgres service ID, `POSTGRES_DB=railway`, and exact deployed web SHA. Refuse any normal, demo, E2E, or production target. Preserve the current DB and provider configuration. Pause writes/maintenance if creating a consistent DB-plus-evidence recovery set. The commands below run inside the **staging Postgres service**; credentials come from its existing environment and are never printed:

   ```sh
   test "$RAILWAY_ENVIRONMENT_ID" = '<approved-staging-environment-id>'
   test "$POSTGRES_DB" = 'railway'
   PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -Fc --no-owner --no-acl -f /tmp/<utc-recovery-set>.dump
   pg_restore --list /tmp/<utc-recovery-set>.dump >/dev/null
   sha256sum /tmp/<utc-recovery-set>.dump
   ```

2. Transfer the binary dump to ignored `.data/staging-backups/` without passing it through a text-mode shell redirect. Use SSH/SFTP or a base64 transfer decoded to bytes locally. Compare the **local** SHA-256 with the source SHA-256 and keep the checksum in the recovery-set manifest. `pg_restore --list` checks the archive table of contents; an actual restore is required to validate table data. Copy the verified dump to the independently controlled encrypted backup destination. The container's `/tmp` copy is temporary and is not the backup.
3. Create a **new, empty, explicitly named disposable recovery database** in staging, never overwrite `railway`. Confirm the target name is not already present; use `createdb -T template0 <approved-recovery-db>`. Transfer the verified dump from the protected backup store to that recovery environment, then run `pg_restore --no-owner --no-acl --exit-on-error -d <approved-recovery-db> <verified-dump>`. Keep the live web and normal migration-service variables pointed at `railway`. A real incident should restore to a new Postgres service rather than relying on another database in a damaged cluster.
4. On the restored DB, compare migration history and counts/digests for roles/users, quizzes, attempts, subscriptions/payments, violations, and evidence files against the backup-time manifest. Check representative Admin, Teacher, Student, quiz, attempt, payment, and evidence records, plus zero orphaned foreign-key relationships. Verify active evidence keys exist privately; queued/deleted rows keep their audit metadata and should not become readable merely because older media is in a backup. Test `/api/evidence/[id]` with authorized Admin or eligible owning Teacher and confirm anonymous access is denied. Stop if required objects are missing.
5. Run `prisma migrate status` against the **recovery** target. If already current, `migrate deploy` is a no-op. If behind, review the pending SQL and backup, then run the existing guarded staging migration service with process-local recovery DB overrides and verify status again. Do not change the service's saved variables, edit `_prisma_migrations`, use `prisma db push`, or use `migrate reset`. Never apply new web code to an incompatible restored schema.

### Private evidence export and restore

1. On an encrypted backup runner, load source bucket credentials from an approved secret store into the process environment. With an S3-compatible CLI, list the private `evidence/` prefix and download it to an encrypted working directory, for example `aws --endpoint-url <source-endpoint> s3 sync s3://<source-bucket>/evidence/ <encrypted-workdir>/evidence/ --only-show-errors`. Preserve each relative key. Record key, content type, byte length, and SHA-256 in a protected manifest; compare the downloaded object count with the source listing. Never print credentials or media content.
2. Switch to **separate destination credentials** and upload the verified directory and manifest to an independent private backup bucket under `<utc-recovery-set>/`, for example `aws --profile <backup-destination> --endpoint-url <backup-endpoint> s3 sync <encrypted-workdir>/evidence/ s3://<backup-bucket>/<utc-recovery-set>/evidence/ --only-show-errors`. List the destination, download and hash-check a sample, and retain the manifest with the matching PostgreSQL dump. A same-bucket prefix is not the sole backup: bucket loss or credential misuse would remove both copies. Schedule this operation and alert on nonzero exit, count mismatch, or failed hash checks before calling it automated.
3. To restore, download the selected set from the independent destination, verify every file against the protected manifest, and upload to a **new private recovery bucket** with the original keys and content types. A generic sync tool may infer content type from the extension; compare `HeadObject` metadata with the manifest and correct any mismatch. Reconcile keys with the restored database before cutover. Test the process using **only disposable evidence**: save its bytes, delete only that disposable object, put the bytes back at the same key, and confirm its DB row, SHA-256, and authorized endpoint read. A missing active object is an availability incident; verify that the endpoint returns a controlled 503. Never expose a private S3 URL to clients.

When recovering from a wider object loss, restore the selected DB-and-object set into isolated resources first. Reconcile every active (`deletion_requested_at IS NULL AND deleted_at IS NULL`) evidence row with an object and matching manifest hash before cutover. Preserve queued/deleted markers and retention policy; do not re-expose expired media from an older object backup. Keep the existing bucket private, and rerun the Admin/owning-Teacher/anonymous authorization checks. A later database-only snapshot may reference objects absent from an earlier bucket copy, so choose coordinated timestamps and resolve any missing keys before declaring recovery complete.

### Application rollback and incident order

1. Stop writes and scheduled maintenance, preserve logs and current data, choose a recovery timestamp and matching DB/evidence set, then restore and validate in isolation. Record the recovery-point gap and any lost writes before traffic is moved. Restore private evidence and database metadata before enabling the web service; run compatible migrations next, then deploy the exact app commit and check `/api/health`, log errors, reports, billing state, and authorized evidence access.
2. For an app-only regression, identify the last known-good **commit and deployment**, check schema compatibility, and use Railway's [deployment rollback](https://docs.railway.com/deployments/deployment-actions) for a retained image. Railway rollback restores the old image **and custom variables**, so inspect the resulting variable values before reopening traffic. The CLI `railway redeploy` targets the latest deployment; it is not an arbitrary-commit rollback. If the old image is unavailable, build and upload a clean `git archive <exact-commit>` with `railway up <archive-directory> --path-as-root` to the intended environment, then verify the deployment message/SHA and health. Do not upload a dirty checkout. At the time of the initial drill, the healthy web commit was `9ce4e072bc55f4134893a2cb66f538a8182c70ac`; its previous known-good commit `a133cf2dd64004db92ad78499e66ed60c5d3a413` includes the evidence-retention migration contract. There were no Prisma changes between them.
3. Rolling web code back does **not** roll schema or data back. Only use an older web commit when it can read/write the current schema safely. For incompatible or destructive migrations, prepare a forward fix or restore the coordinated DB/evidence set to new resources and cut over after verification. Never blindly reverse a migration or restore only PostgreSQL while leaving mismatched object storage. Keep the failed deployment and logs for diagnosis.

The 2026-09-30 rehearsal restored a 66,249-byte staging dump (SHA-256 `821efc4d4d7ebc42705bfd1b67d5c3d46e41d13f612b5fb84805ee9d91b3ed87`) into an isolated database, matched ten core table counts and full-row digests, and confirmed seven migrations current. A separate older six-migration backup was restored into another disposable database and upgraded by the guarded migration service to seven migrations. A disposable private evidence object was backed up, removed, restored, and read through the Admin endpoint with matching SHA-256; anonymous access returned 401. Both disposable databases and the disposable staging DB/object fixture were removed. The initial missing-object drill returned HTTP 500 on commit `9ce4e072bc55f4134893a2cb66f538a8182c70ac`; verify a controlled HTTP 503 after deploying the follow-up fix.
