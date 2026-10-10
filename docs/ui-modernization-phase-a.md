# ProctorShieldAI UI modernization — Phase A

## Checkpoint and scope

Workspace: C:\Dev\ProctorShieldAI-landing-redesign. Branch: codex/landing-redesign.
Fetched origin/main: 3e016784e15e20c2b55dbf3dc09c5a16ca0d3dc4; local HEAD matches, zero divergence.
This baseline includes the Next.js 16.3.8 security patch, EXP presentation cleanup,
Teacher/Student UI fixes, and historical Teacher verdict score units.

Phase A establishes the palette and migration plan. Existing application pages
are not restyled. The approved landing source, official assets, Velaris background,
speed 2, and existing branding integrations remain intact. The brief's reference
to the older Lime Green Gradient does not authorize reverting the current Velaris.
No next phase starts before visual approval. No commit, push, merge or deployment.

## Route and component audit

29 page routes exist. Registration, OTP and password reset are states within
existing authentication pages, not new routes. API routes are excluded from visual work.

| Boundary | Existing routes | Visual owners and protection |
| --- | --- | --- |
| Landing | / | page.tsx + landing.module.css + Velaris + BrandImage; intentionally theme-independent |
| Public authentication | /login, /login/student, /login/teacher, /login/forgot-password | Unified login/content.tsx and unified-google-signin.tsx; role pages own registration and OTP; recovery page owns email/reset/done steps. Preserve handlers, payloads, validation and destinations |
| Deprecated Admin entry | /admin/login | page.tsx intentionally calls notFound(); custom not-found.tsx/module.css own artwork and Back to Home. Do not restore a deprecated sign-in workflow |
| Join | /join | Client join lookup, eligibility, code normalization, Arena routing and sound behavior remain unchanged |
| Student | /dashboard/student, /quizzes, /results, /reports, /settings under that prefix | Server layout uses getUserSession and Student guard; DashboardShell, NameEnforcer, RetakeRedirect, content components and student/ResultModal |
| Teacher | /dashboard/teacher, /quizzes, /playground, /playground/arena/[id], /monitor, /evidence, /reports, /billing, /settings under that prefix | Server layout uses getUserSession and Teacher guard; DashboardShell; teacher-content compatibility scope; teacher-media; proctorshield-create-hub and proctorshield-quiz-editor; shared ai-reports |
| Admin | /dashboard/admin, /users, /quizzes, /analytics, /logs, /settings under that prefix | Separate getAdminSession guard; DashboardShell; existing confirmations, logs, account actions and settings handlers |
| Examination | /quiz/[id] | Standalone client runner couples presentation to AI model loading, camera/mic, timers, warnings, autosave and submission. Change visual classes only in Phase F |
| Arena | /arena/[id] | Server/client entry + arena identity, battle dock, effects and podium components. Preserve all timers, events, points and controls |

Other shared UI: NameEnforcer/profile completion; DashboardShell notifications and
profile menus; ResultModal; shared report presentation; imperative toast classes
in globals.css; CSS modal viewport contract. These are migration targets, not
permission to replace components or move behavior into a new design abstraction.
No root custom 404 exists; the reported custom 404 is the deprecated Admin entry.

## Current styling and theme behavior

- Tailwind v4 via globals.css, plus CSS Modules for landing, branding, Arena effects and custom 404.
- Existing blue global variables and broad dashboard/auth selectors remain. Some use !important and match utility substrings; migrate these explicitly in approved phases rather than adding competing overrides.
- Teacher CSS maps legacy dark utilities within teacher-content and scopes portal content. Preserve those protections until each consumer is deliberately migrated.
- DashboardShell is the single theme owner for Student, Teacher and Admin. It toggles html.dark, persists localStorage key theme, honors saved valid light/dark values and otherwise tracks the OS preference. Storage failure handling and listener cleanup remain.
- No ThemeProvider exists. No provider, duplicate app state, preference key or database setting is introduced.
- Theme starts as light and the saved preference applies in an effect. Root layout suppressHydrationWarning does not prevent a first-paint flash. Public/auth and standalone quiz/Arena routes do not mount DashboardShell, so direct-load saved preference handling is not universal. This is an existing limitation, not resolved by token declarations.
- Before any shared first-paint initialization change, request approval for a minimal pre-paint bootstrap reusing the same key/class. Preserve shell ownership and hydration consistency; do not silently add controls or preferences to public/exam routes.
- Evidence fullscreen content uses createPortal; token declarations on html inherit into body portals. Future portal classes must opt into visual styles explicitly. Do not rely solely on dashboard wrapper selectors.

## Semantic foundation

src/styles/proctorshield-tokens.css declares only prefixed --ps-* variables on
:root and html.dark. globals.css imports it once. No old token is overwritten,
no element selector restyles a page, and no animation or state handler is added.

| Purpose | Light | Dark |
| --- | --- | --- |
| Canvas | Pearl #f3f8f1 | Approved forest #012620 |
| Card | White #ffffff | Emerald #10352b |
| Primary text | Forest #10251e | Pearl #eefaf2 |
| Secondary / muted text | #345449 / #516b5e | #c7e5d5 / #afd0c2 |
| Primary action / foreground | #17664d / white | Mint #91eacb / #062b21 |
| Teal accent | #14675f | #9de7dc |
| Gold text accent | #89651c | Logo champagne #e5c77f |

The original bright gold is an accent rather than body text on white; the light
gold text token is darker for legibility. Success, warning, error and information
retain separate semantic colors and must also use explicit words/icons.

Tokens cover opaque and glass surfaces, primary/hover/foreground, body typography,
muted text, control borders, focus, status backgrounds, shadows, radii, spacing,
44px minimum control height and fixed dark media. Decorative borders are subtle;
interactive boundaries use the stronger border-control token. Body size is 16px,
caption 14px for future adoption; existing landing typography is untouched.

Glass must be placed over a known opaque surface. Do not overlay text directly
on unpredictable video or gradients and assume the palette guarantees contrast.
Use the opaque fallback first and limit blur to small non-media surfaces.

## Migration strategy and acceptance gates

1. Phase B: scoped CSS Modules/classes for existing auth content and its current states. Keep Google-owned rendering and every handler intact. Review both supported theme presentations, error/loading/OTP/reset states, focus and mobile. Theme bootstrap requires separate approval as described above.
2. Phase C: Student page surfaces, Quick Join, cards, results, settings and shared shell visual integration. Because the shell serves all roles, scope adoption to the approved role until the other phases are approved. Verify notification filtering/unread counts, retake flows and exam averages separately from Arena points.
3. Phase D: Teacher overview, editor dialogs, quiz lists, Playground/host, reports, billing, monitor/evidence outer UI and settings. Preserve complete teacher-content behavior, portal scopes and dark teacher-media. Do not reintroduce Live Biometric Telemetry. Historical Arena points remain pts, exams %, invalidated/missing labels unchanged.
4. Phase E: Admin shell/pages using the same semantic tokens. Preserve session separation, RBAC, mutations, confirmations and audit trails; no endpoint/payload modifications.
5. Phase F: only static, scoped visual styling in active quiz/Arena. No shader or gradient animation copies. Keep warning/media/control stacking, timers, power-ups, points, ranking, realtime and submission logic byte-preserved where possible.
6. Phase G: Join, remaining shared dialogs/toasts/notifications/404 and consistency audit. Review portals, table scrolling, touch targets, themes and unchanged official logo proportions. No EXP presentation restoration.

Use semantic CSS variables in scoped styles rather than mass substitutions of
color utility names. Introduce no component library/dependency in Phase A.
Role identity accents and category colors may remain distinct; brand unity does
not require replacing every status color with green. Use color-scheme only in
the approved component scope for native form controls, not globally on landing.

For every phase: source/API diff review, focused regressions, lint, TypeScript,
desktop/mobile screenshots and keyboard/overflow checks. Role phases additionally
need saved/system/toggled theme, navigation/reload, menus, notifications, dialogs,
loading/errors and authenticated QA. Real monitoring/camera/three-strike behavior
cannot be declared passed from screenshots or fixtures. Full suite, production
build and applicable E2E precede any final release; run expensive checks sequentially.

## Phase A preview and validation scope

Local review: http://127.0.0.1:3450/design-phase-a-review.html using the already
running preview server. public/design-phase-a-review.html is a temporary review
artifact, not an application workflow or a file to ship in a production commit.
It contains a snapshot of the tokens for review and sample controls only. Its
toggle changes only that standalone preview document; it writes no preference
and does not replace application theme state. Remove the review asset before
release integration; keep screenshots/HTML in the external artifact folder.

Foundation contrast checks validate declared opaque sRGB combinations: normal
text minimum 4.5:1 and focus/control boundaries minimum 3:1. This is not a claim
that unmodified application pages already meet all accessibility requirements.
Check glass compositing and actual text/background combinations again on adoption.

Screenshots: desktop 1440×900 and mobile 390×844, both themes. The foundation
preview switches immediately, has visible keyboard focus and no horizontal
overflow. Existing role theme persistence/navigation are covered by component
fixture tests, not a signed-in browser session. Authenticated initial paint,
portal appearance and camera/game runtime remain future-phase validation.

## Safety record

External before.json records all existing source file hashes and protected
Teacher, Student and mobile worktree dirty-file hashes, heads, branches and status.
Compare again at completion. The only intended existing-file edit in this phase
is the token import in globals.css. All pre-existing landing/branding work remains.
No protected worktree, API, schema, dependency, credential, detector, experiment,
Arena calculation or deployment setting is changed. No Docker/PostgreSQL/Redis
or additional application server is started.

## Completion results

- 7 new token contrast/isolation tests passed; 79 existing focused regressions passed. No failures or skips in these runs.
- Existing coverage includes Student/Teacher/Admin saved preferences, immediate toggles, navigation/remount persistence, system fallback, storage failures, authentication/OTP, Student averages, historical Teacher score units, Arena deadlines and monitor render/pipeline guards.
- Focused ESLint, TypeScript noEmit (1280 MB heap, no incremental output), PostCSS parsing and git diff --check passed.
- Foundation-only browser review: light/dark desktop and mobile, instant toggles, no horizontal overflow, keyboard focus and native select. This is not authenticated application or real camera/gameplay QA.
- 466 previously existing repository files retained their hashes; the only existing-file delta is the one-line CSS import. 31 dirty files in the three protected source workspaces retained their hashes and their branches/heads are unchanged.
- Teacher workspace status additionally shows a new untracked public/videos/ folder that appeared after the initial snapshot; no operation in this phase wrote to that workspace. Leave that folder untouched.
- HEAD and fetched origin/main remain 3e016784e15e20c2b55dbf3dc09c5a16ca0d3dc4. Nothing staged. Final status: 16 modified and 14 untracked files including preserved earlier work and the temporary review HTML.
- Full suite, build, E2E, authenticated role theme screenshots and live monitoring/gameplay validation are not run for this foundation checkpoint. Initial theme flash remains an explicitly documented existing limitation.

Phase A files: src/app/globals.css, src/styles/proctorshield-tokens.css,
tests/design-token-contrast.test.ts, docs/ui-modernization-phase-a.md, and the
temporary public/design-phase-a-review.html. Remove that review asset before a
production commit; external screenshots and standalone HTML are preserved.
## Architecture correction and preview retirement (2026-10-09)

The temporary public/design-phase-a-review.html was copied, hash-verified and
removed from public. Its review copy and screenshots remain outside the repository.
It was never an App Router route or an application workflow, but public assets
would be deployable if left in place. No standalone review HTML ships now.

App Router remains the sole application router. Existing React/TypeScript TSX
components, Tailwind v4 and its existing PostCSS integration remain. Semantic
CSS variables are consumed by Tailwind arbitrary-value utilities and scoped
styles; no second frontend, theme provider, dependency or preference key was added.
The approved landing page, Velaris background and official assets remain unchanged.
Future visual reviews use Next.js-rendered components. Temporary development TSX
state previews must be removed before final validation/integration.

Phase B approval explicitly permits a presentation-only first-paint fix. The
fixed inline bootstrap uses the existing theme storage key and html.dark class,
following the installed Next.js guide. The initial-flash risk is mitigated by
pre-paint initialization; production CSP/hydration and cross-role visual QA remain
release checks. No session or authentication behavior is changed.
