param(
  [string]$OutputDirectory = "docs\submission"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Update-DocxParagraphText {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Replacements,
    [System.Collections.IDictionary]$StatusRowReplacements = @{},
    [switch]$PatchDependencyRiskRatings
  )

  $archive = [System.IO.Compression.ZipFile]::Open($Path, [System.IO.Compression.ZipArchiveMode]::Update)
  try {
    $entry = $archive.GetEntry("word/document.xml")
    if (-not $entry) { throw "word/document.xml was not found in $Path" }

    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { $xmlText = $reader.ReadToEnd() } finally { $reader.Dispose() }

    $xml = [System.Xml.XmlDocument]::new()
    $xml.PreserveWhitespace = $true
    $xml.LoadXml($xmlText)

    $ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
    $ns.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
    $paragraphs = @($xml.SelectNodes("//w:p", $ns))
    $counts = @{}

    foreach ($oldText in $Replacements.Keys) { $counts[$oldText] = 0 }

    foreach ($paragraph in $paragraphs) {
      $textNodes = @($paragraph.SelectNodes(".//w:t", $ns))
      if ($textNodes.Count -eq 0) { continue }
      $currentText = ($textNodes | ForEach-Object { $_.InnerText }) -join ""
      $matchedText = $null
      foreach ($oldText in $Replacements.Keys) {
        if ($currentText -eq $oldText -or $currentText.Contains([string]$oldText)) {
          $matchedText = [string]$oldText
          break
        }
      }
      if (-not $matchedText) { continue }

      $textNodes[0].InnerText = [string]$Replacements[$matchedText]
      [void]$textNodes[0].SetAttribute("space", "http://www.w3.org/XML/1998/namespace", "preserve")
      for ($index = 1; $index -lt $textNodes.Count; $index++) {
        $textNodes[$index].InnerText = ""
      }
      $counts[$matchedText]++
    }

    foreach ($row in @($xml.SelectNodes("//w:tr", $ns))) {
      $cells = @($row.SelectNodes("./w:tc", $ns))
      if ($cells.Count -lt 2) { continue }
      $moduleText = (($cells[0].SelectNodes(".//w:t", $ns) | ForEach-Object { $_.InnerText }) -join "")
      foreach ($moduleAnchor in $StatusRowReplacements.Keys) {
        if (-not $moduleText.Contains([string]$moduleAnchor)) { continue }
        $statusNodes = @($cells[1].SelectNodes(".//w:t", $ns))
        if ($statusNodes.Count -eq 0) { throw "Status cell has no text node for $moduleAnchor" }
        $statusNodes[0].InnerText = [string]$StatusRowReplacements[$moduleAnchor]
        [void]$statusNodes[0].SetAttribute("space", "http://www.w3.org/XML/1998/namespace", "preserve")
        for ($index = 1; $index -lt $statusNodes.Count; $index++) { $statusNodes[$index].InnerText = "" }
      }

      $rowText = (($row.SelectNodes(".//w:t", $ns) | ForEach-Object { $_.InnerText }) -join "")
      if ($PatchDependencyRiskRatings -and $rowText.Contains("RSK-09") -and $rowText.Contains("Dependency Advisory") -and $cells.Count -ge 6) {
        $riskValues = @("Medium", "High", "High")
        for ($cellIndex = 2; $cellIndex -le 4; $cellIndex++) {
          $riskNodes = @($cells[$cellIndex].SelectNodes(".//w:t", $ns))
          if ($riskNodes.Count -eq 0) { throw "RSK-09 rating cell has no text node" }
          $riskNodes[0].InnerText = $riskValues[$cellIndex - 2]
          for ($textIndex = 1; $textIndex -lt $riskNodes.Count; $textIndex++) { $riskNodes[$textIndex].InnerText = "" }
        }
      }
    }

    $missing = @($counts.GetEnumerator() | Where-Object { $_.Value -eq 0 })
    if ($missing.Count -gt 0) {
      $labels = ($missing | ForEach-Object { $_.Key.Substring(0, [Math]::Min(80, $_.Key.Length)) }) -join " | "
      throw "Expected document text was not found in ${Path}: $labels"
    }

    $stream = $entry.Open()
    try {
      $stream.SetLength(0)
      $settings = [System.Xml.XmlWriterSettings]::new()
      $settings.Encoding = [System.Text.UTF8Encoding]::new($false)
      $settings.Indent = $false
      $writer = [System.Xml.XmlWriter]::Create($stream, $settings)
      try { $xml.Save($writer) } finally { $writer.Dispose() }
    } finally {
      $stream.Dispose()
    }
  } finally {
    $archive.Dispose()
  }
}

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$output = [System.IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
[System.IO.Directory]::CreateDirectory($output) | Out-Null

$sourceSrs = Join-Path $root "docs\updated\SRS_ProctorShieldAI_UPDATED_2026-09-05.docx"
$sourceSpmp = Join-Path $root "docs\updated\SPMP_ProctorShieldAI_UPDATED_2026-09-05.docx"
$sourceStd = Join-Path $root "docs\updated\fixed\ProctorShield_AI_STD_v1.0_2026-09-05.docx"
$sourceSdd = Join-Path $root "docs\updated\fixed\ProctorShield_AI_SDD_v1.0_2026-09-05.docx"

$finalSrs = Join-Path $output "ProctorShield_AI_SRS_v2.0_FINAL.docx"
$finalSpmp = Join-Path $output "ProctorShield_AI_SPMP_v3.0_FINAL.docx"
$finalStd = Join-Path $output "ProctorShield_AI_STD_v1.0_FINAL.docx"
$finalSdd = Join-Path $output "ProctorShield_AI_SDD_v1.0_FINAL.docx"

Copy-Item -LiteralPath $sourceSrs -Destination $finalSrs -Force
Copy-Item -LiteralPath $sourceSpmp -Destination $finalSpmp -Force
Copy-Item -LiteralPath $sourceStd -Destination $finalStd -Force
Copy-Item -LiteralPath $sourceSdd -Destination $finalSdd -Force

$srsReplacements = [ordered]@{
  "a.  FR-QUIZ-001: The system shall enforce the server-controlled lifecycle draft -> active -> in_progress -> ended; students may enroll only while active and may begin only after the teacher starts the quiz." = "a.  FR-QUIZ-001: The system shall enforce the server-controlled lifecycle draft -> active -> in_progress -> ended. Students may enroll while a quiz is draft or active so the pre-start waiting room can operate, but they may begin answering only after the teacher starts the quiz and the server transitions it to in_progress."
  "b.  API Security: Gemini and Pusher API keys must remain completely server-side and must never be exposed to the client." = "b.  API Security: Gemini credentials, the Pusher app secret, and other privileged provider credentials must remain server-side. The Pusher public key and cluster may be exposed to the browser only for client connection setup; private-channel authorization and all privileged operations must remain server-authorized."
}

$spmpReplacements = [ordered]@{
  "Updated the SPMP to the hardened as-built baseline: browser-side face/object proctoring, 3-5 second evidence video, Redis/MinIO infrastructure, teacher-controlled quiz lifecycle, immutable retake history, password recovery/session revocation, role-scoped notifications, Free/Pro entitlements, PayMongo test billing, backup recovery validation, security controls, deployment preflight, and passing automated desktop/mobile verification." = "Updated the SPMP to the hardened as-built baseline: browser-side face/object proctoring, 3-5 second evidence video, Redis/MinIO infrastructure, teacher-controlled quiz lifecycle, immutable retake history, password recovery/session revocation, role-scoped notifications, Free/Pro entitlements, PayMongo test billing, backup recovery validation, security controls, deployment preflight, 30 passing unit/security tests, and a 22-scenario Playwright suite whose current default run passes 14 public scenarios and skips 8 authenticated scenarios pending the controlled database run."
  "Secure exam client (tab / copy / screenshot / audio detection)" = "Secure exam client (tab / copy / detectable screenshot shortcuts / audio signals)"
  "AI proctoring engine (face-api.js + COCO-SSD) and three-strike policy" = "AI proctoring engine (face-api.js + COCO-SSD) and three-strike policy"
  "Teacher live monitor & evidence replay" = "Teacher live monitor & evidence replay"
  "Complete baseline: 30 unit/security tests plus 22 Playwright desktop/mobile end-to-end scenarios; production build, TypeScript, and ESLint checks pass." = "Conditional baseline: 30 unit/security tests pass; 22 Playwright desktop/mobile scenarios are defined, with 14 passing and 8 authenticated scenarios skipped in the default run. Production build, TypeScript, and ESLint checks pass."
  "September 2026 verification baseline: production build, TypeScript, ESLint, database migration, Redis, evidence storage, and health checks pass. Automated verification comprises 30 Node unit/security tests and 22 Playwright desktop/mobile scenarios. PayMongo remains intentionally in test mode, and the Cloudflare quick tunnel is an approved temporary acceptance endpoint rather than the final deployment domain." = "September 2026 verification baseline: production build, TypeScript, ESLint, database migration, Redis, evidence storage, and health checks pass. All 30 Node unit/security tests pass. The Playwright suite defines 22 desktop/mobile scenarios; 14 public/security scenarios pass in the default run and 8 authenticated scenarios remain skipped until the controlled disposable-database run is enabled. PayMongo remains intentionally in test mode, and the Cloudflare quick tunnel is an approved temporary acceptance endpoint rather than the final deployment domain."
  "Operational readiness controls now include Neon history/snapshot recovery verification, Prisma migrations with uniqueness checks, Redis-backed shared state and rate limits, S3-compatible evidence retention, signed and idempotent billing webhooks, session-version revocation, security headers, strict ownership checks, and a preflight that reports bounded dependency stages." = "Operational readiness controls now include Neon history/snapshot recovery verification, Prisma migrations with uniqueness checks, Redis-backed shared state and rate limits, S3-compatible evidence retention, signed and idempotent billing webhooks, session-version revocation, security headers, strict ownership checks, and a preflight that reports bounded dependency stages. Production acceptance remains blocked until the open high/moderate mysql2 advisories reported through Prisma tooling are remediated or formally risk-accepted and regression-tested."
  "Document ID: SPMP-2026-V2.0" = "Document ID: SPMP-2026-V3.0"
  "Specification/Version: gemini-1.5-pro (Vision), gemini-2.5-flash (Text)" = "Specification/Version: gemini-2.5-flash with configured fallback models for multimodal quiz-input processing and text-based verdict assistance"
  "Next.js Route Handler endpoints, PostgreSQL schema via Prisma ORM, Google Gemini API integration (vision + text), real-time event broadcasting via Pusher." = "Next.js Route Handler endpoints, PostgreSQL schema via Prisma ORM, Gemini quiz-generation and post-submission verdict integration, and server-authorized real-time event broadcasting via Pusher."
  "Responsible for building Next.js Route Handler endpoints, configuring the PostgreSQL schema through Prisma ORM, integrating the Google Gemini API for vision and text tasks, and broadcasting real-time events via Pusher." = "Responsible for building Next.js Route Handler endpoints, configuring the PostgreSQL schema through Prisma ORM, integrating Gemini for quiz generation and post-submission verdict assistance, and broadcasting server-authorized real-time events via Pusher."
  "Google Gemini API integration (text + vision)" = "Google Gemini API integration (multimodal quiz input + verdict assistance)"
  "Gemini API, Pusher" = "face-api.js, TensorFlow.js COCO-SSD, MediaRecorder, Gemini API, Pusher, Redis, S3-compatible storage"
  "Milestone 5 (May 5, 2026): AI Proctoring Engine Integration complete. Indicator: face-api.js/COCO-SSD detections, browser integrity signals, evidence recording, and the three-strike policy verified against controlled scenarios." = "Milestone 5 (May 5, 2026): AI Proctoring Engine Integration. Indicator: face-api.js/COCO-SSD detections, browser integrity signals, evidence recording, and the three-strike policy implemented; Version 3.0 controlled physical-device revalidation remains an acceptance gate."
  "Milestone 6 (May 19, 2026): Final Deployment. Indicator: application accessible via a live staging/production URL." = "Milestone 6 (May 19, 2026): Planned Final Deployment. Indicator: application accessible through a stable HTTPS staging/production URL. Current status: temporary acceptance tunneling was exercised, but stable managed deployment remains pending."
  "This subclause outlines the continuous strategy for identifying, prioritizing, and mitigating technical and operational risks across the 16-week development timeline. Risk items below are retained from the original plan (updated to reflect the Gemini-based architecture) and supplemented with items surfaced by the July 8, 2026 source-code audit." = "This subclause outlines the continuous strategy for identifying, prioritizing, and mitigating technical and operational risks across the development timeline. Risk items are reconciled with the September 5, 2026 browser-side detection, Gemini-assisted content/verdict, and deployment-readiness baseline."
  "AI Detection Inaccuracy: Browser-side face landmark or COCO-SSD inference produces false positives/negatives under poor lighting, occlusion, camera quality, or unusual angles." = "AI Detection Inaccuracy: Browser-side face landmark or COCO-SSD inference produces false positives or negatives under poor lighting, occlusion, camera quality, or unusual angles."
  "Test with diverse lighting/device scenarios; tune confidence thresholds; keep the fail-open behavior (no violation on Gemini error) and a manual teacher override via Evidence Replay." = "Test with diverse lighting and device scenarios; tune confidence thresholds; treat model-load or inference errors as Reduced Assurance instead of fabricating violations; preserve manual teacher review through Evidence Replay."
  "No CSRF Protection or Rate Limiting on Authentication Endpoints." = "CSRF and origin-control coverage requires formal verification; authentication rate limiting is implemented."
  "Add rate limiting to /api/auth/* routes and a CSRF token scheme for state-changing requests ahead of any public deployment." = "Retain grouped authentication rate limits, review every cookie-authenticated state-changing endpoint, validate Origin/SameSite defenses, and add an explicit anti-CSRF mechanism where required before public deployment."
  "Exam Access-Code Collisions:" = "Dependency Advisory: npm audit reports high and moderate mysql2 advisories through Prisma tooling; PostgreSQL is the application database, but the transitive exposure still requires assessment."
  "Add a uniqueness check with retry at access-code generation time." = "Track an upstream fix or safe Prisma upgrade, verify PostgreSQL-only runtime exposure, and do not force a breaking downgrade without full regression testing; remediate or formally accept the risk before production."
  "document browser limits explicitly, combine independent signals, preserve reviewable evidence, and classify mobile sessions as Reduced Assurance." = "Document browser limits explicitly, combine independent signals, preserve reviewable evidence, and classify mobile sessions as Reduced Assurance."
  "no continuous full-session video is transmitted or stored; only bounded 3-5 second clips associated with persisted incidents (or a snapshot fallback) are retained under access controls and retention policy." = "No continuous full-session video is transmitted or stored; only bounded 3-5 second clips associated with persisted incidents, or a snapshot fallback, are retained under access controls and the retention policy."
  "Source Code & Documentation Locking: The main branch of the GitHub repository is tagged as the v2.0 (Capstone 1) release; the finalized SRS, SPMP, and Prisma schema definitions are stored alongside it in a /docs folder." = "Source Code & Documentation Locking: After all acceptance gates pass, tag the approved main-branch release and archive the finalized SRS, SPMP, STD, SDD, Prisma schema, migrations, and retained test evidence in the repository documentation set."
  "Custom JWT Auth: The hand-rolled JSON Web Token session system (jsonwebtoken + bcryptjs, HttpOnly ps_session cookie) actually used for authentication. The next-auth package appears as a dependency but is not used anywhere in the codebase." = "Custom JWT Auth: The application uses a hand-rolled JSON Web Token session system with jsonwebtoken, bcryptjs, and an HttpOnly ps_session cookie. NextAuth/Auth.js is not part of the installed application baseline."
  "API Layer: Next.js Route Handlers (src/app/api/**/route.ts). There is no standalone Express.js server in the production application; a legacy Express.js/Vite prototype exists in the repository but is unused." = "API Layer: Next.js Route Handlers (src/app/api/**/route.ts). There is no standalone Express.js server in the production application. An optional FRONTEND_ONLY development rewrite can proxy API requests to localhost:5000, but it is not the documented production topology."
  "Authentication: Custom JWT (jsonwebtoken + bcryptjs) with an HttpOnly session cookie, plus Google OAuth as an alternate sign-in method. The next-auth package is present as a dependency but is not used anywhere in the codebase." = "Authentication: Custom JWT using jsonwebtoken and bcryptjs with an HttpOnly session cookie, plus Google OAuth as an alternate sign-in method. NextAuth/Auth.js is not installed or used in the current application baseline."
  "The primary configuration tool is GitHub. The system is organized as a single configuration item: the ProctorShield-AI monorepo, containing the Next.js frontend, API route handlers, and Prisma schema in one codebase (with a legacy, unused Express.js/Vite prototype retained for reference)." = "The primary configuration tool is GitHub. The system is organized as a single configuration item: the ProctorShield-AI repository, containing the Next.js frontend, Route Handlers, Prisma schema and migrations, tests, operational scripts, and project documentation in one codebase."
  "Hosting Target: The current acceptance environment uses a production Next.js standalone build exposed temporarily through an approved Cloudflare quick tunnel. Final deployment requires a stable HTTPS domain and managed equivalents for Redis and S3-compatible object storage; temporary tunnels are not a production dependency." = "Hosting Target: A production Next.js standalone build was exercised temporarily through an approved Cloudflare quick tunnel for acceptance testing. Final deployment requires a stable HTTPS domain and managed equivalents for Redis and S3-compatible object storage; temporary tunnels are not a production dependency."
  "The dashboard updates in near real time" = "The dashboard target is under 1.5 seconds of alert-propagation latency via Pusher for violation, login, and submission events; formal latency measurement remains pending."
  "Automated Testing Plan: Preserve the passing 30-test unit/security baseline and 22 Playwright desktop/mobile scenarios in continuous verification; expand with load, accessibility, and provider sandbox coverage." = "Automated Testing Plan: Preserve the passing 30-test unit/security baseline and all 22 defined Playwright desktop/mobile scenarios in continuous verification. The current default run passes 14 and skips 8 authenticated scenarios; enable those scenarios against a disposable database and expand coverage with load, accessibility, and provider sandbox evidence."
}

$spmpStatusRows = [ordered]@{
  "Authentication (email + password, Google OAuth)" = "Implemented; live Google OAuth and SMTP recovery acceptance evidence remains pending."
  "Exam management (manual + AI-generated)" = "Implemented; external Gemini quota/failure walkthrough evidence remains pending."
  "Secure exam client" = "Implemented; detectable events are browser-dependent and controlled laptop/mobile validation remains pending."
  "AI proctoring engine" = "Implemented; controlled physical-device accuracy validation remains pending."
  "Teacher live monitor & evidence replay" = "Conditionally implemented: Pusher/Redis snapshots and protected evidence paths are present; teacher WebRTC receiver remains pending."
  "Admin console" = "Implemented for the current scope; overlapping user-update endpoints remain pending consolidation."
  "Subscription & payment processing" = "Implemented in PayMongo test mode; external provider paid/refund webhook evidence remains pending."
}

Update-DocxParagraphText -Path $finalSrs -Replacements $srsReplacements
Update-DocxParagraphText -Path $finalSpmp -Replacements $spmpReplacements -StatusRowReplacements $spmpStatusRows -PatchDependencyRiskRatings

Write-Output $finalSrs
Write-Output $finalSpmp
Write-Output $finalStd
Write-Output $finalSdd
