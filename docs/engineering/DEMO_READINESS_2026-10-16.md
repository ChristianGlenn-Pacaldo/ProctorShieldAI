# ProctorShield AI demo readiness — October 16, 2026

Demo target: https://proctorshieldai.site on October 17. This audit covers the full system requested by the owner, including admin, AI uploads, Google/email authentication and billing. It does not certify that every network, device or third-party request will succeed.

## Release and environment

The live baseline was ceedeae3b6084e0bf9e60634c4c10a6a1f25d989. Release work is isolated in branch codex/demo-readiness-monthly-ai, based on that exact commit. It preserves the live desktop device worker, authentication and provider error fixes. The older original checkout codex/full-stack-debugger differs substantially from live and must not be deployed wholesale.

The custom domain uses Railway project 8007b266-c02c-4c99-ba85-a210b7b3f777, environment staging (0a5835a6-ea32-44f5-848f-63e4536da240), app service 5bdc84f0-91cb-4328-b04c-d67b0d6eb133. Despite its name, staging is the public presentation environment. The separate production environment has no services.

Release status: **Deployed successfully and checked live.** Application commit b5ee43b, Railway deployment 5acd02a7-bb39-47e1-b824-c1a2b242ad2c. Final public verification completed October 16 at 22:37 UTC+8. The final report/browser-review test commit adds no application changes. The authoritative release checkout is C:/Users/Admin/.codex/worktrees/demo-readiness-monthly-ai/ProctorShieldAI.

## Fixed

1. **Free allowance is five manual quizzes per calendar month.** It resets automatically at midnight on the first in UTC+8; earlier months do not consume the current allowance. Current-month deletion does not restore usage. The per-teacher transaction lock prevents simultaneous requests from exceeding five. A single timestamp after obtaining the lock keeps the quota check and creation record in the same month. Pro remains unlimited and student limits remain 20/100.
2. **Connected pricing and documentation agree.** Homepage, billing, library usage badge, upgrade dialog, seed/bootstrap descriptions, maintained use-case documentation and document-generation scripts describe the monthly policy. Historical migrations remain intact. The existing Free plan metadata was backed up, then updated through one metadata-only Prisma migration; no quiz, answer, subscription or evidence history was deleted.
3. **Question papers are imported before generating new questions.** The prompt preserves wording, language, question order, choice order and choice count, including three-choice items. It does not pad short/unreadable papers with invented items. Notes still generate questions from their material. The response validates questions, bounds metadata, and returns review notices. Studio identifies inferred answer keys and asks teachers to compare every item with the source. OCR and inferred answers still require review.
4. **Temporary AI overload has bounded recovery.** Two primary attempts and one backup attempt share a 90-second deadline. The source and prompt remain the same. Credential and quota failures are not retried through another model. Existing safe timeout/quota responses remain intact. A real-provider test of the uploaded 13-item JPEG recovered through the backup and returned all 13 items in 88.6 seconds, including its three-choice question. This was an unsaved draft test, not proof that inferred academic answers are correct.
5. **The matching PayMongo test webhook was disabled.** Its signing secret matched the deployed app. A correctly signed, nonpayment no-op was accepted (200, Event ignored); an invalid signature was rejected (401). The same hook now points to https://proctorshieldai.site/api/billing/webhook and is enabled for paid-checkout/refund events. No unrelated account webhook was changed, no payment was fabricated and no money was charged. Re-enabling does not replay missed events.
6. **Preflight checks applied migrations.** A reachable database is no longer enough for local preflight. Missing or unfinished migrations fail a read-only gate. All ten prior live migration checksums matched the release source; the eleventh monthly metadata migration was applied successfully through the existing guarded migration service.
7. **Local reproducibility and lint traversal improved.** Dependencies were restored with the exact lockfile and Prisma regenerated. ESLint ignores generated .data runtime output and scratch logs. No package upgrade sweep or destructive cleanup was performed.

## Evidence and limits

| Check | Result | Practical limit |
| --- | --- | --- |
| Candidate regression suite | 2,141 passed, zero failed, four integration cases skipped by default | Synthetic dependencies are used in many unit tests; integration checks are separate below. |
| Candidate production build | Passed with locked Next.js 16.3.8, including TypeScript | Build success does not exercise device permissions or provider availability. |
| Candidate lint | Zero errors, 857 warnings | Existing typing/hooks/style debt remains; warnings are not 857 observed runtime failures. |
| Production dependency audit | Zero known advisories in the audited lockfile | Does not establish absence of application vulnerabilities. |
| Database-backed desktop/mobile browser checks | 36 passed across the main run and focused reruns (32 original flows + 2 corrected monthly checks + 2 AI preview checks). The initial reset fixture used local-time raw SQL; corrected to explicit UTC. | Owned loopback PostgreSQL/Redis with synthetic accounts and media. No real-user DB was used. |
| Public desktop/mobile browser checks | 29 passed, zero failed; one desktop skip for a mobile-only regression. | Local production build; fonts/providers are isolated where appropriate. |
| PostgreSQL concurrency/integration checks | 95 passed, zero failed or skipped, including independent payment/refund/manual-entitlement concurrency. | Separate disposable databases for billing/Arena transactional behavior. |
| Live public entry and health | Homepage/login/health HTTP 200; signed-out protected APIs reject access | Health does not prove inbox delivery or an entire checkout. |
| Live database | Ten prior migrations completed; required evidence/payment/accounting columns present; eleventh metadata migration applied | Root .env points at a different, older database. |
| Live Google + email OTP | Owner completed sign-in and reached the teacher portal | Owner reported slow verification; no measured delivery SLA is claimed. |
| Live teacher screens | Dashboard, quizzes, monitor, AI reports, evidence and billing loaded; existing video ready with no player error | Monitor had no active students. No complete cross-device live attempt was performed. |
| Live AI paper test before release | Primary provider returned busy; no quiz was saved | The fixed route was also tested against real providers separately. Updated live upload guidance and teacher-session continuity were verified after deployment. The original uploaded browser tab could not be reattached and automated file selection is blocked by the extension setting, so a new live image-generation UI success is not claimed. The actual uploaded JPEG was tested against real providers through the candidate route; desktop/mobile preview UI was separately tested with a simulated provider response. |
| Live billing | Existing Pro subscription visible; deployed mode is test; signature checks passed and webhook restored | No complete new sandbox checkout/refund was performed against a live demo account. |
| Live admin authentication | One attempt with the existing locally configured admin credentials returned 401 | Credentials were not guessed or reset. Synthetic admin login/role tests are separate. |
| Post-deployment desktop model assets | All nine allowlisted model/worker/JS/WASM HEAD requests returned 200; unknown asset returned 404 | The model route validates its pinned hash before responding. Physical-camera inference remains separate. |
| Live COCO delivery | Manifest and all five shards HTTP 200, about 18.6 MB | Transfer availability does not prove physical-camera detection accuracy. |

Post-deployment runtime sampling showed one initial Redis readiness retry followed by a shared-cache connection; subsequent public health returned 200. No Prisma/module/port/internal-server failure marker appeared in that short sample. This is a short readiness check, not long-term monitoring.

Nonsecret audit logs are under the original checkout's tmp/mvp-audit-* and tmp/mvp-candidate-* paths. Browser/integration logs are under the release worktree's release-review directory. Local model media tests use synthetic streams and actual downloaded COCO weights; physical-person inference remains a separate acceptance check. The original user-owned FINAL DOCUMENTATION folder was preserved.

Visual proof: [live AI upload guidance](../assets/demo-readiness-2026-10-16/live-ai-upload.png). Desktop/mobile pricing, billing and AI review screenshots are also retained under the release worktree's .tmp-mvp-e2e and .tmp-mvp-database directories.

## What is unnecessary for the assessment MVP

| System part | Recommendation | Why |
| --- | --- | --- |
| Quiz creation/editing, access codes, join/lobby, timing, autosave, submission, results | Keep | This is the core assessment workflow. |
| Role separation, ownership, sessions, privacy/device acknowledgement, reports/evidence | Keep | Required for a credible proctoring system. Automated signals must not be presented as independently proven cheating. |
| AI import/generation, Google/OTP and billing | Keep in this full-system presentation | These are explicitly in the requested scope. Prepare saved data and signed-in accounts because providers can fail. |
| Power Arena, combat/recovery, attacks/shields | Defer and keep disabled | It adds a second product and substantial state/concurrency surface without proving proctored assessment. Do not delete historical data. |
| EXP, cosmetics, rewards and extra gamification | Optional after the core demo | Engagement features are not needed to prove reliable exams and monitoring. |
| Cinematic/decorative animation | Keep stable; defer further work | Polish is lower priority than rehearsing the actual flow. |
| Welcome/result notification email | Lower priority than OTP | Results are already accessible in-app; OTP directly affects sign-in. |
| Multiple email-provider support and unused developer scripts | Cleanup later | Keep one reliable selected deployed provider; verify actual usage before removing scripts. |
| Broad architectural refactoring | Defer | Avoid destabilizing session, submission and monitoring lifecycles before the presentation. |

## Remaining backlog and demo risks

1. **Rehearse with the exact physical teacher and student devices.** Check camera/microphone permissions, actual face/device inference, Pusher monitor updates, disconnect/reconnect, and evidence playback. Synthetic browser media cannot validate real lighting, hardware or mobile browser restrictions.
2. **Confirm the live admin account before presenting that portal.** The local admin credential did not authenticate. No password reset or privilege change was made during this audit.
3. **Perform a complete designated-account sandbox checkout and refund rehearsal.** The webhook is restored and server signature/idempotency paths are tested, but no new end-to-end provider payment/refund is claimed. Show test mode clearly. A success redirect alone is not payment verification.
4. **Keep AI as reviewed assistance.** The 13-item paper has no supplied answer key. Compare spelling, names, choices and answers before saving. Provider overload and latency remain external dependencies even with fallback.
5. **Repair stale local environment configuration after the demo.** Root .env uses an expired tunnel and an older remote database missing prior migrations. This does not describe the verified Railway live DB. Do not apply arbitrary migrations to that older database or deploy the older checkout without reconciliation. Local EMAIL_PROVIDER was explicitly set to smtp after authentication-only verification; deployed email remains gmail-api.
6. **Reduce 857 lint warnings in small follow-up changes.** Review hook dependencies and untyped boundaries. Replace brittle source/hash assertions with behavior tests where practical, while preserving the existing release protection contract.
7. **Monitor secret-safe diagnostics.** Avoid raw provider exceptions, signed storage URLs, answer content or evidence in logs. Keep public deployment metadata separate from private credential exports.

## Presentation runbook

1. Use the custom domain and the exact presentation network. Sign in ahead of time with separate browser profiles/devices for teacher, student and admin; changing roles in one profile replaces its session.
2. Prepare a saved two-question quiz, a completed attempt with playable evidence, and the uploaded paper. Use clearly marked demo data. Keep the saved quiz available if AI is busy.
3. Show monthly Free pricing and the Pro feature boundary. Free users get five manual quizzes per calendar month; AI, live monitoring, evidence replay and AI reports require Pro.
4. Import the paper, compare the draft and review inferred answers before saving. Avoid relying on an immediate fresh provider response during the presentation.
5. Activate the quiz, copy the access code, join as student, acknowledge privacy, allow the necessary devices, start as teacher, answer and submit. Show persisted results and the owning teacher's reports/evidence.
6. Open the monitor before starting and let scanning initialize. Three persisted integrity violations invalidate an attempt and remove its academic score; use a disposable demo attempt for deliberate violation demonstrations.
7. Show admin read-only screens first. Avoid suspending active demo accounts, deleting the active quiz or changing global settings in the main presentation.
8. Show billing in test mode with a separate demo account and verify the actual provider-confirmed entitlement. Keep the existing Pro account ready for the rest of the flow.
