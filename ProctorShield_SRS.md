# Software Requirements Specification (SRS)

---

# ProctorShield AI
### An AI-Powered Online Examination & Remote Proctoring System

**Document Version:** 1.0.0  
**Date:** May 23, 2026  
**Course:** Capstone Project / Software Engineering  
**Prepared For:** University Academic Board / Computer Science Department  
**Prepared By:** Christian Glenn Pacaldo & Team  
**Institution:** ChristianGlenn-Pacaldo/ProctorShieldAI Team  

---

## 1. Introduction

### 1.1 Document Purpose
This Software Requirements Specification (SRS) document details the complete functional, non-functional, security, and interface requirements for the **ProctorShield AI** system. The target audience of this document includes academic evaluators, system developers, security auditors, database administrators, and QA specialists who will build, verify, or deploy the platform.

### 1.2 Document Conventions
This document follows standard IEEE 830-1998 guidelines for requirements specification. Requirement priorities are classified as **High** (essential for launch), **Medium** (required but non-critical for core execution), or **Low** (optional or future enhancement). Formatting conventions include code typography for filenames and variable names.

---

## 2. Purpose
The purpose of ProctorShield AI is to provide a low-cost, scalable, and non-intrusive online examination environment that enforces academic integrity. By utilizing modern server-side LLM vision engines and standard web browser sandboxes, the system eliminates the need for expensive desktop installation utilities or root-access plugins while providing automated, real-time proctoring indicators.

---

## 3. Scope
The platform covers the implementation of a full-stack Next.js web application encompassing:
*   **Secure Exam Client:** Intercepts keyboard and browser actions to prevent standard cheating methods (copying, printing, right-clicking, tab switching).
*   **AI Proctoring Engine:** Continuous 20-second interval webcam analysis using `gemini-2.0-flash` to identify face absences, multiple faces, gaze changes, and device detections.
*   **AI-Powered Exam Generation:** Automated MCQ sheet generation via `gemini-2.5-flash` using syllabus uploads or specified topics.
*   **Teacher Monitoring Dashboard:** Sub-second WebSocket violation indicators (via Pusher) and 3-second REST polling for video feed snapshots.
*   **Admin Console:** Management portal for audit trails, global variables, and student suspensions.

---

## 4. Definitions, Acronyms, and Abbreviations
*   **SRS:** Software Requirements Specification
*   **API:** Application Programming Interface
*   **JWT:** JSON Web Token
*   **ORM:** Object Relational Mapping (e.g., Prisma)
*   **LLM:** Large Language Model
*   **DFD:** Data Flow Diagram
*   **RBAC:** Role-Based Access Control
*   **XSS:** Cross-Site Scripting
*   **CSRF:** Cross-Site Request Forgery
*   **REST:** Representational State Transfer
*   **MCQ:** Multiple-Choice Question
*   **JWT:** JSON Web Token

---

## 5. References
1.  *IEEE Std 830-1998*, IEEE Recommended Practice for Software Requirements Specifications.
2.  Next.js 15+ App Router Documentation: [Next.js Docs](https://nextjs.org/docs).
3.  Prisma Client API and Migration Reference: [Prisma Docs](https://www.prisma.io/docs).
4.  Google Gemini Multimodal API Guide: [Google AI Docs](https://ai.google.dev/docs).
5.  Pusher WebSockets Broadcast Guide: [Pusher Docs](https://pusher.com/docs).
6.  [schema.prisma](file:///c:/Users/roron/OneDrive/Desktop/proctorshieldai/prisma/schema.prisma) - Active Database Schema.
7.  [auth.ts](file:///c:/Users/roron/OneDrive/Desktop/proctorshieldai/src/lib/auth.ts) - Authentication Utilities.

---

## 6. Overall Description

### 6.1 Product Perspective
ProctorShield AI operates as a unified web platform that integrates client browsers with external cloud systems. The database resides in Neon DB (managed serverless PostgreSQL). Real-time websocket broadcasts are processed by Pusher, and vision reasoning is delegated to Google Gemini API servers.

---

## 7. Product Perspective
The architecture follows a unified, modern web pattern:

```mermaid
graph TD
    subgraph Client_Tier [Client-Side Browser]
        UI[Next.js Client Components]
        VideoEl[HTML5 Video Element]
        CanvasEl[HTML5 Canvas Snapshotter]
        Locks[Custom Event Listeners]
    end

    subgraph Service_Tier [Next.js API Layer]
        Auth[/api/auth/*]
        Exams[/api/exams/*]
        Live[/api/live/*]
        MemStore[globalThis.__snapshotStore Map]
    end

    subgraph Data_Cloud [Managed Services]
        DB[(Neon PostgreSQL Database)]
        Gemini[Google Gemini API]
        Pusher[Pusher WebSockets Channels]
    end

    UI -->|HTTP requests| Auth
    UI -->|HTTP requests| Exams
    CanvasEl -->|3s Snapshot POST| Live
    CanvasEl -->|20s Analyze POST| Live
    Locks -->|Violation POST| Live
    Live <-->|Query/Update| DB
    Live <-->|Pusher Trigger| Pusher
    Live <-->|GenerateContent| Gemini
    Pusher -->|WebSocket Alerts| UI
    Live <-->|Save/Fetch| MemStore
```

---

## 8. Product Functions
The high-level capabilities of the system include:
*   Standard registration, credentials validation, and Google OAuth login integration.
*   Interactive exam configuration wizard with access key generators.
*   Client-side secure testing viewport blocking shortcut keys, copy-pasting, and right-clicks.
*   Dynamic webcam snapshot capture, server-side memory map buffering, and teacher REST polling.
*   Gemini Vision API proxying to identify cheating violations.
*   Websocket-based violation alert systems.
*   Automatic 3-strike exam submission.
*   Admin dashboard auditing, log checking, and user status suspensions.

---

## 9. User Classes and Characteristics

| User Class | Technical Sophistication | Primary Roles | Privileges |
| :--- | :--- | :--- | :--- |
| **Students** | Medium | Join exams, consent to monitoring, answer questions, submit responses. | View/take active exams; read personal grades. |
| **Teachers** | Medium | Build examinations, auto-generate MCQs, monitor live feeds, review violation reports. | CRUD exams; view all student snapshots and AI verdicts. |
| **Administrators** | High | System configuration, database audits, user account modifications. | Full RBAC permissions; user suspension; audit logs access. |

---

## 10. Operating Environment
*   **Client OS:** Windows, macOS, Linux, ChromeOS.
*   **Web Browsers:** Google Chrome 90+, Microsoft Edge 90+, Mozilla Firefox 85+, Apple Safari 14+. Must support HTML5 Video, Canvas, and Javascript.
*   **Server Runtime:** Node.js 18+ (Vercel Serverless environment).
*   **Database:** PostgreSQL 15+ (Neon Serverless PostgreSQL).
*   **WebSockets:** Pusher WebSockets Channels protocol v8.0+.

---

## 11. Design and Implementation Constraints
1.  **Browser Security Sandbox:** Javascript cannot restrict OS-level keys like `Win+Shift+S` or hardware-level capture cards.
2.  **Pusher Message Payload Limit:** Pusher enforces a strict **10KB limit** per message, requiring raw snapshot images to be cached in-memory and retrieved via REST polling instead of WebSockets.
3.  **Google Gemini API Rate Limits:** Free-tier Gemini keys restrict analysis to $\sim 15$ queries per minute, limiting webcam analysis to 20-second intervals per student.
4.  **Ephemeral Memory Storage:** Server-side maps (`globalThis.__snapshotStore`) are in-memory. Restarting the serverless instance clears active snapshots (students must re-upload a snapshot within 3 seconds).

---

## 12. Assumptions and Dependencies
*   Students have a functional webcam and a stable internet connection ($>1\text{ Mbps}$ upload speed).
*   The system has access to valid `DATABASE_URL` (PostgreSQL), `GEMINI_API_KEY`, and Pusher API credentials in the environment variables.
*   Students grant browser webcam permissions when launching the exam.

---

## 13. Functional Requirements

### 13.1 User Authentication (FR-AUTH)

#### FR-AUTH-01: User Registration
*   **Description:** Allow new users to register as a student or teacher.
*   **Inputs:** Full Name, Email, Password, Role choice.
*   **Outputs:** User record in DB, redirect to login page.
*   **Preconditions:** Email must be unique. Password must be $\ge 6$ characters.
*   **Postconditions:** User is created with hashed password and assigned to the selected role.
*   **Priority:** High

#### FR-AUTH-02: User Login & Session Creation
*   **Description:** Authenticate users using credentials and set a secure session cookie.
*   **Inputs:** Email, Password, selected Role.
*   **Outputs:** JSON user payload, secure HTTP-Only cookie `ps_session`.
*   **Preconditions:** User exists and account status is `active`.
*   **Postconditions:** Session JWT is issued, and activity log is updated in the DB.
*   **Priority:** High

---

### 13.2 Examination Management (FR-EXAM)

#### FR-EXAM-01: Exam Configuration
*   **Description:** Enable teachers to create exams with custom titles, timers, passing scores, and access codes.
*   **Inputs:** Title, Subject, Duration (minutes), Shuffling toggle, Passing Score.
*   **Outputs:** Created Exam record with unique Access Code.
*   **Preconditions:** Authenticated as `teacher`.
*   **Postconditions:** Exam is created in `draft` status.
*   **Priority:** High

#### FR-EXAM-02: AI Question Generation
*   **Description:** Use Gemini 2.5 Flash to automatically generate MCQ questions from a text topic or document screenshot.
*   **Inputs:** Topic string or Syllabus image base64, target number of questions.
*   **Outputs:** Structured JSON array of questions, choices, and correct flags.
*   **Preconditions:** Authenticated as `teacher`. Gemini API key is valid.
*   **Postconditions:** Question bank is populated for the target exam.
*   **Priority:** Medium

---

### 13.3 Secure Client & Anti-Cheat (FR-ROOM)

#### FR-ROOM-01: Browser Locking & Shortcut Interception
*   **Description:** Disable copying, pasting, text selection, right-clicking, and common developer keys (e.g. F12, PrintScreen).
*   **Inputs:** Mouse context-click, keyboard combinations.
*   **Outputs:** Event default behavior is blocked; warning alert is rendered.
*   **Preconditions:** Student launches an active exam session.
*   **Postconditions:** Key presses and mouse clicks are intercepted and prevented.
*   **Priority:** High

#### FR-ROOM-02: Visibility Monitoring & Tab-Switch Detection
*   **Description:** Track focus changes to the exam tab. If the window is minimized or tab is switched, record a violation.
*   **Inputs:** Visibility API state changes.
*   **Outputs:** HTTP POST warning report to `/api/live/violation`, strike counter increment.
*   **Preconditions:** Student is inside the active testing room viewport.
*   **Postconditions:** If visibility changes, the student receives an on-screen warning and a strike.
*   **Priority:** High

---

### 13.4 AI Proctoring Pipeline (FR-PROC)

#### FR-PROC-01: Webcam Frame Analysis
*   **Description:** Capture a webcam snapshot, compress it, and proxy it to the Gemini API for behavioral analysis.
*   **Inputs:** Base64-encoded webcam JPEG.
*   **Outputs:** Violation category tags array (e.g. `["looking_away"]`).
*   **Preconditions:** Webcam is verified; active monitoring interval of 20 seconds is triggered.
*   **Postconditions:** If violation categories are returned, they are logged in the database.
*   **Priority:** High

#### FR-PROC-02: Three-Strike Auto-Termination
*   **Description:** Automatically submit and terminate the exam once the student's violation counter reaches 3.
*   **Inputs:** Update to violationCount.
*   **Outputs:** Redirect to student dashboard, auto-submit exam payload.
*   **Preconditions:** Student has accumulated $\ge 3$ verified violation records.
*   **Postconditions:** `StudentExam` status is updated to `completed`, and the exam room is closed.
*   **Priority:** High

---

### 13.5 Real-Time Supervision (FR-MON)

#### FR-MON-01: Teacher Live Monitor Snapshot Polling
*   **Description:** Retrieve and display active student snapshots to the teacher.
*   **Inputs:** GET request containing `examId`.
*   **Outputs:** List of active student snapshots from server memory.
*   **Preconditions:** Authenticated as `teacher`.
*   **Postconditions:** Snapshot grid on the UI is updated with the latest webcam frames.
*   **Priority:** High

#### FR-MON-02: Real-time Pusher Violation Alert
*   **Description:** Send a WebSocket alert to the teacher immediately when a violation occurs.
*   **Inputs:** WebSocket event payload triggered by `/api/live/violation`.
*   **Outputs:** Live on-screen warning toast and flashing red border on the student's feed.
*   **Preconditions:** Teacher is viewing the monitor page for the active exam.
*   **Postconditions:** Dashboard UI updates in real-time.
*   **Priority:** High

---

## 14. Non-Functional Requirements

### 14.1 Performance & Latency
*   **WebSocket Alerts:** Pusher alerts must propagate to the teacher monitor dashboard in under $1.5\text{ seconds}$.
*   **REST Image Retrieval:** Database queries and snapshot caching lookups must resolve in under $100\text{ms}$.
*   **Snapshot Updates:** UI grid updates must complete in under $3.0\text{ seconds}$ from student camera capture.

### 14.2 Reliability & Fault Tolerance
*   **Fail-Open AI Policy:** If the Gemini Vision API rate limits or fails, the student's exam must proceed normally without disruption.
*   **State Recovery:** If a client browser unexpectedly restarts, the student can rejoin and continue the exam with their remaining time and saved answers intact.

### 14.3 Accessibility
*   **UI Contrast:** The user interface must support high-contrast styling and keyboard navigation.

---

## 15. External Interface Requirements

### 15.1 User Interfaces
*   **Responsive Web Design:** Dashboards must render properly on desktop, tablet, and mobile views. The secure quiz room is optimized for screens larger than 1024px.
*   **UI Styling System:** Uses Tailwind CSS for consistent layouts and styling tokens.

### 15.2 Hardware Interfaces
*   **Webcam Support:** Integrates with local media input devices via `navigator.mediaDevices.getUserMedia`.

### 15.3 Software Interfaces
*   **Prisma Client Database Engine:** Interfaces with Neon PostgreSQL for database migrations and queries.
*   **Google Gemini SDK:** Connects to the Gemini API (`gemini-2.0-flash` and `gemini-2.5-flash`).
*   **Pusher Channels SDK:** Used to manage serverless WebSocket event broadcasting.

### 15.4 Communication Interfaces
*   Enforces secure HTTPS encryption (TLS 1.3) for all web traffic and API routes.

---

## 16. System Features

### 16.1 Secure Exam Client
*   **Visiblity Tracker:** Monitors focus changes to the exam tab. If the student switches tabs, a violation is recorded.
*   **Input Lockouts:** Blocks right-clicking, text selection, copy-pasting, and common developer keys (e.g., F12, PrintScreen).
*   **Auto-Submit:** Triggers automatic exam submission once the student reaches 3 strikes.

### 16.2 AI Proctoring Engine
*   **Visual Analysis:** Sends webcam snapshots to Gemini every 20 seconds to analyze student behavior.
*   **Suspicious Behavior Flags:** Detects:
    *   `no_face` (Student absent)
    *   `multiple_faces` (External helper present)
    *   `looking_away` (Gaze off-screen)
    *   `device_detected` (Mobile phone/tablet in frame)

### 16.3 Real-Time Live Monitor Dashboard
*   **Snapshot Polling:** Teachers poll the server every 3 seconds to fetch the latest student snapshots, bypassing WebSocket payload limit checks.
*   **Websocket Alerts:** WebSockets are used only for lightweight notifications (e.g. joins, violations), keeping transmission latency under 1.5 seconds.

---

## 17. Database Requirements
The database uses PostgreSQL and Prisma ORM, defined in [schema.prisma](file:///c:/Users/roron/OneDrive/Desktop/proctorshieldai/prisma/schema.prisma):

```
  Prisma Schema Models (17 Total):
  ├── Roles & Users (roles, users)
  ├── Course & Exams (subjects, exams, questions, choices)
  ├── Attempt Records (student_exams, answers)
  ├── Proctor Logs (violations, evidence_files, ai_analysis)
  ├── In-App Alerts (notifications, activity_logs)
  ├── Payments & Billing (subscription_plans, user_subscriptions, payments)
  └── Customization Configuration (settings)
```

### Key Relationships
*   **User & Role (1:M):** Users are assigned a role (`student`, `teacher`, `admin`).
*   **Exam & Question (1:M):** An exam contains multiple questions.
*   **Question & Choice (1:M):** Questions have multiple choice options.
*   **StudentExam & Violation (1:M):** Tracks infractions recorded during an exam attempt.
*   **StudentExam & AiAnalysis (1:1):** Stores the final Gemini-generated exam integrity summary.

---

## 18. Security Requirements
*   **Password Protection:** Passwords hashed with `bcryptjs` (12 rounds) during registration.
*   **Session Security:** Session JWTs stored in secure, HttpOnly, SameSite cookies to protect against XSS and CSRF.
*   **Query Safety:** Parameterized database queries via Prisma ORM protect against SQL Injection.
*   **Role-Based Access:** Server-side route middleware checks session JWT claims to restrict endpoint access (e.g. students cannot call teacher endpoints).

---

## 19. AI Integration Requirements
*   **Visual Proctoring:** Calls `gemini-2.0-flash` with a system prompt to detect face absence, multiple faces, looking away, and devices in a base64 webcam image.
*   **Exam Generation:** Calls `gemini-2.5-flash` with the configuration `responseMimeType: "application/json"` to generate MCQs from topics or images.
*   **Error Tolerance:** If the Gemini API fails or rate limits, the system defaults to assuming no violations (fail-open), ensuring students can complete their exam.

---

## 20. Performance Requirements
*   **WebSocket Alerts:** Pusher alerts must load in under $1.5\text{ seconds}$.
*   **Snapshot Updates:** Client-uploaded images must render on the teacher monitoring grid in under $3.0\text{ seconds}$.
*   **Database Query Time:** All database queries must execute in under $100\text{ms}$.

---

## 21. Software Quality Attributes
*   **Availability:** Employs a fail-open proctoring policy to keep exams accessible even during API outages.
*   **Compatibility:** Compatible with HTML5-compliant browsers on Windows, macOS, Linux, and ChromeOS.
*   **Usability:** Simple, responsive dashboard designs with keyboard navigation support for exam rooms.

---

## 22. Use Case Descriptions

### 22.1 Use Case 1: Taking an Exam (Student)
*   **Actors:** Student.
*   **Description:** Student joins an exam, grants camera permissions, completes questions, and submits answers under proctoring monitor lockouts.
*   **Flow of Events:**
    1.  Student logs in and enters the exam access code.
    2.  Student grants webcam permission.
    3.  Exam page locks input copy/paste and right-clicks.
    4.  Student answers questions while webcam snapshots upload every 3 seconds.
    5.  Gemini evaluates snapshots every 20 seconds.
    6.  Student completes the exam and clicks **Submit**.
*   **Alternative Flow (3 Strikes):** If the student switches tabs 3 times, the system records the violations, automatically submits the exam, and redirects the student to the dashboard.

### 22.2 Use Case 2: Monitoring an Exam (Teacher)
*   **Actors:** Teacher.
*   **Description:** Teacher monitors student webcam snapshots and receives real-time violation alerts.
*   **Flow of Events:**
    1.  Teacher logs in and goes to the monitoring portal.
    2.  Teacher selects an active exam.
    3.  UI grid displays active student snapshots, polling the server every 3 seconds.
    4.  If a student triggers an infraction, a WebSocket alert is received, flashing a red warning border on the student's card.
    5.  Teacher reviews the student's violation history.

### 22.3 Use Case 3: Generating Questions with AI (Teacher)
*   **Actors:** Teacher.
*   **Description:** Teacher uploads a syllabus file or inputs a topic to auto-generate MCQ exam questions.
*   **Flow of Events:**
    1.  Teacher opens the exam creation dashboard.
    2.  Teacher enters a topic (e.g. "Arrays and Loops") or uploads an image.
    3.  Teacher specifies the number of questions.
    4.  Gemini generates MCQ options in JSON format.
    5.  Teacher reviews, edits, and saves the questions to the exam.

---

## 23. Data Flow Descriptions
*   **Level-0 Data Flow Diagram (Context DFD):** 
    ```
      Student  ────► Webcam frame/Responses ───►  [ ProctorShield ]
      Teacher  ◄───► Alerts & Exam Settings  ◄──►  [  Next.js App  ]
      Admin    ◄───► Logs & User Controls    ◄──►  [   Instance    ]
    ```
*   **Level-1 Data Flow Diagram (Detailed DFD):**
    1.  *Authentication Process:* User credentials match with Neon PostgreSQL User records. Returns session JWT.
    2.  *Exam Session Creation Process:* Student submits access code. Retrieves active exam configurations from database, initializing `StudentExam` and returning questions.
    3.  *Proctoring Analysis Process:* Capture loop sends webcam snapshots to Next.js API. The API proxies snapshots to Google Gemini API. Returns violation results.
    4.  *Notification Broadcast Process:* Violation records are saved. Triggers Pusher Websocket trigger. Pusher pushes alerts to the teacher's browser.

---

## 24. Error Handling Requirements
*   **Hardware Issues:** If the student's webcam disconnected or permission is denied, block exam entry and prompt an alert.
*   **WebSocket Reconnect:** If Pusher WebSockets drop, the teacher dashboard client must attempt reconnection retries.
*   **AI API Rate Limits:** If Gemini returns a rate limit error (HTTP 429), log no visual violations (fail-open) and retry the request at the next interval.

---

## 25. Future Enhancements
*   **Redis Caching:** Move the transient snapshot store from in-memory maps to a shared Redis cache to support multi-instance serverless deployments.
*   **WebRTC Streaming:** Upgrade the teacher live monitor from 3-second snapshots to low-latency peer-to-peer WebRTC video streams.
*   **Audio Monitoring:** Integrate microphone analysis to detect talking or whispering during exams.
*   **Electron Kiosk Client:** Build an Electron desktop wrapper to lock down OS-level utilities (such as Snipping Tool and secondary monitors).

---

## 26. Appendices

### Appendix A: Pre-Configured Demo Accounts
The following test credentials can be generated using [seed.ts](file:///c:/Users/roron/OneDrive/Desktop/proctorshieldai/prisma/seed.ts):

| System Role | Username / Email | Password | Access Privileges |
| :--- | :--- | :--- | :--- |
| **System Admin** | `admin@proctorshield.ai` | `admin123` | Total platform access; logs; user suspensions. |
| **Teacher** | `teacher@demo.com` | `teacher123` | Exam creation; live monitoring; AI reports. |
| **Student** | `student@demo.com` | `student123` | Join exams; submit answers; view grades. |

---

### Appendix B: Simulated Access Codes
Use these codes within the student portal to join mock exam sessions:
*   `PS-8821`: CS101 Midterm exam (Status: Active)
*   `PS-7412`: CS101 Quiz 2 on arrays and loops (Status: Completed)
*   `PS-3047`: Technical Writing Finals (Status: Draft)
*   `PS-5519`: Calculus II Quiz 3 (Status: Draft)
