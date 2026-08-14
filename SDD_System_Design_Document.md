# ProctorShield AI — System Design Document (SDD)

**Software Architecture, Data Design, Real-Time Subsystems & Security Specifications**

## 1. Executive Summary & Technology Stack

ProctorShield AI is a fullstack web platform for remote exam proctoring and integrity monitoring. Built on Next.js 16 (App Router), React 19, TypeScript, and TailwindCSS v4, the system combines real-time WebRTC P2P video streaming, client-side computer vision ML (@vladmandic/face-api, COCO-SSD), server-side Gemini 2.5 Flash AI, and Neon PostgreSQL via Prisma ORM.

## 2. System Architecture & Layer Diagram

The system follows a decoupled 5-tier architecture:
1. Client Interface Layer: Next.js 16 App Router UI with Figma-aligned dark proctoring workspace, 3D Head Direction Radar compass, and responsive dashboards.
2. WebRTC P2P & WebSocket Signaling Subsystem: Direct student-to-teacher 60 FPS HD video streaming backed by Pusher channels for signaling and notifications.
3. Client-Side AI Computer Vision Engine: @vladmandic/face-api 68-landmark 3D pitch/yaw head vector calculation, COCO-SSD cellphone detection, and Web Audio API RMS analyzer.
4. Server API & AI Verdict Subsystem: Next.js Route Handlers processing real-time violation logs, session authentication, email dispatches, and Gemini 2.5 Flash verdict generation.
5. Persistence Layer: Prisma ORM connected to Neon PostgreSQL hosted cloud database.

## 3. Real-Time Video Subsystem Specifications

The video monitoring system features a Dual-Engine Architecture:
- Engine A (WebRTC P2P 60 FPS HD): Direct RTCPeerConnection stream offering ultra-smooth 60 FPS video with zero server relay costs.
- Engine B (1.5s High-Frequency Snapshot Stream): Automatic HTTP snapshot fallback uploading camera frames every 1.5 seconds to /api/live/snapshot. Resolves single-browser multi-tab session testing and restricted firewalls.
- 5-Second WebM Video Evidence Recording: MediaRecorder API capturing 5-second video clips upon violation detection, viewable in HTML5 Evidence Replay.

## 4. Database Schema Specifications (Prisma ORM)



| Model Name | Primary Key | Description | Key Relations |
| --- | --- | --- | --- |
| User | id (UUID) | User accounts (Student/Teacher/Admin) | Role, StudentQuiz, Quiz |
| Role | id (Int) | RBAC Roles (admin, teacher, student) | User[] |
| Subject | id (Int) | Academic Subject Course | User (Teacher), Quiz[] |
| Quiz | id (Int) | Exam Configuration & Timer | Subject, User, Question[] |
| Question | id (Int) | Quiz Questions & Points | Quiz, Choice[], Answer[] |
| Choice | id (Int) | Multiple Choice Answers | Question |
| StudentQuiz | id (UUID) | Student Exam Session & Score | User, Quiz, Violation[] |
| Violation | id (BigInt) | Cheating Incident & Video Evidence | StudentQuiz, EvidenceFile[] |
| EvidenceFile | id (BigInt) | Uploaded Media Evidence Path | Violation |
| AiAnalysis | id (Int) | Gemini AI Verdict & Probability | StudentQuiz |
| Notification | id (BigInt) | User Alerts & Notifications | User |
| ActivityLog | id (BigInt) | Audit Trail & User Actions | User |

## 5. Security, Lockdown & Control Flow

Anti-Cheating Lockdown System:
- Fullscreen Lockdown: Automatic document.documentElement.requestFullscreen() on quiz start.
- Startup Grace Period: 5-second initial grace period (isStartupGracePeriodRef) preventing false window_resize violations during startup.
- Pre-Warning System: 2.5s–3s warning banner delay before logging official violation strikes for tab switching or fullscreen exit.
- 3-Strike Auto-Termination: Quiz auto-submits upon 3 strikes or severe cheating detection.
- Database Storage Management: DELETE /api/dashboard/teacher/evidence route allowing 1-click purging of violation evidence from Neon DB.
