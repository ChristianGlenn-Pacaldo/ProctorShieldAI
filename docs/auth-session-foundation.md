# Phase 1 authentication foundation

Phase 1 changes server authentication/session boundaries. Existing login pages
remain; unified login and authenticated landing-page redirects are Phase 2.

## Session contract

New HS256 JWTs expire after seven days and sign both `sessionClass` and `aud`:

- Admin: `ps_session_admin`, class `admin`, audience `proctorshield:admin`.
- Teacher/Student: `ps_session_user`, class `user`, audience `proctorshield:user`.

Cookies are HttpOnly, SameSite=Lax, host-only, path `/`, Secure in production.
Roles always come from PostgreSQL. Each reader checks current role, active status,
and sessionVersion. Cookie name, class, audience and role must agree.

`getAdminSession()` reads only the Admin cookie. `getUserSession()` reads only the
User cookie; an optional Teacher/Student role narrows it. Neither falls back.
Explicit contexts select their boundary; mixed-role `getSession()` denies when
both current cookies exist. Proxy follows the same class selection. Existing
Teacher/Student hints now narrow the User reader; no caller depends on fallback.
Remaining mixed-role APIs keep their existing role/resource checks.

## Legacy rollout

There is deliberately no classless-token/legacy-cookie authorization fallback.
All existing sessions, including legacy Admin tokens using the same cookie name,
require reauthentication on eventual deployment. Existing login routes remain
available. Successful authentication clears all four new/legacy cookie names
before issuing exactly one current cookie. Legacy cookies cannot win priority
over a current identity. No database migration or signing-secret rotation is
required. This Phase 1 package has not been deployed.

Deploy the eventual cookie-contract change as a coordinated web rollout. Avoid
mixing old and new authentication writers behind the same browser origin: old
versions issue tokens/cookies the new version rejects. Notify users of the
required reauthentication; do not enable a permissive legacy fallback to avoid it.

## Issuance and revocation

Session issuance requires a server-only authenticated snapshot: account ID,
role, password hash and sessionVersion. A conditional PostgreSQL UPDATE checks
those facts and active status together before signing. Reset, suspension,
deletion or role changes cannot be blessed by reading a newer version. Password
hashes are never signed or returned; raw authentication DB errors are not logged.
Profile/name reissuance remains bound to the originally authenticated role/class.
The conditional update checks that original role, active status and version;
profile settings also compare the originally loaded password hash. Profile/name
mutation and token preparation occur in one PostgreSQL transaction; profile audit
logging shares that transaction. The new cookie is written only after commit.
Role changes reject rather than upgrade/downgrade the request. Signing, audit or
conditional-update failure rolls back profile mutation and issues no new cookie.
Browser header delivery cannot be atomic with a database commit: a cookie transport
failure reports failure but may leave the valid profile update/audit committed.
Reauthentication resolves that case; it cannot issue an elevated session.

Logout ignores a caller's claimed role, validates the current unambiguous account,
and atomically increments that version with its audit record. This intentionally
revokes **all devices/sessions for the account**. Concurrent/replayed requests
cannot increment a subsequent generation. All four cookies are cleared, and the
client returns to `/login`. Already invalid sessions need only browser cleanup.
Conflicting current cookies produce 409 and browser cleanup; no arbitrary account
is chosen. Failed DB/audit revocation rolls back and returns 503, with browser
cookies still cleared; account-wide revocation must not be considered successful.

For a trusted-Origin logout, the outer route applies explicit deletion headers
outside write-gate admission. Paused/unavailable gate responses retain 503 and
Retry-After, carry `serverRevocation: failed`, and delete all four cookies.
Responses distinguish `succeeded`, `already_invalid`, `not_required`,
`not_performed` (conflicting cookies), and `failed`; a failure never claims a
version increment. Foreign-Origin requests are rejected without logging out the
browser. Revocation and audit commit before any logout activity is scheduled.

Logout activity uses Next.js `after()`, which retains post-response work in the
Node runtime; it is not arbitrary fire-and-forget. Its separate transport signs
the same Pusher events request with the SDK, uses a fixed HTTPS provider host,
rejects redirects, and aborts the actual fetch after 1.5 seconds. Provider bodies
are cancelled/discarded and errors are static; signed URLs/payloads are not logged.
Provider failure, stalled headers/body or scheduling failure cannot hold up cookie
deletion, change the revocation result, or undo the committed transaction.

## Google, Origin and realtime

Admin Google login is explicitly disabled, including previously issued login
OTPs. Teacher/Student identity is verified by Google, existing role comes from DB,
and emailed login OTP must be consumed before any session is issued. No direct
Google login fallback exists. Existing expiry, purpose and replay checks remain.

Modified auth/browser mutation routes require explicit matching Origin and deny
cross-site Fetch Metadata. The configured NEXT_PUBLIC_APP_URL is the allowed
origin when present; otherwise the request URL origin is used. Forwarded Host is
not an allowlist. Browser clients send Origin normally; non-browser tests/clients
must supply it. Webhooks/internal bearer routes are unchanged.

Admin shell/session/profile consumers use `scope=admin`. Teacher/Student shell,
settings and name consumers explicitly use `scope=user&role=teacher|student`.
These select strict cookie readers with current PostgreSQL role validation;
query parameters never grant authority. Identity/profile/notifications calls
without scope default to User and cannot return or modify Admin identity.
`users/me` is User-only even if Admin scope is requested. Invalid scopes/roles deny.
The shell also checks returned role against its mounted role before subscribing.
User authorization loss stops/clears shell work using existing lifecycle guards;
Admin loss still propagates through its existing typed shared context.

Shell Pusher authorization is explicitly scoped to the same class/role.
Unscoped Admin and Teacher/Student role-specific channels retain strict readers.
Deliberately shared resource channels retain the conflict-denying resolver and
unchanged ownership/enrollment/entitlement checks. No User identity/profile/name/
notification browser consumer depends on a mixed-role resolver.

Compatibility calls intentionally remain outside the three-blocker follow-up:

- Logout supports either unambiguous class and never accepts a body-selected account.
- Unscoped Pusher shared user/quiz/Arena channels retain explicit channel identity,
  role, ownership/enrollment and entitlement checks; shell callers are now scoped.
- Shared quiz resource/list APIs, Arena resources, evidence reads and AI verdicts
  retain their existing role/resource branches. Live WebRTC signaling still checks
  Teacher/Student role, enrollment, Teacher ownership and Pro access.
- Existing Teacher/Student-only domain routes (billing, quiz submission/retakes,
  approvals, violations/evidence upload, progression, AI creation and Teacher
  Evidence) still use compatibility reads followed by explicit role checks.
- Some Teacher page loaders still call `getSession()`, under the strict Teacher
  layout and, where implemented, their own Teacher check.

This follow-up is not a whole-system migration of every domain resource API to
scope parameters. No identity/profile/notification consumer is left unscoped;
mixed resource APIs are not permitted to issue a replacement session class.

## Validation boundaries

Auth tests use mock database/cookies/providers and actual production handlers,
JWT signing/verification and Origin logic. No staging/production/E2E databases,
real mail or credentials are used. E2E cookie fixtures follow the new contract;
running those DB-backed suites requires separate authorization.

The original Phase 1 validation ran 78 focused tests. The blocker follow-up ran
130 focused auth/OTP/Admin lifecycle/redirect/retake/write-gate/transport tests
with zero failures/skips. The full Node suite passed 987 tests with four
unconfigured PostgreSQL suites skipped (991 total). Tests include 36 new
blocker/transport/integrated-shell regressions and real loopback HTTP stalls.
There was no live login, database mutation, mail delivery or E2E database run.
Lint excludes ignored `.data/**` runtime artifacts and the protected homepage.
Final follow-up checks passed: TypeScript without incremental caching, lint
(zero errors), production build and `git diff --check`. Lifecycle and actual
stalled-HTTP tests exited cleanly with no retained application timers/sockets.

## Phase 1 changed-file manifest

Paths below are relative to `C:\Users\Admin\ProctorShieldAI`. Protected pre-existing
homepage/DOCX worktree changes are not part of this implementation.

Authentication, routing and scoped consumers:

- `src/lib/auth.ts`
- `src/lib/auth-origin.ts` (new)
- `src/lib/logout-realtime.ts` (new)
- `src/proxy.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/register/route.ts`
- `src/app/api/auth/google/route.ts`
- `src/app/api/auth/verify-otp/route.ts`
- `src/app/api/auth/logout/route.ts`
- `src/app/api/auth/session/route.ts`
- `src/app/api/auth/profile/route.ts`
- `src/app/api/users/me/route.ts`
- `src/app/api/users/[id]/route.ts`
- `src/app/api/dashboard/admin/route.ts`
- `src/app/api/dashboard/admin/analytics/route.ts`
- `src/app/api/dashboard/admin/logs/route.ts`
- `src/app/api/dashboard/admin/users/[id]/route.ts`
- `src/app/api/dashboard/teacher/route.ts`
- `src/app/api/dashboard/teacher/reports/route.ts`
- `src/app/api/dashboard/student/results/route.ts`
- `src/app/api/notifications/route.ts`
- `src/app/api/pusher/auth/route.ts`
- `src/app/dashboard/admin/layout.tsx`
- `src/app/dashboard/teacher/layout.tsx`
- `src/app/dashboard/student/layout.tsx`
- `src/app/dashboard/admin/settings/content.tsx`
- `src/app/dashboard/teacher/settings/content.tsx`
- `src/app/dashboard/student/settings/content.tsx`
- `src/components/dashboard-shell.tsx`
- `src/components/name-enforcer.tsx`

Automated tests and fixtures:

- `tests/auth-session-foundation.test.ts` (new)
- `tests/auth-phase1-blockers.test.ts` (new)
- `tests/logout-realtime.test.ts` (new)
- `tests/backup-write-gate.test.ts` (logout outer-cleanup/gated-revocation contract)
- `tests/helpers/auth-fixture.ts` (new)
- `tests/otp-auth-flow.test.ts`
- `tests/admin-auth-redirect.test.ts`
- `tests/admin-shared-shell-session-loss.test.ts`
- `tests/admin-ai-logs-pagination.test.ts`
- `tests/admin-realtime-presence.test.ts`
- `tests/admin-settings-controls.test.ts`
- `tests/admin-statistics.test.ts`
- `tests/admin-suspension-safety.test.ts`
- `tests/admin-user-mutation-atomicity.test.ts`
- `tests/admin-user-update-validation.test.ts`
- `tests/student-attempt-history.test.ts`
- `tests/student-retake-eligibility.test.ts`
- `tests/teacher-dashboard-report-metrics.test.ts`
- `tests/proctored-runtime-stability.test.ts`
- `tests/paymongo-postgres-concurrency.test.ts` (auth/Origin mock contract only)
- `e2e/helpers/auth.ts` (cookie/token fixture contract only)
- `e2e/quiz-deletion-arena-sequence.spec.ts` (cookie/token fixture contract only)
- `e2e/security-flows.spec.ts` (cookie/token fixture contract only)
- `docs/auth-session-foundation.md` (new)
