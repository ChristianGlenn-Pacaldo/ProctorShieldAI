param(
  [Parameter(Mandatory = $true)][string]$SddReference,
  [Parameter(Mandatory = $true)][string]$StdReference,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'

function Color([int]$red, [int]$green, [int]$blue) {
  return $red + (256 * $green) + (65536 * $blue)
}

$Black = Color 0 0 0
$White = Color 255 255 255
$DarkBlue = Color 31 78 120
$LightBorder = Color 217 217 217

function Configure-Styles($document) {
  $normal = $document.Styles.Item('Normal')
  $normal.Font.Name = 'Arial'
  $normal.Font.Size = 10
  $normal.Font.Color = $Black
  $normal.ParagraphFormat.SpaceAfter = 6
  $normal.ParagraphFormat.LineSpacingRule = 0

  $title = $document.Styles.Item('Title')
  $title.Font.Name = 'Arial'
  $title.Font.Size = 18
  $title.Font.Bold = -1
  $title.Font.Color = $Black
  $title.ParagraphFormat.Alignment = 1
  $title.ParagraphFormat.SpaceAfter = 8
  $title.ParagraphFormat.Borders.Enable = 0

  $heading1 = $document.Styles.Item('Heading 1')
  $heading1.Font.Name = 'Arial'
  $heading1.Font.Size = 14
  $heading1.Font.Bold = -1
  $heading1.Font.Color = $Black
  $heading1.ParagraphFormat.SpaceBefore = 12
  $heading1.ParagraphFormat.SpaceAfter = 6
  $heading1.ParagraphFormat.KeepWithNext = -1

  $heading2 = $document.Styles.Item('Heading 2')
  $heading2.Font.Name = 'Arial'
  $heading2.Font.Size = 11
  $heading2.Font.Bold = -1
  $heading2.Font.Color = $Black
  $heading2.ParagraphFormat.SpaceBefore = 9
  $heading2.ParagraphFormat.SpaceAfter = 4
  $heading2.ParagraphFormat.KeepWithNext = -1
}

function Add-Paragraph($document, [string]$text, [string]$style = 'Normal', [bool]$bold = $false, [int]$alignment = 0, [switch]$PassThru) {
  $range = $document.Range($document.Content.End - 1, $document.Content.End - 1)
  $paragraph = $document.Paragraphs.Add($range)
  $paragraph.Range.Text = $text
  try { $paragraph.Style = $style } catch { $paragraph.Style = 'Normal' }
  $paragraph.Range.Font.Name = 'Arial'
  $paragraph.Range.Font.Color = $Black
  if ($bold) { $paragraph.Range.Font.Bold = -1 }
  $paragraph.Alignment = $alignment
  $paragraph.Range.InsertParagraphAfter()
  if ($PassThru) { return $paragraph }
}

function Add-CenteredLine($document, [string]$text, [double]$size, [bool]$bold = $true, [string]$style = 'Normal') {
  $paragraph = Add-Paragraph $document $text $style $bold 1 -PassThru
  $paragraph.Range.Font.Size = $size
  $paragraph.Range.ParagraphFormat.SpaceAfter = 4
}

function Add-Bullet($document, [string]$text) {
  $paragraph = Add-Paragraph $document $text 'Normal' $false 0 -PassThru
  $paragraph.Range.ListFormat.ApplyBulletDefault()
  $paragraph.Range.ParagraphFormat.LeftIndent = 18
  $paragraph.Range.ParagraphFormat.FirstLineIndent = -9
}

function Add-PageBreak($document) {
  $range = $document.Range($document.Content.End - 1, $document.Content.End - 1)
  $range.InsertBreak(7)
}

function Add-Table($document, [string[]]$headers, [string[]]$keys, [object[]]$rows, [double]$fontSize = 8.5) {
  $range = $document.Range($document.Content.End - 1, $document.Content.End - 1)
  $table = $document.Tables.Add($range, $rows.Count + 1, $headers.Count)
  $table.AllowAutoFit = $true
  $table.AutoFitBehavior(2)
  $table.Range.Font.Name = 'Arial'
  $table.Range.Font.Size = $fontSize
  $table.Range.ParagraphFormat.SpaceAfter = 0
  $table.Range.ParagraphFormat.SpaceBefore = 0
  $table.Range.Cells.VerticalAlignment = 1
  $table.Rows.Item(1).HeadingFormat = -1
  $table.Rows.Item(1).Range.Font.Bold = -1
  $table.Rows.Item(1).Range.Font.Color = $White
  $table.Rows.Item(1).Shading.BackgroundPatternColor = $DarkBlue

  for ($column = 1; $column -le $headers.Count; $column++) {
    $table.Cell(1, $column).Range.Text = $headers[$column - 1]
    $table.Cell(1, $column).Range.ParagraphFormat.Alignment = 1
  }

  for ($rowIndex = 0; $rowIndex -lt $rows.Count; $rowIndex++) {
    $item = $rows[$rowIndex]
    for ($column = 0; $column -lt $keys.Count; $column++) {
      $value = $item.($keys[$column])
      $table.Cell($rowIndex + 2, $column + 1).Range.Text = [string]$value
      $table.Cell($rowIndex + 2, $column + 1).Range.ParagraphFormat.Alignment = 0
    }
    if (($rowIndex % 2) -eq 1) {
      $table.Rows.Item($rowIndex + 2).Shading.BackgroundPatternColor = Color 242 246 250
    }
  }

  # Word's Borders collection also contains diagonal-up and diagonal-down
  # entries. Enabling the whole collection draws an X through every cell.
  # Apply only the outside and inside grid borders, and explicitly disable
  # both diagonal border types.
  foreach ($borderIndex in @(-1, -2, -3, -4, -5, -6)) {
    $border = $table.Borders.Item($borderIndex)
    $border.LineStyle = 1
    $border.LineWidth = 4
    $border.Color = $LightBorder
  }
  foreach ($diagonalIndex in @(-7, -8)) {
    $table.Borders.Item($diagonalIndex).LineStyle = 0
  }
  foreach ($cell in $table.Range.Cells) {
    $cell.TopPadding = 4
    $cell.BottomPadding = 4
    $cell.LeftPadding = 5
    $cell.RightPadding = 5
  }
  $after = $document.Range($table.Range.End, $table.Range.End)
  $after.InsertParagraphAfter()
  return $table
}

function Add-FrontMatter($document, [string]$documentTitle, [string]$subtitle) {
  Add-CenteredLine $document 'CORDOVA PUBLIC COLLEGE' 14 $true
  Add-CenteredLine $document 'COLLEGE OF COMPUTER STUDIES' 12 $true
  Add-Paragraph $document ''
  Add-CenteredLine $document $documentTitle 18 $true 'Title'
  Add-CenteredLine $document $subtitle 11 $true
  Add-Paragraph $document ''
  Add-CenteredLine $document 'PROCTORSHIELD AI: AI-ASSISTED ONLINE EXAMINATION AND PROCTORING SYSTEM' 11 $true
  Add-CenteredLine $document 'Version 1.0 | 5 September 2026' 10 $true
  Add-PageBreak $document

  Add-Paragraph $document 'Approval and Project Team' 'Heading 1'
  Add-Table $document @('Role','Name','Signature','Date') @('Role','Name','Signature','Date') @(
    [pscustomobject]@{Role='System Developer / Project Manager';Name='Jenelyn S. Inoc';Signature='';Date=''},
    [pscustomobject]@{Role='Backend and Database Developer';Name='Christian Glenn C. Pacaldo';Signature='';Date=''},
    [pscustomobject]@{Role='Frontend Developer';Name='Dheyan J. Pino';Signature='';Date=''},
    [pscustomobject]@{Role='Project Adviser';Name='';Signature='';Date=''},
    [pscustomobject]@{Role='Panel Member';Name='';Signature='';Date=''},
    [pscustomobject]@{Role='Panel Member';Name='';Signature='';Date=''}
  ) 8.5 | Out-Null

  Add-Paragraph $document 'Revision History' 'Heading 1'
  Add-Table $document @('Version','Date','Description of Changes','Author') @('Version','Date','Description','Author') @(
    [pscustomobject]@{Version='1.0';Date='5 September 2026';Description='Initial ProctorShield AI document created from the audited as-built codebase, SRS, SPMP, automated checks, and operational configuration.';Author='ProctorShield AI Project Group'}
  ) 8.5 | Out-Null

  Add-Paragraph $document 'Project Team Contribution Allocation' 'Heading 1'
  Add-Table $document @('Member','Role','Primary Contribution','Allocation') @('Member','Role','Contribution','Allocation') @(
    [pscustomobject]@{Member='Jenelyn S. Inoc';Role='Project Manager';Contribution='Planning, requirements coordination, review, documentation governance, and acceptance coordination.';Allocation='For team approval'},
    [pscustomobject]@{Member='Christian Glenn C. Pacaldo';Role='Backend and Database Developer';Contribution='Route Handlers, authentication, Prisma/PostgreSQL, billing, storage, security hardening, deployment, and technical documentation.';Allocation='For team approval'},
    [pscustomobject]@{Member='Dheyan J. Pino';Role='Frontend Developer';Contribution='Next.js interfaces, responsive dashboards, exam client, client-side proctoring, live-monitor views, and usability testing.';Allocation='For team approval'}
  ) 8 | Out-Null
  Add-Paragraph $document 'Contribution percentages are intentionally left for formal team approval; this document does not invent unsupported allocation figures.' 'Normal' $true
  Add-PageBreak $document
}

function Build-Sdd($word, [string]$reference, [string]$output) {
  Copy-Item -LiteralPath $reference -Destination $output -Force
  $document = $word.Documents.Open($output, $false, $false)
  try {
    $document.Content.Text = ''
    Configure-Styles $document
    Add-FrontMatter $document 'SOFTWARE DESIGN DOCUMENT' 'ProctorShield AI System Design Specification'

    Add-Paragraph $document '1. Introduction' 'Heading 1'
    Add-Paragraph $document 'This Software Design Document defines the as-built architecture, component responsibilities, data model, interfaces, security controls, operational design, and known limitations of ProctorShield AI. It is intended for the project team, technical adviser, quality reviewers, deployment operators, and future maintainers.'
    Add-Paragraph $document 'The design prioritizes server-authoritative quiz state and grading, role isolation, bounded evidence capture, privacy-aware browser-side inference, resilient shared state, and explicit Free and Pro entitlements. The current baseline is suitable for controlled acceptance testing; final production acceptance still depends on the open verification items listed in Section 10.'

    Add-Paragraph $document '1.1 Scope and Design Goals' 'Heading 2'
    Add-Bullet $document 'Support Student, Teacher, and Admin roles through responsive browser interfaces without a required desktop installation.'
    Add-Bullet $document 'Prevent students from answering before a teacher starts the quiz and preserve answer state during reconnects.'
    Add-Bullet $document 'Detect supported visual and browser-integrity events locally while sending only bounded snapshots, metadata, and short incident clips.'
    Add-Bullet $document 'Protect subscription, evidence, grading, retake, and administration operations with server-side authorization and persistence.'
    Add-Bullet $document 'Allow local Docker operation and a production deployment using managed PostgreSQL, Redis, private object storage, and HTTPS.'

    Add-Paragraph $document '2. System Architecture' 'Heading 1'
    Add-Table $document @('Layer','Technology','Responsibility') @('Layer','Technology','Responsibility') @(
      [pscustomobject]@{Layer='Presentation';Technology='Next.js 16.3.4, React 19.2.4, Tailwind CSS v4';Responsibility='Role-specific pages, responsive dashboards, waiting lobby, exam room, settings, reports, billing, and evidence playback.'},
      [pscustomobject]@{Layer='Client proctoring';Technology='face-api.js, TensorFlow.js, COCO-SSD, MediaDevices, MediaRecorder, Web Audio, browser visibility/fullscreen APIs';Responsibility='Face, gaze, multiple-face, phone, audio, focus, fullscreen, clipboard, shortcut, and device-capability signals.'},
      [pscustomobject]@{Layer='Application';Technology='Next.js App Router and Route Handlers, TypeScript';Responsibility='Authentication, validation, quiz lifecycle, answers, grading, retakes, subscriptions, notifications, evidence authorization, and maintenance.'},
      [pscustomobject]@{Layer='Persistence';Technology='Prisma ORM 7.10, Neon PostgreSQL';Responsibility='Users, roles, quizzes, attempts, answers, violations, evidence metadata, analyses, subscriptions, payments, webhooks, notifications, logs, and settings.'},
      [pscustomobject]@{Layer='Shared transient state';Technology='Redis through ioredis';Responsibility='Distributed rate limits, live-snapshot records, teacher snapshot indexes, and bounded TTL state.'},
      [pscustomobject]@{Layer='Evidence storage';Technology='Private S3-compatible storage; MinIO locally';Responsibility='Encrypted-at-rest video and image objects retrieved only through authenticated application endpoints.'},
      [pscustomobject]@{Layer='External services';Technology='Pusher, Gemini, Google OAuth, SMTP, PayMongo test mode';Responsibility='Real-time events/signaling, AI creation/verdict assistance, optional sign-in, OTP delivery, and test checkout/webhooks.'},
      [pscustomobject]@{Layer='Operations';Technology='Docker, GitHub Actions, health/preflight/maintenance scripts';Responsibility='Repeatable builds, quality gates, readiness checks, retention, subscription expiry, and deployment support.'}
    ) 8 | Out-Null
    Add-Paragraph $document 'The production unit is a unified Next.js application. It does not require a standalone Express server. A legacy optional frontend-only rewrite remains in next.config.ts but is not the documented production topology.'

    Add-Paragraph $document '2.1 System Context and External Boundaries' 'Heading 2'
    Add-Table $document @('Actor or Service','Inbound Interaction','Outbound Interaction','Trust Boundary') @('Actor','Inbound','Outbound','Boundary') @(
      [pscustomobject]@{Actor='Student';Inbound='Quiz content, lobby/start events, feedback, result, notifications';Outbound='Credentials, device capabilities, answers, snapshots, violations, short evidence clips';Boundary='Untrusted browser; every mutation is revalidated server-side.'},
      [pscustomobject]@{Actor='Teacher';Inbound='Quiz/attempt data, monitor snapshots, alerts, evidence, reports, billing status';Outbound='Quiz definitions, lifecycle commands, approvals, subscription checkout requests';Boundary='Authenticated role with ownership and Pro checks.'},
      [pscustomobject]@{Actor='Admin';Inbound='Users, analytics, activity records, settings';Outbound='Account status and controlled subscription administration';Boundary='Highest application role; operations are authenticated and logged where implemented.'},
      [pscustomobject]@{Actor='Pusher';Inbound='Private-channel events and WebRTC signaling metadata';Outbound='Private-channel authentication requests';Boundary='External real-time provider; never used as the system of record.'},
      [pscustomobject]@{Actor='Gemini';Inbound='Quiz-generation prompts and aggregate violation summaries';Outbound='Generated questions or bounded verdict JSON';Boundary='Optional external AI; output is parsed and deterministic fallbacks exist.'},
      [pscustomobject]@{Actor='PayMongo';Inbound='Test checkout responses and signed test webhook events';Outbound='Server-created checkout session requests';Boundary='External payment provider; redirects do not grant entitlement.'}
    ) 7.6 | Out-Null

    Add-Paragraph $document '2.2 Deployment View' 'Heading 2'
    Add-Paragraph $document 'The Docker topology contains an application container, Redis, MinIO, and a MinIO bucket initializer. The application connects separately to Neon PostgreSQL and external providers. The app runs as a non-root user and exposes /api/health; readiness succeeds only when PostgreSQL, Redis, and evidence storage respond. In multi-instance production, Redis and durable private object storage are mandatory because process-local fallbacks are not state-safe across replicas.'

    Add-Paragraph $document '3. Component Design' 'Heading 1'
    Add-Table $document @('Component','Primary Responsibility','Key Interfaces') @('Component','Responsibility','Interfaces') @(
      [pscustomobject]@{Component='Authentication and session service';Responsibility='Registration, password login, Google credential verification, OTP reset, JWT issuance, role validation, session-version revocation, presence updates.';Interfaces='/api/auth/*, HttpOnly role cookies, SMTP, Google token verification.'},
      [pscustomobject]@{Component='Quiz authoring service';Responsibility='Manual and Gemini-assisted quiz creation, question/choice validation, subject creation, status management, access-code generation.';Interfaces='/api/quizzes, /api/quizzes/[id], /api/ai/create.'},
      [pscustomobject]@{Component='Quiz access and lobby';Responsibility='Normalize long and legacy access codes, enroll a student, manage late approval, poll persisted start state, and authorize entry.';Interfaces='/api/quizzes/join, /api/quizzes/session, /api/quizzes/[id]/start, Pusher private quiz channel.'},
      [pscustomobject]@{Component='Answer and submission service';Responsibility='Persist immutable first answer per question, autosave recoverable choices, enforce deadlines, grade against database choices, and atomically complete attempts.';Interfaces='/api/quizzes/answer, /autosave, /submit, PostgreSQL advisory locks.'},
      [pscustomobject]@{Component='Client proctoring engine';Responsibility='Run local visual inference and browser/device checks, debounce events, count strikes, capture fallback snapshots, and request auto-submission.';Interfaces='Camera/microphone/browser APIs, face-api.js, COCO-SSD, violation/evidence endpoints.'},
      [pscustomobject]@{Component='Violation and evidence service';Responsibility='Validate active ownership and violation type, cap attempts at three persisted incidents, validate 3-5.5 second media, store metadata and private objects.';Interfaces='/api/live/violation, /api/live/violation/[id]/evidence, /api/evidence/[id], S3.'},
      [pscustomobject]@{Component='Live monitoring service';Responsibility='Publish compact events, store short-lived snapshots in Redis, authenticate private channels, and show student status/assurance to Pro teachers.';Interfaces='/api/live/*, /api/pusher/auth, Pusher, Redis.'},
      [pscustomobject]@{Component='Retake service';Responsibility='Accept student requests, authorize teacher decisions, create incremented attempts, and preserve prior scores, answers, violations, verdicts, and evidence.';Interfaces='/api/quizzes/retake and /retake/approve.'},
      [pscustomobject]@{Component='Entitlement and billing service';Responsibility='Enforce five lifetime Free manual quizzes, Pro feature gates, subscription dates, signed/idempotent test webhooks, and refund reconciliation.';Interfaces='/api/billing, /status, /webhook, PayMongo, subscription tables.'},
      [pscustomobject]@{Component='Notification service';Responsibility='Persist user notifications, publish bell updates, mark records read, and derive role-safe destinations.';Interfaces='/api/notifications, private user Pusher channels.'},
      [pscustomobject]@{Component='Administration and reporting';Responsibility='Provide role-restricted analytics, users, logs, teacher evidence, and report summaries.';Interfaces='/api/dashboard/admin/* and /api/dashboard/teacher/*.'},
      [pscustomobject]@{Component='Operations service';Responsibility='Readiness, migrations, bootstrap, preflight, daily retention, subscription expiration, OTP cleanup, webhook cleanup, and presence cleanup.';Interfaces='/api/health, /api/internal/maintenance, scripts and scheduler.'}
    ) 7.4 | Out-Null

    Add-Paragraph $document '4. State and Workflow Design' 'Heading 1'
    Add-Paragraph $document '4.1 Quiz and Attempt Lifecycle' 'Heading 2'
    Add-Table $document @('State','Owner','Allowed Actions','Transition') @('State','Owner','Actions','Transition') @(
      [pscustomobject]@{State='draft';Owner='Teacher';Actions='Edit quiz definition. A code may support a pre-start waiting-room enrollment path.';Transition='Teacher publishes/activates the quiz.'},
      [pscustomobject]@{State='active';Owner='Teacher and lobby';Actions='Students enroll and wait; answers are not exposed.';Transition='Teacher start atomically changes the quiz to in_progress and enrolled attempts to in_progress.'},
      [pscustomobject]@{State='in_progress';Owner='Server';Actions='Approved students receive questions, answer once, autosave, generate monitoring signals, and submit.';Transition='Successful submission completes an attempt; teacher/system may end the quiz.'},
      [pscustomobject]@{State='ended';Owner='Teacher/system';Actions='No new normal enrollment; an already-started eligible attempt may finish within its deadline.';Transition='Attempt reaches completed or remains an exception requiring review.'},
      [pscustomobject]@{State='pending_approval';Owner='Teacher';Actions='Late join request waits for teacher approval.';Transition='Approval starts the attempt; rejection denies entry.'},
      [pscustomobject]@{State='completed';Owner='Server';Actions='Result, verdict, evidence, and retake request become available as permitted.';Transition='Optional pending_retake request; original record remains preserved.'}
    ) 7.7 | Out-Null

    Add-Paragraph $document '4.2 Answer and Submission Flow' 'Heading 2'
    Add-Paragraph $document 'The client submits each selected choice to the answer endpoint. The server verifies the active attempt, deadline, question, and choice ownership, then uses a PostgreSQL advisory transaction lock so the first graded selection becomes authoritative. Autosave stores only allowed question-choice pairs and does not overwrite already graded answers. Final submission merges locked answers with valid client state, grades from database truth, writes answers, AI analysis, score, completion status, and notifications in an atomic transaction, and rejects duplicate concurrent submission claims.'

    Add-Paragraph $document '4.3 Violation and Evidence Flow' 'Heading 2'
    Add-Paragraph $document 'The browser detects a supported event and posts violation metadata. The server checks the student session, active attempt, accepted event type, rate limit, and existing count. The client then uploads a MediaRecorder clip, normally four seconds, to the incident-specific endpoint. The server checks ownership, file signature, MIME type, size, active attempt, and a declared duration from 3,000 to 5,500 milliseconds before writing the S3 object and EvidenceFile row. If recording is unavailable, the incident may retain a snapshot fallback without fabricating a video.'

    Add-Paragraph $document '4.4 Subscription and Retake Flow' 'Heading 2'
    Add-Paragraph $document 'Quiz creation and Pro-only APIs query current subscription status and end date on the server. A checkout redirect never activates Pro access; only a recent, mode-matching PayMongo HMAC webhook creates an idempotency record, payment, and active subscription. A retake approval locks the student-quiz pair, restores the original attempt to completed, and inserts a new attempt number rather than deleting historical academic or proctoring evidence.'

    Add-Paragraph $document '5. Data Design' 'Heading 1'
    Add-Table $document @('Domain','Models','Key Integrity Rules') @('Domain','Models','Rules') @(
      [pscustomobject]@{Domain='Identity';Models='Role, User, OtpCode';Rules='Unique email and Google ID; role foreign key; session version; OTP expiry and cascading ownership.'},
      [pscustomobject]@{Domain='Quiz definition';Models='Subject, Quiz, Question, Choice';Rules='Unique subject/access codes; teacher ownership; ordered relations; correct-choice validation in application services.'},
      [pscustomobject]@{Domain='Attempt and grading';Models='StudentQuiz, Answer';Rules='Unique student + quiz + attempt number; unique attempt + question answer; cascading quiz/attempt cleanup; decimal score.'},
      [pscustomobject]@{Domain='Proctoring';Models='Violation, EvidenceFile, AiAnalysis';Rules='Evidence belongs to one violation; one analysis per attempt; bounded evidence handled outside PostgreSQL.'},
      [pscustomobject]@{Domain='Communication and audit';Models='Notification, ActivityLog';Rules='Per-user ownership; database persistence; cascade on user removal.'},
      [pscustomobject]@{Domain='Billing';Models='SubscriptionPlan, UserSubscription, Payment, WebhookEvent';Rules='Unique user + plan, provider payment/reference uniqueness, event idempotency, subscription date/status checks.'},
      [pscustomobject]@{Domain='Configuration';Models='Setting';Rules='Unique setting key; updated timestamp; bounded retention parsing in maintenance.'}
    ) 8 | Out-Null
    Add-Paragraph $document 'The schema contains 19 Prisma models. The September 2026 migrations add deployment constraints and non-destructive retake history. Application transactions protect race-sensitive answer, submission, retake, and billing operations.'

    Add-Paragraph $document '6. Interface and Integration Design' 'Heading 1'
    Add-Table $document @('Interface Domain','Representative Endpoints','Design Rule') @('Domain','Endpoints','Rule') @(
      [pscustomobject]@{Domain='Authentication';Endpoints='/api/auth/login, register, google, forgot-password, verify-otp, reset-password, session, logout';Rule='Public entry endpoints are rate-limited; protected operations use database-backed session validation.'},
      [pscustomobject]@{Domain='Quiz';Endpoints='/api/quizzes, /[id], /[id]/start, join, approve, session, answer, autosave, submit, retake';Rule='Role, ownership, state, deadline, and payload relationships are checked server-side.'},
      [pscustomobject]@{Domain='Live and evidence';Endpoints='/api/live/join, snapshot, violation, violation/[id]/evidence, webrtc; /api/evidence/[id]';Rule='Pusher carries metadata; Redis carries bounded snapshots; S3 carries evidence; teacher access is Pro-gated.'},
      [pscustomobject]@{Domain='Billing';Endpoints='/api/billing, /status, /webhook';Rule='Test-mode keys/events only; entitlement follows verified webhook persistence.'},
      [pscustomobject]@{Domain='Dashboards';Endpoints='/api/dashboard/admin/*, teacher/*, student/results';Rule='Role and object ownership determine returned records.'},
      [pscustomobject]@{Domain='Operations';Endpoints='/api/health, /api/internal/maintenance';Rule='Health is public and non-sensitive; maintenance requires a long bearer secret.'}
    ) 7.8 | Out-Null

    Add-Paragraph $document '6.1 Real-Time Channels' 'Heading 2'
    Add-Table $document @('Channel Pattern','Authorized Subscriber','Purpose') @('Channel','Subscriber','Purpose') @(
      [pscustomobject]@{Channel='private-user-{userId}';Subscriber='Matching authenticated user';Purpose='Notification bell updates.'},
      [pscustomobject]@{Channel='private-student-{studentId}';Subscriber='Matching student';Purpose='Teacher-to-student decisions and WebRTC signaling.'},
      [pscustomobject]@{Channel='private-teacher-{teacherId}';Subscriber='Matching Pro teacher';Purpose='Student events, violations, submissions, monitoring metadata, and signaling.'},
      [pscustomobject]@{Channel='private-quiz-{quizId}';Subscriber='Quiz owner, enrolled student, or admin';Purpose='Teacher start and quiz-scoped updates.'},
      [pscustomobject]@{Channel='private-admin-dashboard';Subscriber='Admin';Purpose='Administrative activity events.'}
    ) 8 | Out-Null

    Add-Paragraph $document '7. Security and Privacy Design' 'Heading 1'
    Add-Table $document @('Control','Implementation','Security Effect') @('Control','Implementation','Effect') @(
      [pscustomobject]@{Control='Session protection';Implementation='HS256 JWT with a minimum 32-character secret; seven-day HttpOnly, SameSite=Lax cookies; Secure in production; algorithm allowlist.';Effect='Limits token theft through script access and rejects malformed or wrong-role tokens.'},
      [pscustomobject]@{Control='Session revocation';Implementation='The token sessionVersion must match the current User row; reset/change increments it.';Effect='Invalidates older sessions after credential changes.'},
      [pscustomobject]@{Control='Passwords and OTP';Implementation='bcrypt cost 12; 10-128 characters with letters and digits; six-digit OTP stored as purpose/user-scoped HMAC; bounded expiry and rate limits.';Effect='Protects stored credentials and reduces enumeration/brute-force exposure.'},
      [pscustomobject]@{Control='Authorization';Implementation='Proxy performs coarse route gating; every protected Route Handler rechecks session, role, ownership, and entitlement.';Effect='Separates Student, Teacher, and Admin privileges and prevents object-level access leaks.'},
      [pscustomobject]@{Control='Web security headers';Implementation='CSP, HSTS in production, frame denial, nosniff, referrer policy, permissions policy, and cross-origin opener policy.';Effect='Reduces injection, framing, MIME confusion, and excess device permission exposure.'},
      [pscustomobject]@{Control='Rate limiting';Implementation='Redis atomic counters with a process-local development fallback; account and IP grouped keys.';Effect='Slows abuse across authentication, join, AI, evidence, and other sensitive endpoints.'},
      [pscustomobject]@{Control='Payment integrity';Implementation='Recent timestamp, HMAC timing-safe comparison, live/test mode binding, amount/plan validation, unique provider IDs, and idempotent events.';Effect='Prevents forged redirects, replay, duplicate activation, and wrong-mode payments.'},
      [pscustomobject]@{Control='Evidence privacy';Implementation='Private bucket, AES256 storage request, opaque UUID keys, authenticated streaming, ownership checks, retention cleanup.';Effect='Keeps biometric-adjacent exam evidence outside public URLs and bounds retention.'}
    ) 7.6 | Out-Null

    Add-Paragraph $document '8. Operational Design' 'Heading 1'
    Add-Table $document @('Operation','Mechanism','Failure Behavior') @('Operation','Mechanism','Failure') @(
      [pscustomobject]@{Operation='Startup and deployment';Mechanism='npm ci, Prisma generate/migrate, bootstrap, Next production build, standalone container.';Failure='Build or readiness failure prevents acceptance.'},
      [pscustomobject]@{Operation='Readiness';Mechanism='/api/health checks PostgreSQL, Redis PONG, and S3 bucket head.';Failure='Returns HTTP 503 without exposing dependency details.'},
      [pscustomobject]@{Operation='Daily maintenance';Mechanism='Scheduler calls npm maintenance or authenticated internal endpoint.';Failure='Expired subscriptions/OTPs and retained evidence accumulate until the next successful run.'},
      [pscustomobject]@{Operation='Evidence retention';Mechanism='Default 90 days, configurable through bounded settings; deletes storage objects then metadata.';Failure='Storage deletion exceptions stop metadata cleanup to avoid orphaning hidden objects.'},
      [pscustomobject]@{Operation='Database change';Mechanism='Readiness script, reviewed Prisma migration, migrate deploy, Neon backup/snapshot.';Failure='Deployment stops; prisma db push is prohibited for production.'},
      [pscustomobject]@{Operation='Continuous integration';Mechanism='Install, Prisma validation, dependency audit, unit tests, lint, TypeScript, build, Playwright Chromium.';Failure='A failing command blocks the quality job; skipped authenticated tests currently require separate execution.'}
    ) 7.8 | Out-Null

    Add-Paragraph $document '9. Design Decisions and Known Limitations' 'Heading 1'
    Add-Bullet $document 'Browser-side computer vision preserves active-quiz continuity when Gemini is unavailable and avoids continuous webcam upload, but accuracy depends on lighting, camera placement, device performance, and model confidence.'
    Add-Bullet $document 'Mobile sessions are labeled Reduced Assurance because operating systems may suppress screenshot shortcuts, fullscreen behavior, background events, and MediaRecorder capabilities.'
    Add-Bullet $document 'Pusher transports compact events only. Snapshot bytes remain in Redis and incident media remains in private object storage.'
    Add-Bullet $document 'The student contains WebRTC offer/signaling code, but the teacher Live Monitor does not yet implement the matching RTCPeerConnection receiver. Redis snapshots are the currently dependable monitoring transport; WebRTC must not be described as completed live video.'
    Add-Bullet $document 'Only public/anonymous Playwright scenarios run by default. Authenticated entitlement and waiting-lobby scenarios require an explicitly enabled disposable database.'
    Add-Bullet $document 'PayMongo is intentionally test mode. Live keys, settlement, and live webhook acceptance are outside this baseline.'
    Add-Bullet $document 'Process-local rate-limit and snapshot fallbacks are development resilience only; production replicas require Redis.'
    Add-Bullet $document 'Two admin user-update endpoints overlap and should be consolidated to remove subscription-state and audit behavior drift.'

    Add-Paragraph $document '10. Requirements Traceability and Outstanding Verification' 'Heading 1'
    Add-Table $document @('Requirement Group','Design Components','Verification State') @('Requirement','Components','State') @(
      [pscustomobject]@{Requirement='FR-ROOM / FR-PROC';Components='Exam client, browser event handlers, face/object/audio inference, violation service';State='Core logic implemented; controlled physical-device accuracy study pending.'},
      [pscustomobject]@{Requirement='FR-MON / FR-EVID';Components='Pusher, Redis snapshot store, evidence API, S3, teacher monitor/replay';State='Snapshot/event/evidence paths implemented; teacher WebRTC receiver pending.'},
      [pscustomobject]@{Requirement='FR-GEN';Components='AI create endpoint, Gemini wrapper, quiz persistence';State='Implemented and Pro-gated; quota/failure behavior needs external test evidence.'},
      [pscustomobject]@{Requirement='FR-AUTH / FR-ACCOUNT';Components='JWT session, Google verification, OTP email, recovery UI, notifications';State='Code and public browser contracts verified; live OAuth/SMTP acceptance pending.'},
      [pscustomobject]@{Requirement='FR-QUIZ';Components='Join, lobby, start, answer, autosave, submit, retake';State='Unit coverage implemented; authenticated E2E remains opt-in and was skipped in the current default run.'},
      [pscustomobject]@{Requirement='FR-SUB';Components='Entitlements, billing status, PayMongo checkout/webhook/refund';State='Unit logic verified in test mode; external signed webhook walkthrough pending evidence.'},
      [pscustomobject]@{Requirement='FR-DEVICE';Components='Capability normalization, secure-context/camera gate, monitoring label';State='Unit logic verified; broader real phone/browser matrix pending.'},
      [pscustomobject]@{Requirement='Performance and availability';Components='PostgreSQL pool, Redis, Pusher, health, Docker, maintenance';State='Build/readiness design implemented; formal load, latency, uptime, and recovery drill evidence pending.'}
    ) 7.6 | Out-Null

    Add-Paragraph $document 'Feature Contribution Matrix' 'Heading 2'
    Add-Table $document @('Feature or Deliverable','Primary Role','Supporting Role','Contribution Evidence') @('Feature','Primary','Supporting','Evidence') @(
      [pscustomobject]@{Feature='Planning, SRS, SPMP, documentation governance';Primary='Project Manager';Supporting='Backend and Frontend Developers';Evidence='Project documents and revision records.'},
      [pscustomobject]@{Feature='Authentication, APIs, database, billing, deployment';Primary='Backend and Database Developer';Supporting='Project Manager, Frontend Developer';Evidence='Route Handlers, Prisma schema/migrations, server libraries, Docker and scripts.'},
      [pscustomobject]@{Feature='Dashboards, exam client, responsive/mobile UI';Primary='Frontend Developer';Supporting='Backend Developer';Evidence='Next.js pages, React components, styles, and browser contracts.'},
      [pscustomobject]@{Feature='Proctoring, monitoring, evidence, AI integration';Primary='Backend and Frontend Developers';Supporting='Project Manager';Evidence='Client detection, live/evidence APIs, Pusher/Redis/S3 and Gemini modules.'},
      [pscustomobject]@{Feature='Testing, recovery, and defense evidence';Primary='All members';Supporting='Adviser and evaluators';Evidence='Node tests, Playwright, build/lint/type checks, backup and acceptance records.'}
    ) 7.8 | Out-Null

    $document.Repaginate()
    $document.Save()
    Write-Output ('created=' + $output + ';pages=' + $document.ComputeStatistics(2))
  } finally { $document.Close($false); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
}

function Build-Std($word, [string]$reference, [string]$output) {
  Copy-Item -LiteralPath $reference -Destination $output -Force
  $document = $word.Documents.Open($output, $false, $false)
  try {
    $document.Content.Text = ''
    Configure-Styles $document
    Add-FrontMatter $document 'SOFTWARE TEST DOCUMENT' 'ProctorShield AI Verification and Validation Specification'

    Add-Paragraph $document '1. Introduction' 'Heading 1'
    Add-Paragraph $document 'This Software Test Document defines the verification strategy, test environment, requirement coverage, execution evidence, defect classification, and acceptance criteria for ProctorShield AI. Results in this baseline were obtained from the repository on 5 September 2026. A status of Pending or Skipped is not treated as a pass.'
    Add-Paragraph $document 'The test objective is to demonstrate that security-sensitive state is enforced on the server, that the browser interfaces behave consistently on desktop and mobile viewports, and that external integrations fail safely. The document also identifies tests that require a disposable authenticated database, real devices, provider dashboards, a stable HTTPS deployment, or representative users.'

    Add-Paragraph $document '1.1 Test Basis' 'Heading 2'
    Add-Bullet $document 'Software Requirements Specification Version 2.0 dated 5 September 2026.'
    Add-Bullet $document 'Software Project Management Plan Version 3.0 dated 5 September 2026.'
    Add-Bullet $document 'Prisma schema and migrations, Route Handlers, React pages/components, shared libraries, Docker configuration, CI workflow, and operational scripts.'
    Add-Bullet $document 'README, CI workflow, Docker configuration, environment template, and dated automated execution records.'

    Add-Paragraph $document '2. Test Environment and Verified Baseline' 'Heading 1'
    Add-Table $document @('Item','Audited Value','Evidence') @('Item','Value','Evidence') @(
      [pscustomobject]@{Item='Application framework';Value='Next.js 16.3.4; React 19.2.4; TypeScript 5';Evidence='Installed dependency tree and successful production build.'},
      [pscustomobject]@{Item='Data layer';Value='Prisma Client/CLI 7.10.0; PostgreSQL/Neon';Evidence='package tree, schema with 19 models, three migration baselines.'},
      [pscustomobject]@{Item='Application surface';Value='45 API route files; 26 page files';Evidence='Repository file inventory.'},
      [pscustomobject]@{Item='Browser projects';Value='Desktop Chromium and Pixel 7 mobile emulation';Evidence='playwright.config.ts.'},
      [pscustomobject]@{Item='Local infrastructure';Value='Docker app, Redis 8 Alpine, MinIO, bucket initializer';Evidence='docker-compose.yml and Dockerfile.'},
      [pscustomobject]@{Item='External integrations';Value='Pusher, Gemini, Google OAuth, SMTP, PayMongo test mode';Evidence='Server libraries, Route Handlers, environment template.'}
    ) 8 | Out-Null

    Add-Paragraph $document '2.1 Executed Quality Checks' 'Heading 2'
    Add-Table $document @('Check','Result','Evidence and Interpretation') @('Check','Result','Evidence') @(
      [pscustomobject]@{Check='Node unit/security tests';Result='PASS - 30/30';Evidence='npm test; zero failed, skipped, or cancelled.'},
      [pscustomobject]@{Check='ESLint error gate';Result='PASS';Evidence='npm run lint -- --quiet completed with exit code 0.'},
      [pscustomobject]@{Check='TypeScript no-emit check';Result='PASS';Evidence='npx tsc --noEmit --incremental false completed with exit code 0.'},
      [pscustomobject]@{Check='Next.js production build';Result='PASS';Evidence='next build compiled, type-checked, generated the application route manifest, and completed with exit code 0.'},
      [pscustomobject]@{Check='Playwright default suite';Result='PASS WITH SKIPS - 14 passed, 8 skipped';Evidence='Public/security scenarios passed on desktop and mobile; authenticated flows were disabled by configuration.'},
      [pscustomobject]@{Check='Dependency audit';Result='FAIL / OPEN';Evidence='npm audit --omit=dev --audit-level=high reported one high and one moderate mysql2 advisory through Prisma tooling; forced breaking downgrade not applied.'}
    ) 8 | Out-Null

    Add-Paragraph $document '3. Test Strategy' 'Heading 1'
    Add-Table $document @('Test Level','Purpose','Current State','Exit Evidence') @('Level','Purpose','State','Evidence') @(
      [pscustomobject]@{Level='Static verification';Purpose='Detect lint, type, schema, and production compilation defects.';State='Executed for lint, TypeScript, and build.';Evidence='Command output and CI logs.'},
      [pscustomobject]@{Level='Unit and security';Purpose='Validate deterministic policies, parsers, state predicates, grading, rate limits, signatures, and device normalization.';State='30 passed.';Evidence='Node test output.'},
      [pscustomobject]@{Level='Browser contract';Purpose='Validate public UI, recovery, redirects, security headers, registration rejection, and unsigned webhook rejection in desktop/mobile Chromium.';State='14 passed.';Evidence='Playwright report.'},
      [pscustomobject]@{Level='Authenticated browser';Purpose='Validate code input, Free/Pro paywalls, AI/manual authoring access, and teacher-controlled lobby.';State='8 skipped in default run.';Evidence='Run with RUN_AUTHENTICATED_E2E=true against a disposable branch.'},
      [pscustomobject]@{Level='Integration';Purpose='Validate Neon, Redis, S3/MinIO, Pusher, Gemini, SMTP, Google OAuth, and PayMongo test webhooks together.';State='Partially verified; formal evidence pending.';Evidence='Preflight, provider logs, screenshots, database rows, downloaded evidence.'},
      [pscustomobject]@{Level='Physical device';Purpose='Validate real phone camera, MediaRecorder, app switching, responsive exam flow, reconnect, and teacher laptop monitoring.';State='Pending controlled matrix.';Evidence='Signed device test sheets and incident clips.'},
      [pscustomobject]@{Level='Performance/recovery';Purpose='Measure concurrency, latency, retention, database restore, restart, and rollback behavior.';State='Backup restore previously exercised; repeatable evidence/load certification pending.';Evidence='Load report, restore queries, recovery time, health and log records.'},
      [pscustomobject]@{Level='User acceptance';Purpose='Confirm teacher, student, and administrator tasks with representative participants.';State='Pending.';Evidence='Signed UAT forms and approved exceptions.'}
    ) 7.4 | Out-Null

    Add-Paragraph $document '4. Requirements Traceability Matrix' 'Heading 1'
    Add-Table $document @('Requirement','Test Coverage','Current Result','Remaining Evidence') @('Requirement','Coverage','Result','Remaining') @(
      [pscustomobject]@{Requirement='FR-ROOM-001 to 003';Coverage='Browser input/visibility handlers and accepted violation types.';Result='Code inspected; event contract unit-tested.';Remaining='Real browser tab, clipboard, right-click, and OS shortcut evidence.'},
      [pscustomobject]@{Requirement='FR-PROC-001 to 003';Coverage='Phone-label threshold, valid events, strike cap, browser face/object/audio loop.';Result='Unit contracts pass; implementation inspected.';Remaining='Labeled lighting/device accuracy study and three-strike end-to-end run.'},
      [pscustomobject]@{Requirement='FR-MON-001 to 003';Coverage='Pro gating, Redis snapshots, Pusher channels, evidence authorization/download.';Result='Server/client design present.';Remaining='Teacher physical monitoring run; WebRTC receiver is incomplete.'},
      [pscustomobject]@{Requirement='FR-GEN-001 to 002';Coverage='Pro entitlement and AI generation Route Handler.';Result='Entitlement unit tests pass.';Remaining='Gemini valid/malformed/quota/error integration evidence.'},
      [pscustomobject]@{Requirement='FR-AUTH-001 to 002';Coverage='Password policy, OTP scope, public recovery flow, anonymous redirects, role checks.';Result='Unit and public browser checks pass.';Remaining='Google OAuth and SMTP end-to-end on stable HTTPS origin.'},
      [pscustomobject]@{Requirement='FR-QUIZ-001 to 004';Coverage='Access predicate, code normalization, grading, locked answers, lifecycle and retake code.';Result='Unit tests pass; authenticated browser scenarios skipped.';Remaining='Enable disposable authenticated E2E and verify live database transitions.'},
      [pscustomobject]@{Requirement='FR-EVID-001 to 002';Coverage='File signature, type, size, duration, ownership, S3 store/read/delete design.';Result='Code inspected and build passes.';Remaining='Capture/play/download 3-5 second clips on Chrome, Edge, Android, and iOS where supported.'},
      [pscustomobject]@{Requirement='FR-SUB-001 to 003';Coverage='Free five-quiz rule, Pro unlimited/AI rule, webhook HMAC/mode/parser/refund tests.';Result='Unit tests pass; PayMongo test mode only.';Remaining='Signed provider webhook and subscription persistence walkthrough.'},
      [pscustomobject]@{Requirement='FR-ACCOUNT-001 to 002';Coverage='Recovery UI, anti-enumeration design, session revocation, safe notification destinations.';Result='Unit/public browser checks pass.';Remaining='Mailbox delivery, reset from second session, notification navigation by role.'},
      [pscustomobject]@{Requirement='FR-DEVICE-001';Coverage='Desktop/mobile user-agent normalization and strict/reduced/unsupported decisions.';Result='4 device-capability unit tests pass.';Remaining='Real device/browser capability matrix.'},
      [pscustomobject]@{Requirement='Performance/availability';Coverage='Production build, Redis/S3 health dependency, Docker healthcheck, migration/preflight scripts.';Result='Build passes.';Remaining='Formal load, latency, failover, recovery-time, and stable-host monitoring evidence.'}
    ) 7.1 | Out-Null

    Add-Paragraph $document '5. Detailed Test Case Specification' 'Heading 1'
    Add-Paragraph $document '5.1 Authentication, Security, and Account Tests' 'Heading 2'
    Add-Table $document @('ID','Scenario','Expected Result','Status') @('Id','Scenario','Expected','Status') @(
      [pscustomobject]@{Id='TC-AUTH-001';Scenario='Register with a weak password.';Expected='HTTP validation rejects the request before persistence.';Status='PASS - unit/browser.'},
      [pscustomobject]@{Id='TC-AUTH-002';Scenario='Log in with valid credentials and role.';Expected='Correct HttpOnly role cookie and dashboard access.';Status='Pending authenticated integration.'},
      [pscustomobject]@{Id='TC-AUTH-003';Scenario='Request password reset for known and unknown email.';Expected='Generic response prevents account enumeration; known account receives OTP.';Status='Public UI pass; SMTP pending.'},
      [pscustomobject]@{Id='TC-AUTH-004';Scenario='Reset password, then reuse an older session.';Expected='New password succeeds and old sessionVersion is rejected.';Status='Pending authenticated integration.'},
      [pscustomobject]@{Id='TC-AUTH-005';Scenario='Student requests teacher/admin API.';Expected='HTTP 401/403 without protected data.';Status='Code inspection; route-browser matrix pending.'},
      [pscustomobject]@{Id='TC-AUTH-006';Scenario='Open protected dashboard anonymously.';Expected='Redirect to login on desktop and mobile.';Status='PASS - 2 browser runs.'},
      [pscustomobject]@{Id='TC-AUTH-007';Scenario='Inspect response security headers.';Expected='CSP, frame denial, nosniff, referrer and permissions policies are present.';Status='PASS - 2 browser runs.'},
      [pscustomobject]@{Id='TC-AUTH-008';Scenario='Google sign-in on stable public HTTPS origin.';Expected='Verified Google credential creates/links correct role and session.';Status='Pending external acceptance.'}
    ) 7.5 | Out-Null

    Add-Paragraph $document '5.2 Quiz, Answer, and Retake Tests' 'Heading 2'
    Add-Table $document @('ID','Scenario','Expected Result','Status') @('Id','Scenario','Expected','Status') @(
      [pscustomobject]@{Id='TC-QUIZ-001';Scenario='Paste a current long access code on mobile.';Expected='Normalization preserves the complete code up to 64 characters.';Status='Unit pass; authenticated browser skipped.'},
      [pscustomobject]@{Id='TC-QUIZ-002';Scenario='Student enrolls before teacher start.';Expected='Lobby remains visible; questions/start control remain unavailable.';Status='Unit pass; authenticated browser skipped.'},
      [pscustomobject]@{Id='TC-QUIZ-003';Scenario='Teacher starts a valid active quiz.';Expected='Quiz and enrolled attempts transition atomically to in_progress.';Status='Pending authenticated integration.'},
      [pscustomobject]@{Id='TC-QUIZ-004';Scenario='Submit a choice from another question/quiz.';Expected='Server rejects the choice; grading ignores it.';Status='PASS - unit.'},
      [pscustomobject]@{Id='TC-QUIZ-005';Scenario='Change an already recorded answer.';Expected='First locked answer remains authoritative.';Status='PASS - unit.'},
      [pscustomobject]@{Id='TC-QUIZ-006';Scenario='Disconnect and reconnect during an attempt.';Expected='Local state survives; server autosave restores allowed answers and deadline.';Status='Pending real-device integration.'},
      [pscustomobject]@{Id='TC-QUIZ-007';Scenario='Submit twice concurrently.';Expected='One transaction completes; the other returns conflict.';Status='Code inspection; concurrency integration pending.'},
      [pscustomobject]@{Id='TC-QUIZ-008';Scenario='Approve a completed retake request.';Expected='New incremented attempt is created; original attempt/evidence remains unchanged.';Status='Schema/code verified; integration pending.'}
    ) 7.5 | Out-Null

    Add-Paragraph $document '5.3 Proctoring, Monitoring, and Evidence Tests' 'Heading 2'
    Add-Table $document @('ID','Scenario','Expected Result','Status') @('Id','Scenario','Expected','Status') @(
      [pscustomobject]@{Id='TC-PROC-001';Scenario='No face, multiple faces, gaze direction, visible phone, or remote-like phone is presented.';Expected='Debounced supported violation type is produced at the configured confidence.';Status='Logic pass; labeled camera study pending.'},
      [pscustomobject]@{Id='TC-PROC-002';Scenario='Switch tab/app, exit fullscreen, use clipboard, or press detectable screenshot shortcut.';Expected='Supported browser event is recorded; platform-suppressed OS events are not falsely claimed.';Status='Shortcut/event unit pass; physical run pending.'},
      [pscustomobject]@{Id='TC-PROC-003';Scenario='Accumulate three accepted incidents.';Expected='Server caps the count and client auto-submits once.';Status='Pending end-to-end.'},
      [pscustomobject]@{Id='TC-MON-001';Scenario='Pro teacher opens Live Monitor while student is active.';Expected='Authorized snapshots/events update the correct student card.';Status='Pending two-device integration.'},
      [pscustomobject]@{Id='TC-MON-002';Scenario='Free teacher calls monitoring/evidence/report API.';Expected='HTTP 403 with subscription-required response.';Status='Entitlement logic pass; authenticated browser skipped.'},
      [pscustomobject]@{Id='TC-EVID-001';Scenario='Upload valid 3-5 second WebM/MP4 incident evidence.';Expected='Signature/type/duration/size/ownership pass; private object and metadata are saved.';Status='Pending storage integration.'},
      [pscustomobject]@{Id='TC-EVID-002';Scenario='Upload invalid, oversized, short, long, or wrong-owner evidence.';Expected='Request is rejected without orphaned permanent evidence.';Status='Code inspection; negative integration pending.'},
      [pscustomobject]@{Id='TC-EVID-003';Scenario='Authorized teacher plays and downloads evidence.';Expected='Correct media headers and protected bytes are returned.';Status='Pending teacher acceptance.'},
      [pscustomobject]@{Id='TC-EVID-004';Scenario='Evidence reaches retention cutoff.';Expected='Object and EvidenceFile metadata are removed by maintenance.';Status='Pending scheduled-maintenance integration.'}
    ) 7.3 | Out-Null

    Add-Paragraph $document '5.4 Subscription, Integration, and Operations Tests' 'Heading 2'
    Add-Table $document @('ID','Scenario','Expected Result','Status') @('Id','Scenario','Expected','Status') @(
      [pscustomobject]@{Id='TC-SUB-001';Scenario='Free teacher creates five manual quizzes and attempts a sixth.';Expected='First five allowed; sixth rejected; deletion does not reset lifetime counter.';Status='PASS - unit policy; authenticated UI skipped.'},
      [pscustomobject]@{Id='TC-SUB-002';Scenario='Free teacher requests AI Create.';Expected='Rejected with subscription requirement.';Status='PASS - unit policy; authenticated UI skipped.'},
      [pscustomobject]@{Id='TC-SUB-003';Scenario='Active Pro teacher creates manual/AI quizzes and relogs.';Expected='Unlimited creation and entitlement persist until end date.';Status='Unit policy pass; persistence integration pending.'},
      [pscustomobject]@{Id='TC-PAY-001';Scenario='Unsigned, stale, mismatched-mode, or replayed webhook.';Expected='Rejected or idempotently ignored; subscription is not duplicated.';Status='Signature unit/public browser pass; provider replay pending.'},
      [pscustomobject]@{Id='TC-PAY-002';Scenario='Valid PayMongo test paid/refund events.';Expected='Payment/subscription state and refund adjustment persist atomically.';Status='Parser unit pass; provider integration pending.'},
      [pscustomobject]@{Id='TC-OPS-001';Scenario='Run production build.';Expected='Compilation, TypeScript, route generation, and optimization complete.';Status='PASS.'},
      [pscustomobject]@{Id='TC-OPS-002';Scenario='Call readiness with PostgreSQL, Redis, and S3 healthy/unhealthy.';Expected='200 only when all healthy; otherwise 503.';Status='Implementation inspected; fault-injection pending.'},
      [pscustomobject]@{Id='TC-OPS-003';Scenario='Restore a Neon snapshot to an isolated branch and compare counts/migrations.';Expected='Restored users/quizzes/attempts/payments/migrations match source snapshot.';Status='Previously exercised; attach dated evidence to final test package.'},
      [pscustomobject]@{Id='TC-OPS-004';Scenario='Run certified classroom load and latency test.';Expected='Measured thresholds are documented without invented capacity.';Status='Pending.'},
      [pscustomobject]@{Id='TC-DEP-001';Scenario='Audit production dependencies.';Expected='No unaccepted high-severity advisory.';Status='FAIL / OPEN - Prisma/mysql2 advisory chain.'}
    ) 7.3 | Out-Null

    Add-Paragraph $document '6. Test Execution and Evidence Control' 'Heading 1'
    Add-Paragraph $document 'Every execution record shall include the test ID, requirement ID, build/commit identifier, tester, date, environment, preconditions, test data, expected result, actual result, evidence location, defect ID, disposition, and reviewer sign-off. Screenshots alone are insufficient for database or webhook tests; retain the corresponding sanitized logs or database queries. Evidence clips must follow the same access and retention controls as application evidence.'
    Add-Table $document @('Evidence Type','Minimum Record','Retention/Handling') @('Type','Record','Handling') @(
      [pscustomobject]@{Type='Automated command';Record='Command, exit code, summary, commit hash, environment.';Handling='CI artifact or signed local execution log.'},
      [pscustomobject]@{Type='Browser test';Record='Project/device, scenario, status, trace/screenshot on failure.';Handling='Playwright report; redact credentials and tokens.'},
      [pscustomobject]@{Type='External provider';Record='Sanitized request/event identifier, timestamp, provider status, resulting database state.';Handling='Never store API keys, OTPs, full signatures, or payment credentials.'},
      [pscustomobject]@{Type='Physical device';Record='Device/OS/browser version, network, permissions, steps, video/screenshot, observer.';Handling='Consent-controlled test account and bounded evidence retention.'},
      [pscustomobject]@{Type='Recovery/load';Record='Dataset snapshot, workload, duration, percentiles, errors, recovery point/time.';Handling='Store with release acceptance package.'}
    ) 7.8 | Out-Null

    Add-Paragraph $document '7. Defect Classification and Current Findings' 'Heading 1'
    Add-Table $document @('Severity','Definition','Release Rule') @('Severity','Definition','Rule') @(
      [pscustomobject]@{Severity='Critical';Definition='Credential exposure, unauthorized protected-data access, data loss, incorrect grading at scale, payment entitlement forgery, or service-wide outage.';Rule='Blocks all acceptance and deployment.'},
      [pscustomobject]@{Severity='Major';Definition='Required feature fails, evidence cannot be protected/retrieved, quiz state can be bypassed, or supported device workflow cannot complete.';Rule='Blocks release unless formally corrected and retested.'},
      [pscustomobject]@{Severity='Moderate';Definition='Degraded reliability, incomplete integration, inconsistent administration behavior, or important test coverage gap with a safe workaround.';Rule='Requires owner, mitigation, and approved deadline.'},
      [pscustomobject]@{Severity='Minor';Definition='Cosmetic, wording, documentation, or low-impact usability issue with a safe workaround.';Rule='May be deferred with tracking.'}
    ) 7.7 | Out-Null

    Add-Table $document @('Finding','Classification','Required Action','Status') @('Finding','Class','Action','Status') @(
      [pscustomobject]@{Finding='High and moderate mysql2 advisories reported through Prisma tooling.';Class='Dependency gate - Major until assessed';Action='Track upstream fix or safe upgrade; verify PostgreSQL-only runtime exposure; do not force a breaking downgrade without regression tests.';Status='Open.'},
      [pscustomobject]@{Finding='Teacher monitor lacks the receiver half of the student WebRTC signaling implementation.';Class='Feature completeness - Moderate';Action='Implement/test receiver and TURN strategy or remove WebRTC claim and retain snapshots as the formal design.';Status='Open; snapshot fallback works by design.'},
      [pscustomobject]@{Finding='Eight authenticated browser scenarios skipped in the default run.';Class='Coverage - Moderate';Action='Run with opt-in flag and disposable database, retain report.';Status='Open.'},
      [pscustomobject]@{Finding='Overlapping admin user-update endpoints have different plan names/logging/event behavior.';Class='Maintainability - Moderate';Action='Consolidate one contract and regression-test suspension/subscription administration.';Status='Open.'},
      [pscustomobject]@{Finding='Real-device detection, OAuth/SMTP, PayMongo provider flow, load, and UAT evidence are incomplete.';Class='Acceptance evidence - Major for final deployment';Action='Execute controlled matrices before declaring production-ready.';Status='Pending.'}
    ) 7.4 | Out-Null

    Add-Paragraph $document 'Feature Contribution Matrix' 'Heading 2'
    Add-Table $document @('Feature or Deliverable','Primary Role','Supporting Role','Evidence') @('Feature','Primary','Supporting','Evidence') @(
      [pscustomobject]@{Feature='Test planning, traceability, acceptance coordination';Primary='Project Manager';Supporting='Backend and Frontend Developers';Evidence='STD, SRS mapping, review and sign-off records.'},
      [pscustomobject]@{Feature='Unit/security, API, database, billing, deployment tests';Primary='Backend and Database Developer';Supporting='Project Manager';Evidence='tests directory, scripts, CI, Prisma and service logs.'},
      [pscustomobject]@{Feature='Responsive UI, browser, mobile, exam-client tests';Primary='Frontend Developer';Supporting='Backend Developer';Evidence='Playwright specs, device matrix, UI evidence.'},
      [pscustomobject]@{Feature='Integrated proctoring and acceptance tests';Primary='All members';Supporting='Adviser and representative users';Evidence='Controlled scenario sheets, incident media, UAT records.'}
    ) 7.7 | Out-Null

    Add-Paragraph $document '8. Acceptance Criteria and Current Decision' 'Heading 1'
    Add-Bullet $document 'All Critical and Major defects are closed and retested, or the evaluation panel has approved a documented exception.'
    Add-Bullet $document 'The dependency audit has no unaccepted high-severity finding.'
    Add-Bullet $document 'All authenticated desktop/mobile browser scenarios pass against a disposable production-like database.'
    Add-Bullet $document 'Representative laptop and phone sessions demonstrate waiting, start, answer, reconnect, auto-submit, monitoring, 3-5 second evidence, playback, and download.'
    Add-Bullet $document 'Google OAuth, SMTP recovery, Pusher, Redis, object storage, Gemini fallback, and signed PayMongo test webhooks have retained integration evidence.'
    Add-Bullet $document 'Backup restoration, rollback, maintenance, health failure, load/latency, and UAT evidence are signed and archived.'
    Add-Paragraph $document 'Current decision: CONDITIONALLY VERIFIED FOR CONTROLLED ACCEPTANCE TESTING, NOT YET FULLY ACCEPTED FOR PRODUCTION DEPLOYMENT. The application passes unit, lint, type, production-build, and public browser gates, but the open dependency advisory and incomplete authenticated, physical-device, external-integration, load, and UAT evidence prevent an unconditional production-ready claim.' 'Normal' $true

    $document.Repaginate()
    $document.Save()
    Write-Output ('created=' + $output + ';pages=' + $document.ComputeStatistics(2))
  } finally { $document.Close($false); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
}

$outputFullPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputFullPath) | Out-Null
$sddOutput = Join-Path $outputFullPath 'ProctorShield_AI_SDD_v1.0_2026-09-05.docx'
$stdOutput = Join-Path $outputFullPath 'ProctorShield_AI_STD_v1.0_2026-09-05.docx'

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  Build-Sdd $word ([System.IO.Path]::GetFullPath($SddReference)) $sddOutput
  Build-Std $word ([System.IO.Path]::GetFullPath($StdReference)) $stdOutput
} finally {
  $word.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
