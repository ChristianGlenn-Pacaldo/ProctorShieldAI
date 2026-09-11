param(
  [Parameter(Mandatory = $true)][string]$SrsInput,
  [Parameter(Mandatory = $true)][string]$SpmpInput,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function Get-NodeText {
  param([System.Xml.XmlNode]$Node, [System.Xml.XmlNamespaceManager]$Namespaces)
  return (($Node.SelectNodes('.//w:t', $Namespaces) | ForEach-Object { $_.InnerText }) -join '')
}

function Set-NodeText {
  param(
    [System.Xml.XmlNode]$Node,
    [System.Xml.XmlNamespaceManager]$Namespaces,
    [string]$Text
  )

  $textNodes = @($Node.SelectNodes('.//w:t', $Namespaces))
  if ($textNodes.Count -eq 0) {
    $run = $Node.OwnerDocument.CreateElement('w', 'r', $script:wordNamespace)
    $textNode = $Node.OwnerDocument.CreateElement('w', 't', $script:wordNamespace)
    $run.AppendChild($textNode) | Out-Null
    $Node.AppendChild($run) | Out-Null
    $textNodes = @($textNode)
  }

  $textNodes[0].InnerText = $Text
  $spaceAttribute = $Node.OwnerDocument.CreateAttribute('xml', 'space', 'http://www.w3.org/XML/1998/namespace')
  $spaceAttribute.Value = 'preserve'
  $textNodes[0].Attributes.SetNamedItem($spaceAttribute) | Out-Null
  for ($index = 1; $index -lt $textNodes.Count; $index++) {
    $textNodes[$index].InnerText = ''
  }
}

function Remove-CloneIds {
  param([System.Xml.XmlNode]$Node)
  $attributes = @($Node.SelectNodes('.//@*[local-name()="paraId" or local-name()="textId"]'))
  foreach ($attribute in $attributes) {
    $attribute.OwnerElement.RemoveAttributeNode($attribute) | Out-Null
  }
}

function Apply-Replacements {
  param(
    [xml]$Xml,
    [System.Xml.XmlNamespaceManager]$Namespaces,
    [array]$Rules
  )

  foreach ($paragraph in $Xml.SelectNodes('//w:p', $Namespaces)) {
    $current = Get-NodeText $paragraph $Namespaces
    foreach ($rule in $Rules) {
      $matches = if ($rule.Exact) { $current -eq $rule.Match } else { $current.Contains($rule.Match) }
      if ($matches) {
        Set-NodeText $paragraph $Namespaces $rule.Text
        break
      }
    }
  }
}

function Add-TableRow {
  param(
    [xml]$Xml,
    [System.Xml.XmlNamespaceManager]$Namespaces,
    [int]$TableIndex,
    [string[]]$Values
  )

  $table = @($Xml.SelectNodes('//w:body/w:tbl', $Namespaces))[$TableIndex]
  if (-not $table) { throw "Table index $TableIndex was not found" }
  $rows = @($table.SelectNodes('./w:tr', $Namespaces))
  $newRow = $rows[-1].CloneNode($true)
  Remove-CloneIds $newRow
  $cells = @($newRow.SelectNodes('./w:tc', $Namespaces))
  if ($cells.Count -ne $Values.Count) {
    throw "Table index $TableIndex has $($cells.Count) columns; expected $($Values.Count)"
  }

  for ($index = 0; $index -lt $cells.Count; $index++) {
    $paragraphs = @($cells[$index].SelectNodes('./w:p', $Namespaces))
    Set-NodeText $paragraphs[0] $Namespaces $Values[$index]
    for ($paragraphIndex = 1; $paragraphIndex -lt $paragraphs.Count; $paragraphIndex++) {
      Set-NodeText $paragraphs[$paragraphIndex] $Namespaces ''
    }
  }
  $table.AppendChild($newRow) | Out-Null
}

function Insert-ParagraphsBefore {
  param(
    [xml]$Xml,
    [System.Xml.XmlNamespaceManager]$Namespaces,
    [string]$BeforeText,
    [string[]]$Paragraphs
  )

  $target = $null
  foreach ($paragraph in $Xml.SelectNodes('//w:body/w:p', $Namespaces)) {
    if ((Get-NodeText $paragraph $Namespaces) -eq $BeforeText) {
      $target = $paragraph
      break
    }
  }
  if (-not $target) { throw "Insertion target '$BeforeText' was not found" }

  $template = $target.PreviousSibling
  while ($template -and $template.LocalName -ne 'p') { $template = $template.PreviousSibling }
  if (-not $template) { $template = $target }

  foreach ($text in $Paragraphs) {
    $newParagraph = $template.CloneNode($true)
    Remove-CloneIds $newParagraph
    Set-NodeText $newParagraph $Namespaces $text
    $target.ParentNode.InsertBefore($newParagraph, $target) | Out-Null
  }
}

function Update-Document {
  param(
    [string]$InputPath,
    [string]$OutputPath,
    [array]$Rules,
    [scriptblock]$AdditionalChanges
  )

  [System.IO.File]::Copy($InputPath, $OutputPath, $true)
  $archive = [System.IO.Compression.ZipFile]::Open($OutputPath, [System.IO.Compression.ZipArchiveMode]::Update)
  try {
    $entry = $archive.GetEntry('word/document.xml')
    if (-not $entry) { throw 'word/document.xml was not found' }
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }

    $namespaces = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
    $namespaces.AddNamespace('w', $script:wordNamespace)
    Apply-Replacements $xml $namespaces $Rules
    & $AdditionalChanges $xml $namespaces

    $entry.Delete()
    $newEntry = $archive.CreateEntry('word/document.xml', [System.IO.Compression.CompressionLevel]::Optimal)
    $writer = [System.IO.StreamWriter]::new($newEntry.Open(), [System.Text.UTF8Encoding]::new($false))
    try { $xml.Save($writer) } finally { $writer.Dispose() }
  } finally {
    $archive.Dispose()
  }
}

function Replace-ZipEntry {
  param([string]$DocumentPath, [string]$EntryName, [string]$SourcePath)
  $archive = [System.IO.Compression.ZipFile]::Open($DocumentPath, [System.IO.Compression.ZipArchiveMode]::Update)
  try {
    $existing = $archive.GetEntry($EntryName)
    if (-not $existing) { throw "Document entry '$EntryName' was not found" }
    $existing.Delete()
    $replacement = $archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $input = [System.IO.File]::OpenRead($SourcePath)
    $output = $replacement.Open()
    try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
  } finally {
    $archive.Dispose()
  }
}

[System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$srsOutput = Join-Path $OutputDirectory 'SRS_ProctorShieldAI_UPDATED_2026-09-05.docx'
$spmpOutput = Join-Path $OutputDirectory 'SPMP_ProctorShieldAI_UPDATED_2026-09-05.docx'

$srsRules = @(
  @{ Match = 'Date of Publication: May 25, 2026'; Text = 'Date of Publication: September 5, 2026' },
  @{ Match = 'This system is a web-based examination and remote proctoring platform developed as ProctorShield AI'; Text = 'ProctorShield AI is a responsive, browser-based quiz and remote-proctoring platform implemented as a unified Next.js 16 App Router application with React 19, Tailwind CSS v4, Next.js Route Handlers, Prisma ORM 7, and Neon PostgreSQL. Browser-side face-api.js and TensorFlow.js COCO-SSD models detect face absence, multiple faces, gaze deviation, and visible phones, while browser events detect focus loss, tab or app switching, fullscreen exit, prohibited shortcuts, clipboard activity, and abnormal audio. Pusher distributes lightweight real-time events, Redis stores shared rate limits and live snapshots, and S3-compatible object storage retains downloadable 3-5 second incident videos. Gemini provides AI quiz generation and post-submission integrity verdicts. PayMongo test-mode billing enforces Free and Pro teacher entitlements.' },
  @{ Match = 'ProctorShield AI is designed as an independent, self-contained web application system'; Text = 'ProctorShield AI is an independent full-stack web application. Next.js App Router renders the interfaces and exposes server-side Route Handlers in the same deployable application; no standalone Express.js server is used. Prisma connects the application to Neon PostgreSQL. The system integrates with Pusher for real-time events, Redis for shared transient state and rate limiting, S3-compatible storage for evidence files, Google OAuth for optional sign-in, Gemini for question generation and verdict assistance, SMTP for OTP delivery, and PayMongo in test mode for subscription checkout and signed webhook processing.' },
  @{ Match = 'Node.js + Express.js'; Text = 'Next.js Route Handlers (Node.js runtime)' },
  @{ Match = 'Powers both visual cheating detection and text-based MCQ generation'; Text = 'Generates quiz questions and assists post-submission integrity verdicts; visual detection runs locally in the browser.' },
  @{ Match = 'The ProctorShield AI platform performs several core functions'; Text = 'The platform provides role-based authentication, email OTP password recovery, teacher-controlled quiz creation and lifecycle management, a real-time student waiting lobby, server-authoritative answer persistence and grading, browser-side proctoring, a three-strike auto-submission policy, downloadable incident evidence, teacher monitoring, reports, notifications with contextual navigation, non-destructive retakes, and administrative oversight. Teachers may author quizzes manually or use Gemini-assisted generation. Free teachers may create up to five lifetime manual quizzes, while an active Pro subscription unlocks unlimited quizzes, AI creation, Live Monitor, Evidence Replay, and AI reports. Student attempts and their evidence remain immutable when a retake is approved; the system creates a separately numbered attempt.' },
  @{ Match = 'Create exams, auto-generate questions, monitor live feeds, review evidence, update exam durations.'; Text = 'Create and manage quizzes, start sessions, approve retakes, monitor students, review and download evidence, view reports, and manage Pro billing subject to entitlement.' },
  @{ Match = 'Browser Sandbox Limits:'; Text = 'a.  Browser Sandbox Limits: The client detects common screenshot and developer-tool shortcuts, focus loss, visibility changes, clipboard actions, and fullscreen exits when the browser exposes those events. A website cannot guarantee detection of operating-system screen capture, hardware capture devices, or every mobile screenshot gesture; mobile sessions are therefore labeled Reduced Assurance.' },
  @{ Match = 'Pusher Payload Limits:'; Text = 'b.  Pusher Payload Limits: Pusher transports compact status and violation metadata only. Live snapshots are kept in Redis and retrieved through authenticated polling, while permanent 3-5 second evidence clips are stored outside the database in S3-compatible object storage.' },
  @{ Match = 'AI Processing Limits:'; Text = 'c.  Client Detection Limits: Browser-side face and object inference depends on camera quality, lighting, device performance, and model confidence. Gemini quotas affect optional quiz generation and verdict assistance but do not stop an active quiz; a deterministic verdict fallback remains available.' },
  @{ Match = 'Hardware Dependency:'; Text = 'a.  Hardware Dependency: Proctored participation requires a functioning front camera, a supported browser, and a stable connection. Mobile browsers are supported responsively but expose fewer enforceable controls and are explicitly classified as Reduced Assurance.' },
  @{ Match = 'Express.js'; Text = 'Redis'; Exact = $true },
  @{ Match = 'The backend web framework for Node.js used to build the server-side logic and REST API routes.'; Text = 'The shared cache used for distributed rate limiting, short-lived live snapshots, and multi-instance transient state.' },
  @{ Match = "Google's Large Language Model API, which powers both the visual cheating-detection engine"; Text = "Google's generative AI service used for teacher-authorized quiz creation and post-submission integrity verdict assistance." },
  @{ Match = 'Used for: Configuration of the visual proctoring engine'; Text = 'Used for: Configuration of AI-assisted quiz generation and post-submission integrity verdicts.' },
  @{ Match = 'Web application requests route through Express.js API endpoints over HTTPS.'; Text = 'Web requests route through authenticated Next.js Route Handlers over HTTPS.' },
  @{ Match = 'Express.js communicates with PostgreSQL'; Text = 'Next.js Route Handlers communicate with PostgreSQL using Prisma and the PostgreSQL adapter.' },
  @{ Match = 'Express.js communicates with the Google Gemini SDK'; Text = 'Server-only Route Handlers communicate with Gemini, Pusher, PayMongo, Redis, SMTP, and S3-compatible storage using protected environment variables.' },
  @{ Match = '/api/exams/join'; Text = '/api/quizzes/join' },
  @{ Match = '/api/exams/[id]'; Text = '/api/quizzes/[id]' },
  @{ Match = 'Submit an AI-detected violation with an accompanying snapshot.'; Text = 'Persist a validated proctoring violation and optional incident snapshot; evidence video is uploaded separately.' },
  @{ Match = 'Fetch historical violation snapshots.'; Text = 'Fetch teacher-owned violation records and protected video evidence metadata (Pro entitlement).' },
  @{ Match = 'extract webcam snapshots from a hidden <canvas>'; Text = 'a.  FR-PROC-001: The system shall run face landmark detection and COCO-SSD object detection against the active webcam stream within the browser at controlled intervals.' },
  @{ Match = 'proxy snapshots to the Gemini Vision API'; Text = 'b.  FR-PROC-002: The system shall detect face absence, multiple faces, gaze deviation, and visible phone/device objects locally, and shall combine those detections with browser focus, fullscreen, shortcut, clipboard, and audio signals.' },
  @{ Match = 'Evidence Replay modal to let teachers view full-resolution historical violation screenshots'; Text = 'c.  FR-MON-003: The system shall provide authorized Pro teachers with Evidence Replay for protected 3-5 second incident videos, snapshot fallback when recording is unavailable, and explicit download controls.' },
  @{ Match = 'Exam Capacity:'; Text = 'a.  Exam Capacity: The architecture shall support concurrent classroom sessions through pooled database access and shared Redis state. The maximum certified concurrency shall be established by a formal load test before production acceptance; the document does not claim an unverified fixed capacity.' },
  @{ Match = 'base64-encoded snapshot evidence'; Text = 'c.  Data Handling: The system shall manage growing user, quiz, attempt, answer, violation, notification, billing, and audit records in PostgreSQL, while evidence metadata is stored relationally and bounded video objects are retained in S3-compatible storage with cleanup and legacy snapshot fallback.' },
  @{ Match = 'Proctoring Interval:'; Text = 'd.  Proctoring Interval: Browser-side detection shall execute at a controlled interval appropriate to device capability. Evidence recording shall capture approximately 3-5 seconds around a persisted incident without continuously uploading the webcam stream.' },
  @{ Match = "'draft', 'active', 'ended'"; Text = "'draft', 'active', 'in_progress', or 'ended'" },
  @{ Match = "Base64 image of the incident"; Text = 'Legacy snapshot fallback; primary evidence is represented by related EvidenceFile objects in S3-compatible storage.' },
  @{ Match = 'Technology Stack: Next.js, Tailwind CSS, Node.js, Express.js'; Text = 'a.  Technology Stack: Next.js 16 App Router, React 19, Tailwind CSS v4, Node.js, Next.js Route Handlers, Prisma ORM 7 with PostgreSQL, browser-side face-api.js and TensorFlow.js COCO-SSD, Gemini, Pusher, Redis, S3-compatible storage, SMTP, PayMongo test mode, and custom JWT authentication. Substitutions require formal authorization.' },
  @{ Match = 'The application shall be hosted on a serverless, cloud-based environment'; Text = 'b.  Server Infrastructure: Deployment shall provide a long-running or otherwise state-safe Node.js environment, HTTPS, managed PostgreSQL, shared Redis, and durable S3-compatible object storage. Production must not depend on process-local memory for shared state.' },
  @{ Match = 'Snapshots must be retrieved via REST polling'; Text = 'c.  Real-Time Limits: Pusher shall carry lightweight events only. Live snapshot bytes shall be retrieved through authenticated polling from shared Redis-backed state, and evidence objects shall be streamed through authorized server endpoints.' },
  @{ Match = 'if the Gemini API is rate-limited or unavailable, the exam session must continue'; Text = 'a.  Fault Tolerance: Active quiz proctoring shall continue if Gemini is unavailable because visual detection is browser-side; grading shall use a deterministic integrity-verdict fallback when AI verdict generation fails.' },
  @{ Match = 'Every AI-detected or client-detected violation shall be persisted immediately'; Text = 'c.  Violation Logging: Valid client-detected violations shall be serialized per attempt, capped at three, and persisted immediately. Evidence upload failures shall not fabricate or duplicate violations.' },
  @{ Match = 'use HttpOnly session management and JWT-based tokens'; Text = 'a.  Session Management: The system shall issue signed JWT sessions in HttpOnly, Secure production cookies; compare a server-held session version on each request; revoke older sessions after password reset/change; and refresh bounded presence timestamps.' },
  @{ Match = 'The system shall be hosted on serverless infrastructure to aim for maximum continuous uptime'; Text = 'a.  Uptime: The deployed application shall expose readiness monitoring for PostgreSQL, Redis, and evidence storage; use a stable HTTPS host; and avoid process-local shared state so restarts or multiple instances do not silently lose monitoring data.' },
  @{ Match = 'separates the presentation layer (Next.js frontend) from the business logic layer (Express.js backend API)'; Text = 'a.  Modular Architecture: The system shall use feature-focused React components, shared server libraries, and Next.js Route Handlers within one TypeScript application, with Prisma, cache, storage, AI, email, payment, and real-time integrations isolated behind dedicated modules.' }
)

$spmpRules = @(
  @{ Match = 'Date of Publication: July 11, 2026'; Text = 'Date of Publication: September 5, 2026' },
  @{ Match = 'This Version 2.0 revision additionally reconciles'; Text = 'This Version 3.0 revision reconciles the plan with the hardened September 2026 implementation baseline, including the current browser-side detection architecture, evidence-video storage, Redis-backed shared state, PayMongo test billing, automated verification, backup recovery validation, and remaining deployment gates.' },
  @{ Match = 'Replaced the originally planned in-browser face-api.js detection model'; Text = 'Reconciled the July 2026 implementation as it existed at that review, including its then-current server-side Gemini Vision direction; corrected the Next.js Route Handler and custom-JWT architecture descriptions; and added audit-derived status and risks. The vision direction recorded in this historical entry was superseded by Version 3.0.' },
  @{ Match = 'Secure Exam Client: The student-facing exam interface'; Text = 'Secure Exam Client: A responsive desktop/mobile quiz interface with a teacher-controlled waiting lobby, server-authoritative answers, autosave and submission, fullscreen/focus/visibility/clipboard/shortcut/audio monitoring, browser-side face landmark analysis, COCO-SSD phone detection, capability reporting, and a three-strike auto-submission policy.' },
  @{ Match = 'AI Proctoring Engine: Server-side analysis'; Text = 'AI-Assisted Proctoring Engine: Browser-side face-api.js and TensorFlow.js COCO-SSD inference detects face absence, multiple faces, gaze deviation, and visible phones without sending every frame to Gemini. Gemini is reserved for quiz generation and post-exam verdict assistance, with deterministic fallback verdicts.' },
  @{ Match = 'Payment Gateway Processing: The database schema'; Text = 'Live Payment Processing: PayMongo checkout, signed webhooks, idempotent payment records, refund handling, and persistent Pro entitlements are integrated and verified in test mode. Activation of live PayMongo keys and real settlement remains outside the present testing baseline.' },
  @{ Match = 'Automated Test Suite: A formal unit/integration/end-to-end automated test suite is deferred'; Text = 'External Load and Device-Lab Certification: Automated unit/security and Playwright desktop/mobile suites are implemented. Formal high-concurrency load certification and a broad physical-device/browser laboratory remain future acceptance activities.' },
  @{ Match = 'Technology Stack Constraints: The delivered architecture is fixed to:'; Text = 'Technology Stack Constraints: The delivered architecture uses TypeScript; Next.js 16 App Router, React 19, and Tailwind CSS v4; Next.js Route Handlers; Prisma ORM 7 with the PostgreSQL adapter and Neon; browser-side face-api.js plus TensorFlow.js COCO-SSD; Gemini for text/vision-assisted content generation and verdicts rather than continuous proctoring; Pusher; Redis; S3-compatible evidence storage; SMTP; PayMongo test mode; and custom JWT/Google authentication. No standalone Express.js production server is used.' },
  @{ Match = 'Budget & Resource Constraints:'; Text = 'Budget & Resource Constraints: The capstone continues to prioritize free-tier and open-source services. Neon, Pusher, Gemini quotas, local Docker-based Redis/MinIO, and PayMongo test mode support development; a production rollout must budget for durable managed Redis/object storage, a stable HTTPS domain, monitoring, and any provider usage above free-tier limits.' },
  @{ Match = 'Sprint set B: AI Proctoring Engine integration'; Text = 'Sprint set B: Browser-side face and object detection, browser integrity signals, three-strike enforcement, short incident-video evidence, and Gemini-assisted quiz generation/verdict reporting.' },
  @{ Match = 'Status values are drawn directly from the July 8, 2026'; Text = 'Status values are drawn from the September 5, 2026 code audit, migrated database, production build, and automated desktop/mobile regression results.' },
  @{ Match = 'Substantially complete'; Text = 'Complete - email/password and Google OAuth, OTP forgot-password flow, session-version revocation, validation, rate limiting, and role-scoped HttpOnly sessions.' },
  @{ Match = 'AI proctoring engine (Gemini Vision)'; Text = 'AI proctoring engine (face-api.js + COCO-SSD) and three-strike policy' },
  @{ Match = 'Complete (snapshot-based; depends on the in-memory store'; Text = 'Complete - Pusher metadata events, Redis-backed live snapshots, and protected/downloadable short evidence videos in S3-compatible storage.' },
  @{ Match = 'real-time monitoring complete; suspend/restore/edit-user actions are UI-only stubs'; Text = 'Complete for scoped user management, analytics, activity monitoring, status controls, subscription administration, and presence-aware summaries.' },
  @{ Match = 'basic listings exist; detailed evidence-linked views are thin'; Text = 'Complete for the current scope; teacher AI reports and Evidence Replay are protected by an active Pro entitlement.' },
  @{ Match = 'UI exists; backend save/update endpoints are unconfirmed'; Text = 'Complete for the implemented profile, password, account, and administrator controls.' },
  @{ Match = 'database schema and seed data only; no UI'; Text = 'Complete with persisted notifications, live bell updates, read state, and role-scoped contextual navigation.' },
  @{ Match = 'database schema and seed data only; no gateway integration'; Text = 'Complete in PayMongo test mode with server-enforced Free/Pro entitlements, signed and idempotent webhooks, persistence across login, expiry, and refund handling.' },
  @{ Match = 'no unit, integration, or E2E tests exist in the repository'; Text = 'Complete baseline: 30 unit/security tests plus 22 Playwright desktop/mobile end-to-end scenarios; production build, TypeScript, and ESLint checks pass.' },
  @{ Match = 'the as-built system instead performs proctoring analysis server-side'; Text = 'Note: Retained as a core as-built dependency. The current client uses face-api.js for face/landmark detection and TensorFlow.js COCO-SSD for visible-phone detection; Gemini is used for quiz generation and post-exam verdict assistance.' },
  @{ Match = 'Policy/System Deviation: Exclusion of an in-browser face-detection model'; Text = 'Policy/System Deviation: Adoption of browser-side face-api.js and TensorFlow.js COCO-SSD instead of continuous server-side Gemini Vision frame analysis.' },
  @{ Match = 'Justification: Running proctoring analysis in the browser with face-api.js would limit'; Text = 'Justification: Browser-side inference reduces continuous image transmission, avoids Gemini latency/quota dependency during an active quiz, and permits near-real-time face and phone checks. Device capability and lighting variability are disclosed through confidence thresholds and a Reduced Assurance classification for mobile sessions. Gemini remains valuable for quiz generation and post-exam verdict assistance.' },
  @{ Match = 'Gemini Vision: The Google Gemini model'; Text = 'Gemini AI: Google Gemini models used for AI-assisted quiz generation and post-submission integrity verdicts; active visual proctoring is performed by browser-side face-api.js and COCO-SSD models.' },
  @{ Match = 'Live Snapshot Store: The in-memory globalThis Map'; Text = 'Live Snapshot Store: Shared Redis-backed transient webcam snapshots retrieved by authorized teacher monitoring clients through authenticated polling, adopted to respect Pusher payload limits.' },
  @{ Match = 'PayMongo (deferred)'; Text = 'PayMongo (test mode)' },
  @{ Match = 'External payment provider planned for a future'; Text = 'External checkout provider integrated for test payments, signed webhooks, subscription activation, and refund events.' },
  @{ Match = 'Not yet integrated; no current interest exposure.'; Text = 'Server-only test secret key and per-endpoint webhook signing secret; live mode remains disabled.' },
  @{ Match = 'Gemini Vision and Gemini text integrations'; Text = 'browser-side face/object models and Gemini quiz/verdict integrations' },
  @{ Match = 'the Google Gemini API (AI text and vision)'; Text = 'Gemini (quiz generation and verdicts), Pusher, Neon, Redis, S3-compatible storage, SMTP, and PayMongo test mode' },
  @{ Match = 'AI Proctoring Engine Integration complete. Indicator: Gemini Vision'; Text = 'Milestone 5 (May 5, 2026): AI Proctoring Engine Integration complete. Indicator: face-api.js/COCO-SSD detections, browser integrity signals, evidence recording, and the three-strike policy verified against controlled scenarios.' },
  @{ Match = 'Description: Integrate Gemini Vision for periodic webcam-frame analysis'; Text = 'Description: Integrate browser-side face-api.js and COCO-SSD inference, browser integrity signals, the three-strike policy, bounded incident-video recording, live monitoring, and Gemini-based quiz generation/post-exam verdict assistance.' },
  @{ Match = 'Necessary Resources: Pino, Dheyan J. & Pacaldo, Christian Glenn C.; Google Gemini API, Pusher.'; Text = 'Necessary Resources: Pino, Dheyan J. and Pacaldo, Christian Glenn C.; face-api.js, TensorFlow.js COCO-SSD, MediaRecorder, Gemini, Pusher, Redis, and S3-compatible storage.' },
  @{ Match = 'Work Products: Prisma schema (17 models)'; Text = 'Work Products: Prisma schema (19 models), versioned migrations, authentication/session controls, subscription/evidence records, and the core Route Handler API set.' },
  @{ Match = 'AI correctly flags test scenarios'; Text = 'Browser-side models flag controlled face/phone scenarios; validated violations are capped at three; evidence is retained as a protected short video or supported fallback; lightweight events reach the teacher dashboard.' },
  @{ Match = 'Planned Improvement: Introduction of an automated unit/integration test suite'; Text = 'Planned Improvement: Expand the existing unit/security and Playwright desktop/mobile suites with concurrency load testing, additional physical-device coverage, accessibility checks, and automated provider sandbox tests.' },
  @{ Match = 'AI Detection Inaccuracy: Gemini Vision'; Text = 'AI Detection Inaccuracy: Browser-side face landmark or COCO-SSD inference produces false positives/negatives under poor lighting, occlusion, camera quality, or unusual angles.' },
  @{ Match = 'rely on Gemini Vision as the server-side backstop'; Text = 'document browser limits explicitly, combine independent signals, preserve reviewable evidence, and classify mobile sessions as Reduced Assurance.' },
  @{ Match = 'In-Memory Live-Snapshot Store Is Not Production-Safe'; Text = 'Shared-State Availability: Redis or S3-compatible evidence storage is unavailable during an active monitoring session.' },
  @{ Match = 'Confirm the production hosting target early'; Text = 'Use health checks, bounded preflight timeouts, Redis-backed snapshots, durable object storage, retention cleanup, and graceful degradation that never fabricates a violation.' },
  @{ Match = 'no continuous video is transmitted or stored, only periodic still frames'; Text = 'no continuous full-session video is transmitted or stored; only bounded 3-5 second clips associated with persisted incidents (or a snapshot fallback) are retained under access controls and retention policy.' },
  @{ Match = 'The decision to move AI proctoring analysis server-side'; Text = 'The decision to perform active face and phone detection in the browser reduces continuous frame transmission and Gemini dependency, while Redis, Pusher, and S3-compatible storage separate transient monitoring state from durable evidence. This requires explicit capability checks and reduced-assurance disclosure on mobile devices.' },
  @{ Match = 'frontend, API layer, and server-side AI orchestration all run'; Text = 'frontend, API layer, authentication, subscription enforcement, and server integrations run within the same codebase. Active visual inference runs in the browser; server-side Gemini calls are limited to quiz generation and post-exam verdicts.' },
  @{ Match = 'The AI engine (Gemini text and vision) is integrated'; Text = 'The browser inference models, Gemini generation/verdict services, evidence recording, Redis/Pusher monitoring, and PayMongo test billing are integrated in focused sprint windows.' },
  @{ Match = 'violation detection (client-side and Gemini Vision)'; Text = 'violation detection (browser signals, face landmarks, and COCO-SSD), evidence recording, entitlement enforcement, signed billing webhooks' },
  @{ Match = 'AI - Vision'; Text = 'AI - Browser Vision' },
  @{ Match = 'Google Gemini API (gemini-1.5-pro)'; Text = 'face-api.js + TensorFlow.js COCO-SSD' },
  @{ Match = 'Server-side analysis of webcam frames for proctoring violations.'; Text = 'Client-side face/landmark and visible-phone inference against the webcam stream.' },
  @{ Match = 'AI Engine - Vision:'; Text = 'AI Engine - Browser Vision: face-api.js Tiny Face Detector and landmark model plus TensorFlow.js COCO-SSD for real-time face, gaze, multiple-person, and visible-phone checks.' },
  @{ Match = 'model gemini-1.5-pro, for server-side analysis'; Text = 'AI Engine - Browser Vision: face-api.js Tiny Face Detector and landmark model plus TensorFlow.js COCO-SSD for controlled real-time face, gaze, multiple-person, and visible-phone checks. Gemini is not used for continuous webcam-frame analysis.' },
  @{ Match = 'Because proctoring analysis runs server-side via the Gemini API'; Text = 'Because proctoring inference runs in each student browser, supported devices need sufficient CPU/memory for lightweight face and object models; the system performs capability checks and marks mobile sessions as Reduced Assurance.' },
  @{ Match = 'Manual end-to-end tests for user flows and ad-hoc test scripts'; Text = 'Testing: Automated Node unit/security tests cover device assurance, payment parsing/signatures, answer normalization, grading, fallback verdicts, access codes, rate limits, and subscription rules. Playwright exercises public and authenticated flows on desktop and mobile profiles; manual physical-device and controlled-camera scenarios complement automation.' },
  @{ Match = 'AI Proctoring Engine (Gemini Vision)'; Text = 'AI Proctoring Engine (browser-side face-api.js and COCO-SSD)' },
  @{ Match = 'matching evidence snapshot'; Text = 'Each controlled scenario is evaluated against the expected violation category and produces a matching downloadable 3-5 second evidence clip or supported snapshot fallback; normal conditions should not be flagged.' },
  @{ Match = 'Confirm no violation is registered when the Gemini API is unreachable'; Text = 'Confirm active proctoring continues when Gemini is unreachable and verdict generation uses its deterministic fallback.' },
  @{ Match = 'evidence snapshots are viewable on demand'; Text = 'Student status and violations appear promptly; Redis-backed live snapshots remain transient; protected incident clips are playable and downloadable on demand by an authorized teacher.' },
  @{ Match = 'Recommended addition for Capstone 2: an automated test suite'; Text = 'Maintain and expand the automated 30-test unit/security baseline and 22-scenario Playwright desktop/mobile suite; add concurrency, accessibility, and broader physical-device coverage.' },
  @{ Match = 'No continuous video is transmitted or stored'; Text = 'No continuous full-session video is transmitted or stored. The system records only bounded 3-5 second clips for persisted incidents, or a snapshot fallback when MediaRecorder is unavailable; access is teacher-owned, Pro-gated, and governed by retention cleanup.' },
  @{ Match = 'Identified Gaps (Audit-Derived): No CSRF token scheme or rate limiting'; Text = 'Implemented Controls: Authentication and sensitive APIs use grouped Redis-backed rate limits with a local fallback; protected routes enforce role/ownership checks; cookies are HttpOnly and secure in production; session versions revoke stale sessions; response security headers include CSP; webhook HMAC verification and idempotency protect billing; strict validation and bounded uploads reduce abuse.' },
  @{ Match = 'Hosting Target: Selecting and configuring the final hosting platform'; Text = 'Hosting Target: The current acceptance environment uses a production Next.js standalone build exposed temporarily through an approved Cloudflare quick tunnel. Final deployment requires a stable HTTPS domain and managed equivalents for Redis and S3-compatible object storage; temporary tunnels are not a production dependency.' },
  @{ Match = 'Gemini API key, JWT signing secret, Pusher credentials'; Text = 'Gemini, JWT, Google OAuth, SMTP, Pusher, PayMongo test/webhook, database, Redis, S3, and maintenance credentials as server-only environment variables, verified through the production preflight.' },
  @{ Match = 'Payment Gateway Integration Plan: Full payment processing'; Text = 'Payment Gateway Transition Plan: Test-mode PayMongo checkout, webhook signature verification, idempotent activation, expiry, persistence, and refund handling are implemented. Live activation requires approved merchant credentials, a permanent HTTPS webhook endpoint, and production acceptance testing.' },
  @{ Match = 'Production Hardening Plan: Replace the in-memory live-snapshot store'; Text = 'Production Hardening Status: Shared Redis snapshot/rate-limit state, S3-compatible evidence storage, access-code collision resistance, strict quiz lifecycle transitions, server-side entitlements, password-session revocation, security headers, retention cleanup, and bounded preflight checks are implemented. Remaining work is environment-specific deployment and load/device certification.' },
  @{ Match = 'Automated Testing Plan: Introduce a unit/integration/end-to-end test suite'; Text = 'Automated Testing Plan: Preserve the passing 30-test unit/security baseline and 22 Playwright desktop/mobile scenarios in continuous verification; expand with load, accessibility, and provider sandbox coverage.' },
  @{ Match = 'Admin Feature Completion Plan: Wire the existing'; Text = 'Administrative Maintenance Plan: Continue regression testing of implemented user status controls, analytics, activity logs, notifications, subscription administration, and presence cleanup as the schema evolves.' },
  @{ Match = 'Fail-Open Behavior: No violation is registered if the Gemini API is unreachable during an exam.'; Text = 'AI Degradation Behavior: Active proctoring remains browser-side when Gemini is unavailable; post-submission integrity analysis uses the deterministic fallback verdict.' },
  @{ Match = 'Live Snapshot Store: The in-memory store'; Text = 'Live Snapshot Store: Shared Redis-backed transient state polled by authorized teacher monitoring clients; permanent incident evidence is stored separately in S3-compatible object storage.' },
  @{ Match = 'The raw test scenarios used to validate the AI Proctoring Engine'; Text = 'The following controlled scenarios define the physical-camera acceptance matrix for the browser-side proctoring engine. Results recorded against the earlier architecture require physical-device revalidation against the Version 3.0 baseline before final production acceptance.' },
  @{ Match = 'Gemini API temporarily disabled mid-session'; Text = 'Gemini unavailable during post-submission verdict generation' },
  @{ Match = 'No violation (fail-open)'; Text = 'Submission succeeds and the deterministic verdict fallback is used' },
  @{ Match = 'No violation logged'; Text = 'Passed in automated fallback-verdict tests; physical workflow revalidation remains scheduled.' },
  @{ Match = 'matched expected'; Text = 'Legacy result retained; physical-device revalidation required for Version 3.0.' },
  @{ Match = 'These scenarios formed the basis for the greater-than-80%-agreement'; Text = 'These scenarios remain the basis for the greater-than-80-percent agreement target. Automated unit/security and Playwright reports are retained in the repository; new Version 3.0 physical-device observations and their protected evidence clips must be archived after the scheduled acceptance run.' },
  @{ Match = 'Decision to move AI proctoring from face-api.js'; Text = 'Decision to evaluate server-side Gemini Vision for webcam analysis; this historical direction was later reversed by the September Version 3.0 privacy/performance baseline in favor of browser-side face-api.js and COCO-SSD.' }
)

Update-Document -InputPath $SrsInput -OutputPath $srsOutput -Rules $srsRules -AdditionalChanges {
  param($xml, $namespaces)
  Add-TableRow $xml $namespaces 1 @(
    'V2.0',
    'September 5, 2026',
    'Capstone Development Team',
    'Major as-built baseline update: corrected the full-stack architecture; documented browser-side face and phone detection, teacher-controlled quiz lifecycle, mobile reduced assurance, short video evidence, Redis and S3-compatible storage, password recovery/session revocation, notifications, non-destructive retakes, Free/Pro entitlements, PayMongo test billing, maintenance controls, and automated verification.'
  )
  Add-TableRow $xml $namespaces 4 @('COCO-SSD', 'TensorFlow.js object-detection model used in the browser to identify visible phones and related objects.')
  Add-TableRow $xml $namespaces 4 @('MinIO / S3', 'S3-compatible durable object storage used for bounded incident evidence files; MinIO provides the local Docker implementation.')
  Add-TableRow $xml $namespaces 4 @('PayMongo', 'Payment provider integrated in test mode for checkout, signed webhooks, persistent Pro subscriptions, and refunds.')
  Insert-ParagraphsBefore $xml $namespaces '3.3. Usability Requirements' @(
    'VI.  Quiz Lifecycle, Answers, and Retakes (FR-QUIZ)',
    'a.  FR-QUIZ-001: The system shall enforce the server-controlled lifecycle draft -> active -> in_progress -> ended; students may enroll only while active and may begin only after the teacher starts the quiz.',
    'b.  FR-QUIZ-002: The student shall remain in a real-time waiting lobby until the teacher start event is persisted and received.',
    'c.  FR-QUIZ-003: Answers, grading, violation limits, and submission state shall be validated server-side; reconnecting shall restore the latest active attempt and saved answers.',
    'd.  FR-QUIZ-004: An approved retake shall create a separately numbered attempt and preserve the original answers, score, violations, verdict, and evidence.',
    'VII.  Evidence Management (FR-EVID)',
    'a.  FR-EVID-001: For each persisted incident, the capable client shall upload a video clip of approximately 3-5 seconds; the server shall verify type, signature, duration, ownership, size, and active-attempt state.',
    'b.  FR-EVID-002: Authorized teachers shall be able to play and download evidence, while deletion and retention cleanup shall remove both database metadata and the corresponding storage object.',
    'VIII.  Subscription and Billing (FR-SUB)',
    'a.  FR-SUB-001: A Free teacher shall be limited to five lifetime manual quiz creations and shall not access AI Create, Live Monitor, Evidence Replay, or AI Reports.',
    'b.  FR-SUB-002: An active Pro teacher shall receive unlimited quiz creation and the gated Pro features; entitlement shall persist across logout/login and expire according to server-side subscription dates.',
    'c.  FR-SUB-003: In test mode, PayMongo shall activate or update subscriptions only after a valid, recent, mode-matching, idempotently processed signed webhook.',
    'IX.  Account Recovery and Notifications (FR-ACCOUNT)',
    'a.  FR-ACCOUNT-001: Student and teacher portals shall provide OTP-based password recovery without revealing whether an email address exists; a successful reset shall revoke older sessions.',
    'b.  FR-ACCOUNT-002: Notifications shall persist in the database, update the bell, and navigate only to a role-authorized destination derived by the application rather than a user-supplied URL.',
    'X.  Device Assurance (FR-DEVICE)',
    'a.  FR-DEVICE-001: The server shall combine browser capability data with the user agent, block clients lacking required camera/security capabilities, and label supported mobile sessions Reduced Assurance.'
  )
}
$useCaseImage = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\docs\assets\proctorshield-use-cases.png'))
Replace-ZipEntry $srsOutput 'word/media/image11.png' $useCaseImage

Update-Document -InputPath $SpmpInput -OutputPath $spmpOutput -Rules $spmpRules -AdditionalChanges {
  param($xml, $namespaces)
  Add-TableRow $xml $namespaces 1 @(
    'V3.00',
    'September 5, 2026',
    'Capstone Development Team',
    'Updated the SPMP to the hardened as-built baseline: browser-side face/object proctoring, 3-5 second evidence video, Redis/MinIO infrastructure, teacher-controlled quiz lifecycle, immutable retake history, password recovery/session revocation, role-scoped notifications, Free/Pro entitlements, PayMongo test billing, backup recovery validation, security controls, deployment preflight, and passing automated desktop/mobile verification.'
  )
  Add-TableRow $xml $namespaces 4 @(
    'Revision (3.00)',
    'Capstone Development Team',
    'Reconciled the management, architecture, risk, infrastructure, acceptance, privacy, deployment, and maintenance plans with the September 5 hardened implementation and automated test evidence.',
    'September 5, 2026'
  )
  Add-TableRow $xml $namespaces 21 @(
    'Post-audit',
    'Sep 5, 2026',
    'Inoc, Pacaldo, Pino',
    'Approved the hardened browser-side face/phone detection baseline; verified Redis/MinIO infrastructure, immutable retakes, test-mode PayMongo entitlements, backup recovery, and automated desktop/mobile suites.'
  )
  Insert-ParagraphsBefore $xml $namespaces '1.2. Evolution of Plan' @(
    'September 2026 verification baseline: production build, TypeScript, ESLint, database migration, Redis, evidence storage, and health checks pass. Automated verification comprises 30 Node unit/security tests and 22 Playwright desktop/mobile scenarios. PayMongo remains intentionally in test mode, and the Cloudflare quick tunnel is an approved temporary acceptance endpoint rather than the final deployment domain.',
    'Operational readiness controls now include Neon history/snapshot recovery verification, Prisma migrations with uniqueness checks, Redis-backed shared state and rate limits, S3-compatible evidence retention, signed and idempotent billing webhooks, session-version revocation, security headers, strict ownership checks, and a preflight that reports bounded dependency stages.'
  )
}

Write-Output $srsOutput
Write-Output $spmpOutput
