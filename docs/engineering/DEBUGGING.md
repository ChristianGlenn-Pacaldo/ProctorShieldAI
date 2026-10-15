# Refactoring and debugging guide

This engineering guide accompanies the local refactor branch. Capstone manuscripts and deployment remain separate and paused. The release baseline is commit d61e2ec46d9bc97bd5a458e3f5f952e1bc34aec3.

## Architecture currently implemented

The application stays in one Next.js deployment. The Teacher quiz library is the first feature extracted; the rest of the project still uses its existing structure.

- src/app/dashboard/teacher/quizzes/page.tsx: authenticated layout integration and initial entitlement props.
- src/app/dashboard/teacher/quizzes/content.tsx: compatibility entry point; existing URL is unchanged.
- src/features/quizzes/components/teacher-quizzes.tsx: screen state and action coordination, including the existing Studio/scanner flow.
- src/features/quizzes/components/teacher-quiz-library.tsx: search, table, empty/loading/failure states.
- src/features/quizzes/components/quiz-request-panels.tsx: late-join and retake presentation.
- src/features/quizzes/components/manage-quiz-dialog.tsx: management dialog presentation. Mutations remain in the screen controller.
- src/features/quizzes/types.ts: browser-safe contracts, without ORM or session dependencies.
- src/features/quizzes/domain/teacher-quiz-library.ts: pure display filtering, independently testable.
- src/features/quizzes/server/teacher-quiz-library.ts: Teacher list queries and response assembly. Dependencies are explicit for synthetic tests. This is server-only and must only be called after verifying the Teacher session.
- src/server/observability/request-context.ts: server-generated request IDs and minimized list-failure logs.
- src/shared/http/request-id.ts: bounded tracing references safe to display in the browser.

Server authorization remains in the API handler and existing auth helpers. Client filtering never grants access. Teacher ownership filters, role/session isolation, database operations and the Arena-disabled policy are preserved. ESLint blocks imports of server infrastructure into the new feature UI/domain folders. No broad barrel file mixes server and browser exports.

## Trace a Teacher list failure

1. Reproduce on local/synthetic data first. Look at GET /api/quizzes in the browser Network panel.
2. On a server failure, copy only the X-Request-ID shown in the error notice. Retry remains available and existing rows remain visible during a refresh failure.
3. Find the matching requestId in the server console. The event uses operation quizzes.list and code QUIZ_LIST_FAILED.
4. Inspect the service/query boundary with a debugger and synthetic fixtures. Request tracing intentionally does not log raw exceptions, request bodies, academic answers, user identities, evidence locations or credentials.
5. Check authentication before changing any query scope. Never derive ownership from a browser-supplied Teacher ID.

Tracing currently covers only the quiz-list failure path. Other endpoints still have legacy logging; a complete logging/privacy audit is a later step. This change does not create an evidence-access audit system or change evidence permissions.

## Local verification

Use Node.js 24 and the existing locked dependencies. Keep this branch active while reviewing: changes are intentionally uncommitted.

- npm run test:refactor: focused behavior/security checks using synthetic dependencies.
- npm run test:refactor:browser: actual v3 and refactored components with local data/router fixtures, in Chromium. Requires the existing Playwright browser installation.
- npm test: complete existing unit/regression suite.
- npm run lint -- --quiet: lint errors; legacy warnings are tracked separately.
- npx tsc --noEmit --incremental false: TypeScript.
- npm run build: production build.
- npm run dev: local application review. Use synthetic test accounts/data; local development may use configured services.

Browser comparisons enforce library pixel equivalence and modal DOM, computed-style and geometry equivalence. Full modal screenshots are retained as diagnostics: local Chromium intermittently captures a blank portal in the unchanged v3 baseline, so those pixels are not a reliable automated gate. Manual visual review remains required.

Browser comparisons cover 360, 390, 768, 1280 and 1440 pixels in light/dark themes, library filtering, Manage layout, Arena absence, safe load-error references and Retry. The harness does not establish authenticated staging behavior, actual camera/device behavior or AI accuracy. It blocks external requests and does not touch academic records.

The existing VM regression harnesses now bundle the actual extracted modules, preserving mocked provider/HTTP/database boundaries. Functional child components are rendered rather than replaced with stubs. Historical source assertions remain where not yet migrated. Release-preservation hashes retain their historical values with explicit refactor exceptions; they are not a substitute for behavior or visual checks.

## Disposable database MVP checks

`scripts/mvp-database.mjs` creates its own loopback PostgreSQL/Redis containers, with ownership labels and synthetic accounts. It refuses an existing account database URL or unexpected dotenv files. It applies existing migrations only to its newly created empty database; it does not run the project seed. Docker must already be available. No Railway connection is used.

Use Node 24, Docker, OpenSSL (Git for Windows provides it), the installed Playwright Chromium browser, and a successful production build. `node scripts/mvp-database.mjs prepare` provisions the fixture; `node scripts/mvp-database.mjs atomic` runs independent-connection transaction checks; `node scripts/mvp-database.mjs test` runs real password/session and database-backed browser checks. Run these separately from builds, model benchmarks and artifact hashing on memory-limited hosts.

The full quiz UI test supplies a labeled synthetic canvas camera and silent generated audio. A blank canvas can legitimately trigger no-face alerts, which the test acknowledges through the normal UI. It does not use a person's camera or student evidence. Real COCO weights are reused from `.tmp-stabilization-model-cache`; the opt-in `tests/proctoring-latency.browser.ts` benchmark prepares that cache from the official model source. Database workflow tests do not verify cold cloud delivery, classroom load or physical-device accuracy.

`node scripts/mvp-database.mjs serve` starts the compiled app at `https://127.0.0.1:3186/login` with a local self-signed certificate. Test contexts ignore only this local certificate error; the harness never installs a trusted certificate. Fixture accounts include `teacher-a@mvp.example.test`, `student-a@mvp.example.test` and `admin@mvp.example.test`, with the deliberately public fixture password `LocalMvpFixture2026`. Log out before switching roles in one browser session. These accounts cannot access staging or production.

Ports 25432/26379 are reserved for the owned database/cache. Data is disposable: PostgreSQL uses tmpfs, and Redis persistence is disabled. Stopping/removing the labeled fixture containers loses the fixture. Preserve all unrelated containers and existing databases. `.tmp-mvp-database/` and `release-review/` contain local state/certificates/results and must stay untracked. The existing in-memory preview at port 3147 remains a separate synthetic UI review.

## Next increments for review

1. Extract the remaining scanner/AI/billing presentation and screen actions as cohesive modules; retain session and request-order guards.
2. Apply the same route/service/policy separation to join and results, with HTTP contract tests first.
3. Extract submission only with transaction, idempotency, deadline and role-isolation regression checks.
4. Refactor the monitoring lifecycle last: permission ordering, timers, media-track cleanup, recovery and inference scheduling need actual device checks.
5. Extend minimized diagnostics endpoint by endpoint, and add feature fixtures instead of new source-text tests.

Each increment should be reviewed separately. Keep current URLs, response contracts, transaction boundaries, server authorization and public client behavior stable. Do not introduce generic repositories, a second backend, dependency upgrades or schema changes solely for folder organization. Arena code stays retained and disabled. Main, production, credentials, evidence and capstone documents must remain untouched by this local branch review.
