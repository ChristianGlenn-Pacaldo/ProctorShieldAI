# Software Project Management Plan (SPMP)

---

<div align="center">

# ProctorShield AI
### An AI-Powered Online Examination & Remote Proctoring System

**Submitted for Capstone / Thesis Defense**

**Date:** May 19, 2026  
**Course:** Capstone Project / Software Engineering  
**Prepared By:** Christian Glenn Pacaldo (and Group Members)  
**Instructor / Panel:** [Insert Instructor/Panel Names]  
**Institution:** [Insert University/School Name]  

</div>

---

## 2. Table of Contents

1. [Title Page](#1-title-page)
2. [Table of Contents](#2-table-of-contents)
3. [Introduction](#3-introduction)
4. [System Overview](#4-system-overview)
5. [Technology Stack](#5-technology-stack)
6. [Software Development Methodology](#6-software-development-methodology)
7. [System Architecture](#7-system-architecture)
8. [Project Structure](#8-project-structure)
9. [Database Design](#9-database-design)
10. [Authentication System](#10-authentication-system)
11. [API Reference](#11-api-reference)
12. [Frontend Pages Documentation](#12-frontend-pages-documentation)
13. [AI Proctoring System](#13-ai-proctoring-system)
14. [Real-Time Monitoring Architecture](#14-real-time-monitoring-architecture)
15. [Anti-Cheat System](#15-anti-cheat-system)
16. [Environment Configuration](#16-environment-configuration)
17. [Setup and Installation Guide](#17-setup-and-installation-guide)
18. [Demo Accounts](#18-demo-accounts)
19. [Testing Strategy](#19-testing-strategy)
20. [Security Measures](#20-security-measures)
21. [Known Limitations](#21-known-limitations)
22. [Future Improvements](#22-future-improvements)
23. [Conclusion](#23-conclusion)

---

## 3. Introduction

### Project Background
The rapid shift towards remote learning and online education has exposed a critical vulnerability in modern assessment methods: maintaining academic integrity outside the traditional classroom. Unsupervised online exams are highly susceptible to cheating, including unauthorized device usage, proxy test-takers, and information sharing.

### Problem Statement
Existing proctoring solutions are often prohibitively expensive, require invasive software installations, or rely on retroactive manual reviews of recorded videos. There is a need for a lightweight, browser-based, and cost-effective proctoring system that leverages artificial intelligence to detect and flag academic dishonesty in real-time.

### Objectives
1. To develop a fully functional, browser-based online examination portal.
2. To integrate Google Gemini Vision AI for real-time detection of suspicious examinee behavior (e.g., looking away, multiple faces, device usage).
3. To implement strict browser-level constraints preventing unauthorized actions (e.g., tab switching, copy-pasting, screen capturing).
4. To provide a live monitoring dashboard for educators to oversee ongoing examinations.

### Scope
The system encompasses three primary modules: a Student Portal for taking exams, a Teacher Portal for exam creation and live monitoring, and an Admin Portal for system oversight. The AI analysis focuses strictly on visual data captured via webcam and browser interaction events.

### Significance of the Study
This project demonstrates the viable application of advanced multimodal Large Language Models (LLMs) like Gemini Vision in educational technology, proving that robust, scalable, and non-invasive proctoring can be achieved entirely within a standard web browser without requiring dedicated desktop applications.

---

## 4. System Overview

**ProctorShield AI** is an intelligent online examination platform designed to detect suspicious behavior during exams and assist educators in monitoring students remotely. 

### Role-Based Portals
*   **Teacher Portal:** Empowers educators to create exams, generate access codes, monitor active test-takers in real-time, and review automated AI violation reports.
*   **Student Portal:** A secure testing environment where examinees enter access codes, consent to monitoring, and complete assessments under strict browser and AI oversight.
*   **Admin Portal:** A centralized management interface for overseeing all users, examining system analytics, and configuring platform-wide settings.

### Core Capabilities
*   **AI-Powered Cheating Detection:** Continuous webcam frame analysis using Gemini Vision.
*   **Real-Time Exam Monitoring:** Live snapshot broadcasting to the Teacher Dashboard.
*   **Browser Security:** Hardened testing environment enforcing fullscreen, blocking copy/paste, and detecting tab switches.
*   **Automated Violation Flagging:** A strict 3-strike system that automatically terminates exams upon repeated offenses.

### High-Level Workflow
1. Teacher creates an exam and shares the generated Access Code.
2. Student logs in, enters the code, grants webcam permissions, and begins the exam.
3. The system captures webcam frames every 3 seconds for the Teacher's live view, and every 20 seconds for AI analysis.
4. If a violation is detected (AI or browser-based), the student receives a strike, and a WebSocket event alerts the teacher.
5. Upon completion or forced termination, an AI-generated integrity report is finalized.

---

## 5. Technology Stack

The project utilizes a modern, serverless-oriented stack optimized for performance, type safety, and real-time capabilities.

| Layer | Technology | Version | Purpose | Why it was chosen |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend Framework** | Next.js (App Router) | 16.2.6 | Full-stack React framework | Provides seamless hybrid rendering (SSR/CSR) and unified routing. |
| **Language** | TypeScript | 5.x | Static typing | Reduces runtime errors and improves developer experience. |
| **Styling** | Tailwind CSS | 4.x | Utility-first CSS | Accelerates UI development with consistent design tokens. |
| **Backend Runtime** | Node.js (Next.js API Routes) | 18+ | Server-side logic | Eliminates the need for a separate Express server, unifying the codebase. |
| **Database** | PostgreSQL (NeonDB) | 15+ | Relational data storage | Serverless, highly scalable, and integrates perfectly with Prisma. |
| **ORM** | Prisma | 7.8.0 | Database interaction | Ensures type-safe queries and simplifies schema migrations. |
| **Authentication** | Custom JWT + bcrypt | 9.0.3 / 3.0.3 | Secure session management | Stateless, scalable authentication using HTTP-only cookies. |
| **OAuth** | @react-oauth/google | 0.13.5 | Google Sign-In | Streamlines user onboarding and leverages existing Google accounts. |
| **Real-Time Engine** | Pusher Channels | 5.3.3 | WebSocket event broadcasting | Provides reliable, low-latency messaging for live alerts. |
| **AI Vision Engine** | Google Gemini 2.0 Flash | 2.2.0 | Multimodal analysis | Offers state-of-the-art image analysis with high efficiency. |

---

## 6. Software Development Methodology

The project was developed using the **Agile Scrum Methodology**, enabling iterative development and continuous feedback adaptation.

*   **Sprint Planning:** The project was divided into two-week sprints, prioritizing core functionalities (Authentication → Exam Engine → AI Proctoring → Real-Time Monitoring).
*   **Development Workflow:** 
    1. Requirement Analysis
    2. UI/UX Prototyping
    3. API Design & Database Schema Definition
    4. Implementation (Frontend + Backend)
    5. Integration & Testing
*   **Version Control:** Git/GitHub was utilized with a feature-branch workflow (`main`, `dev`, `feature/*`).
*   **Testing Workflow:** Continuous manual testing during development, specifically focusing on edge cases in webcam capture and browser event listeners.

---

## 7. System Architecture

The architecture follows a monolithic serverless pattern where Next.js handles both the frontend React components and the backend API routes, communicating with external managed services.

```mermaid
graph TD
    subgraph Client [Client-Side Browser]
        UI[Next.js React Frontend]
        BC[Browser Constraints]
        CAM[Webcam Capture]
    end

    subgraph Server [Next.js API Layer]
        AUTH_API[/api/auth/*]
        EXAM_API[/api/exams/*]
        LIVE_API[/api/live/*]
        MEM[In-Memory Snapshot Cache]
    end

    subgraph External_Services [Managed Services]
        DB[(Neon PostgreSQL)]
        AI[Google Gemini Vision AI]
        WS[Pusher WebSockets]
    end

    UI -->|HTTP POST/GET| AUTH_API
    UI -->|HTTP POST/GET| EXAM_API
    UI -->|HTTP GET Poll (3s)| LIVE_API
    CAM -->|HTTP POST (3s)| LIVE_API
    CAM -->|HTTP POST (20s)| LIVE_API

    AUTH_API <-->|Prisma ORM| DB
    EXAM_API <-->|Prisma ORM| DB
    LIVE_API <-->|Analyze Frame| AI
    LIVE_API <-->|Trigger Alerts| WS
    WS -->|Push Events| UI
    LIVE_API <-->|Store/Retrieve| MEM
```

### Layer Breakdown
*   **Frontend Layer:** React components managing state, rendering UI, and enforcing DOM-level restrictions (blocking right-click, listening to visibility changes).
*   **Backend Layer:** Next.js API routes acting as RESTful endpoints, validating requests, and executing business logic.
*   **Authentication Layer:** JWT generation, payload verification, and HTTP-only cookie management.
*   **AI Detection Layer:** Server-side proxy that formats webcam base64 strings and prompts the Gemini API, returning parsed violation arrays.
*   **Database Layer:** Prisma ORM interfacing with NeonDB PostgreSQL.
*   **Real-Time Layer:** A hybrid approach using REST polling for heavy image payloads and Pusher WebSockets for lightweight instant alerts.

---

## 8. Project Structure

```text
proctorshieldai/
├── prisma/
│   ├── schema.prisma          # Defines 15 database models and relationships
│   └── seed.ts                # Database population script for demo accounts
├── src/
│   ├── app/
│   │   ├── globals.css        # Tailwind directives and CSS variables
│   │   ├── layout.tsx         # Root HTML layout and providers
│   │   ├── page.tsx           # Landing/Marketing page
│   │   ├── login/
│   │   │   └── page.tsx       # Unified login and registration interface
│   │   ├── admin/
│   │   │   └── login/         # Dedicated administrator login portal
│   │   ├── dashboard/
│   │   │   ├── admin/         # Admin portal (Users, System Analytics)
│   │   │   ├── student/       # Student portal (My Exams, Results)
│   │   │   └── teacher/       # Teacher portal (Exam Creation, Live Monitor)
│   │   ├── quiz/
│   │   │   └── [id]/          # Secure testing room environment (Core Proctoring logic)
│   │   └── api/
│   │       ├── auth/          # Endpoints: login, register, logout, google, session
│   │       ├── exams/         # Endpoints: CRUD operations, join logic
│   │       └── live/          # Endpoints: analyze (AI), snapshot (polling), violation
│   ├── components/
│   │   └── dashboard-shell.tsx# Reusable layout shell for all role dashboards
│   └── lib/
│       ├── auth.ts            # JWT signing, verification, and bcrypt hashing utilities
│       ├── prisma.ts          # Global Prisma client instantiation
│       └── pusher.ts          # Pusher server configuration
├── .env                       # Environment secrets (ignored in Git)
├── next.config.mjs            # Next.js build configuration
└── package.json               # Dependency management
```

---

## 9. Database Design

The system relies on a relational database architecture managed via Prisma, containing 15 distinct models.

### Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    User ||--o{ Exam : "creates"
    User ||--o{ StudentExam : "takes"
    User }|--|| Role : "has"
    Exam ||--o{ Question : "contains"
    Exam ||--o{ StudentExam : "enrolls"
    Question ||--o{ Choice : "has options"
    StudentExam ||--o{ Answer : "submits"
    StudentExam ||--o{ Violation : "triggers"
    StudentExam ||--|| AiAnalysis : "receives"

    User {
        String id PK
        String email UK
        String password
        Int roleId FK
    }
    Exam {
        Int id PK
        String title
        String accessCode UK
        String examStatus
        String teacherId FK
    }
    StudentExam {
        String id PK
        String studentId FK
        Int examId FK
        Decimal score
        String examStatus
    }
    Violation {
        BigInt id PK
        String studentExamId FK
        String violationType
        DateTime timestamp
    }
```

### Key Models & Relationships
*   **User & Role (1:M):** Users are assigned specific roles (Admin, Teacher, Student) determining their dashboard access.
*   **Exam & Question (1:M):** An exam acts as a container for multiple questions.
*   **Exam & StudentExam (1:M):** Represents the enrollment and state of a student taking a specific exam.
*   **StudentExam & Violation (1:M):** Tracks individual infractions (e.g., `looking_away`, `tab_switch`) linked to a specific exam attempt.
*   **StudentExam & AiAnalysis (1:1):** Stores the final summary verdict generated by Gemini AI upon exam completion.

### Constraints
*   `accessCode` in the `Exam` model is `UNIQUE` to prevent enrollment collisions.
*   Foreign keys utilize referential integrity to ensure `Violations` cannot exist without a valid `StudentExam`.

---

## 10. Authentication System

The application utilizes a custom JWT-based authentication system backed by bcrypt password hashing, bypassing NextAuth for granular control.

### Security Mechanisms
1.  **bcrypt Hashing:** Passwords are hashed with 12 salt rounds before database insertion.
2.  **JWT (JSON Web Tokens):** Issued upon successful login containing non-sensitive payload (`userId`, `role`, `email`).
3.  **HTTP-Only Cookies:** Tokens are stored in secure cookies (`ps_session`) that are inaccessible to client-side JavaScript, mitigating XSS attacks.
4.  **Google OAuth:** Utilizes `@react-oauth/google` to exchange Google credentials for internal JWT sessions.

### Login Flow Sequence

```mermaid
sequenceDiagram
    participant Client
    participant API as /api/auth/login
    participant DB as NeonDB
    
    Client->>API: POST /login {email, password}
    API->>DB: SELECT * FROM User WHERE email = ?
    DB-->>API: Returns User (with hash)
    API->>API: bcrypt.compare(password, hash)
    alt Invalid
        API-->>Client: 401 Unauthorized
    else Valid
        API->>API: jwt.sign(payload, secret)
        API->>Client: 200 OK + Set-Cookie (HttpOnly)
        Client->>Client: Redirect to /dashboard/{role}
    end
```

---

## 11. API Reference

The system exposes RESTful endpoints via Next.js API Routes.

| Endpoint | Method | Role | Description | Payload / Query |
| :--- | :--- | :--- | :--- | :--- |
| `/api/auth/login` | POST | Public | Authenticates user and sets session cookie. | `{ email, password, role }` |
| `/api/auth/register` | POST | Public | Creates a new user account. | `{ fullName, email, password, role }` |
| `/api/auth/google` | POST | Public | Authenticates via Google credential token. | `{ credential, role }` |
| `/api/auth/logout` | POST | Any | Clears the `ps_session` cookie. | None |
| `/api/auth/session` | GET | Any | Returns current decoded JWT payload. | None |
| `/api/exams` | GET | Any | Lists exams based on user role. | None |
| `/api/exams` | POST | Teacher | Creates a new exam and generates Access Code. | `{ title, subjectName, duration }` |
| `/api/exams/join` | POST | Student | Enrolls student in exam via code. | `{ accessCode }` |
| `/api/exams/[id]` | PUT | Teacher | Updates exam status (e.g., draft to active). | `{ examStatus }` |
| `/api/live/join` | POST | Student | Broadcasts 'student-joined' via Pusher. | `{ examId, examTitle }` |
| `/api/live/snapshot` | POST | Student | Uploads current webcam frame to server. | `{ snapshot (base64) }` |
| `/api/live/snapshot` | GET | Teacher | Polls active student snapshots. | `?examId=123` |
| `/api/live/analyze` | POST | Student | Sends frame to Gemini Vision for cheating check. | `{ snapshot (base64) }` |
| `/api/live/violation` | POST | Student | Records violation and broadcasts alert. | `{ examId, violationType }` |

---

## 12. Frontend Pages Documentation

### Teacher Dashboard (`/dashboard/teacher`)
*   **Overview (`/`):** Displays aggregated statistics (Total Exams, Active Students).
*   **Manage Exams (`/exams`):** Interface for creating assessments. Features a modal to toggle exam availability and copy joining codes.
*   **Live Monitor (`/monitor`):** The core proctoring command center. Renders a responsive grid of student webcams updating in real-time, accompanied by live violation alert toasts.

### Student Dashboard (`/dashboard/student`)
*   **Overview (`/`):** Displays upcoming assessments and historical performance.
*   **My Exams (`/exams`):** Allows students to input a Teacher-provided Access Code to enroll and launch the secure testing environment.
*   **Quiz Room (`/quiz/[id]`):** The secure exam interface. Enforces fullscreen, prevents tab switching, blocks keyboard shortcuts, and renders the webcam preview alongside AI diagnostic health indicators.

### Admin Dashboard (`/dashboard/admin`)
*   **Overview (`/`):** System-wide metrics.
*   **User Management (`/users`):** Ability to suspend accounts or reset passwords.
*   **System Logs (`/logs`):** Audit trail of all login and exam creation events for security compliance.

---

## 13. AI Proctoring System

The AI proctoring engine leverages Google's **Gemini 2.0 Flash Vision API** to analyze visual data without requiring heavy client-side machine learning models (like TensorFlow.js).

### Workflow
1.  **Capture:** The client captures a 320x240 JPEG frame from the `<video>` element every 20 seconds.
2.  **Transmission:** The base64 image is sent to `/api/live/analyze`.
3.  **Prompt Engineering:** The server strips metadata and sends the image to Gemini with a highly constrained system prompt instructing it to identify exactly four states: `no_face`, `multiple_faces`, `looking_away`, `device_detected`.
4.  **Parsing:** Gemini responds with a JSON array string (e.g., `["looking_away", "device_detected"]`).
5.  **Action:** The server parses the response; if violations exist, it triggers the violation logging pipeline.

### Detection Pipeline Diagram

```mermaid
sequenceDiagram
    participant Canvas as Browser Canvas
    participant API as Next.js API
    participant Gemini as Gemini Vision API
    participant DB as Prisma/NeonDB

    Canvas->>API: POST Base64 Frame (every 20s)
    API->>Gemini: Request: Image + "Find cheating" Prompt
    Gemini-->>API: Response: `["device_detected"]`
    API-->>Canvas: { violations: ["device_detected"] }
    Canvas->>API: POST /api/live/violation
    API->>DB: INSERT INTO Violation
```

---

## 14. Real-Time Monitoring Architecture

Designing the real-time monitoring system required overcoming strict architectural constraints related to WebSocket payload limits.

### The Pusher Payload Bottleneck
Initially, webcam frames (base64 strings) were broadcast directly via Pusher WebSockets. However, Pusher enforces a strict **10KB payload limit** per message. Base64 JPEGs (even compressed) average 15KB - 30KB. This resulted in silent message drops and `HTTP 413 Payload Too Large` errors.

### The Hybrid Solution
To bypass WebSocket limits while maintaining real-time performance, the system utilizes a dual-transport architecture:

1.  **REST Polling (Heavy Data):** Students HTTP POST snapshots to `/api/live/snapshot`, which stores them in an ephemeral server-side Node.js `globalThis.Map`. Teachers HTTP GET poll this endpoint every 3 seconds to fetch the image grid.
2.  **Pusher WebSockets (Light Data):** Reserved strictly for instantaneous alerts (`student-joined`, `new-violation`). These payloads contain only strings and IDs (< 1KB), ensuring instantaneous, error-free delivery.

---

## 15. Anti-Cheat System

The system employs a defense-in-depth approach, combining deterministic browser constraints with probabilistic AI analysis.

### Browser-Level Security (Deterministic)
*   **Visibility API:** Listens to `document.visibilitychange`. If the user switches tabs or minimizes the window, a `tab_switch` violation is instantly logged.
*   **Clipboard Blocking:** `copy`, `cut`, and `paste` events are intercepted via `e.preventDefault()`.
*   **Context Menu Blocking:** Right-click is disabled to prevent inspecting elements or copying text.
*   **Keyboard Interception:** `keydown` events are monitored. Key combinations like `PrintScreen`, `F12`, `Ctrl+C`, `Ctrl+V`, and `Ctrl+P` are neutralized and logged as `attempted_screenshot`.

### AI-Level Detection (Probabilistic)
Driven by Gemini Vision, checking specifically for:
*   **No Face:** Examinee has left the testing area.
*   **Multiple Faces:** Unauthorized assistance is present.
*   **Looking Away:** Gaze is fixed off-screen (e.g., reading notes).
*   **Device Detected:** Cellphones, tablets, or secondary monitors are visible.

### 3-Strike Auto-Termination
The client maintains a `violationCountRef`. 
*   **Strike 1 & 2:** Triggers aggressive on-screen warnings.
*   **Strike 3:** Automatically submits the exam, logs a final failure state, and forcefully redirects the user back to the dashboard.

---

## 16. Environment Configuration

The application requires specific environment variables to function correctly.

| Variable Name | Purpose | Example Value |
| :--- | :--- | :--- |
| `DATABASE_URL` | NeonDB connection string. | `postgresql://user:pass@host/db?sslmode=verify-full` |
| `NEXTAUTH_SECRET` | Secret key used to sign JWT session cookies. | `super-secret-key-2025` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Identifier for Google OAuth Login. | `12345.apps.googleusercontent.com` |
| `GEMINI_API_KEY` | Authentication for Google Gemini API. | `AIzaSyB...` |
| `PUSHER_APP_ID` | Pusher Channels application ID. | `1819234` |
| `NEXT_PUBLIC_PUSHER_KEY` | Public key for client-side Pusher connection. | `a1b2c3d4` |
| `PUSHER_SECRET` | Private key for server-side event broadcasting. | `x9y8z7` |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | Datacenter region for Pusher. | `ap1` |

---

## 17. Setup and Installation Guide

Follow these steps to deploy the system in a local development environment.

**Step 1: Clone the Repository**
```bash
git clone https://github.com/yourusername/proctorshieldai.git
cd proctorshieldai
```

**Step 2: Install Dependencies**
```bash
npm install
```

**Step 3: Configure Environment**
Create a `.env` file in the root directory and populate it with the variables outlined in Section 16.

**Step 4: Database Migration & Seeding**
Push the Prisma schema to the PostgreSQL database and populate it with demo accounts.
```bash
npx prisma db push
npm run db:seed
```

**Step 5: Run Development Server**
```bash
npm run dev
```
Navigate to `http://localhost:3000` in a web browser.

---

## 18. Demo Accounts

The database seed script generates the following pre-configured accounts for testing purposes:

| Role | Email | Password |
| :--- | :--- | :--- |
| **Admin** | `admin@proctorshield.com` | `admin123` |
| **Teacher** | `cynth@proctorshield.com` | `password123` |
| **Student** | `christian@proctorshield.com` | `password123` |

---

## 19. Testing Strategy

*   **Unit Testing:** Core utilities like password hashing (`bcrypt`), JWT signing, and API response formatting were tested in isolation.
*   **Integration Testing:** End-to-end flows, such as creating an exam, joining via code, and submitting answers, were validated against the database.
*   **AI Detection Testing:** Evaluated by actively attempting to cheat (holding phones, hiding faces, adding people to the frame) to measure Gemini Vision's accuracy and prompt adherence.
*   **Browser Security Testing:** Verified by attempting standard bypass techniques (F12, PrintScreen, Alt-Tab) on Chrome, Edge, and Firefox.

---

## 20. Security Measures

1.  **Authentication Security:** Stateless JWTs eliminate server-side session hijacking vulnerabilities.
2.  **Cookie Security:** Tokens are stored with `HttpOnly` and `SameSite=Lax` attributes, immunizing the session against Cross-Site Scripting (XSS).
3.  **SQL Injection Prevention:** The use of Prisma ORM parametrizes all database queries automatically, preventing SQL injection.
4.  **Fail-Open AI Policy:** If the Gemini API fails or rate-limits, the system defaults to assuming no violations, preventing unfair student penalization due to network errors.

---

## 21. Known Limitations

As a thesis/capstone prototype, the system exhibits several accepted limitations:
1.  **AI Rate Limits (Cost):** Google Gemini free tier restricts usage to ~15 requests per minute. Consequently, AI analysis is restricted to 20-second intervals per student to prevent 429 Resource Exhausted errors.
2.  **Snapshot vs. Streaming:** Teachers view a grid of snapshots updating every 3 seconds rather than smooth 30fps video. Implementing true WebRTC was deemed out of scope due to STUN/TURN server requirements.
3.  **OS-Level Bypasses:** While JavaScript successfully blocks `PrintScreen`, it cannot block OS-level tools like the Windows Snipping Tool (Win+Shift+S) or hardware capture cards.
4.  **Ephemeral Memory Storage:** Server-side snapshots are stored in memory (`globalThis.Map`). If the Next.js process restarts, active snapshots are cleared (requiring a 3-second wait to regenerate).

---

## 22. Future Improvements

1.  **Redis Integration:** Migrating snapshot storage from in-memory maps to a Redis cache to ensure persistence across serverless edge functions.
2.  **WebRTC Video Streaming:** Upgrading the live monitor from 3-second snapshot polling to peer-to-peer WebRTC video streaming.
3.  **Audio Monitoring:** Integrating microphone analysis to detect whispering or background conversations.
4.  **Secure Browser App:** Packaging the frontend in an Electron application to enforce OS-level lockdown (kiosk mode), completely mitigating dual-monitor or external application cheating.

---

## 23. Conclusion

**ProctorShield AI** successfully demonstrates the integration of modern web technologies and advanced multimodal AI to create a robust, accessible online examination platform. By combining strict deterministic browser controls with probabilistic AI analysis, the system provides a comprehensive deterrent against academic dishonesty. The architectural shift to hybrid REST-polling and WebSocket broadcasting ensures stability at scale, making this project a viable blueprint for next-generation educational software.

---
