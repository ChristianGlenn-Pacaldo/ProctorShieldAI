import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasActiveProSubscription } from "@/lib/teacher-entitlements";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { arenaRealtime } from "@/lib/arena-realtime";
import {
  computeArenaRankings,
  createArenaState,
  ensureArenaPlayer,
  mutateArena,
  reconcileArenaAttacksInState,
  isArenaAction,
  normalizeArenaConfig,
  type ArenaState,
} from "@/lib/arena";
import { finalizeArena, recoverArenaFinalization } from "@/lib/arena-finalization";
import { isQuizAvailable, quizNotAvailableResponse } from "@/lib/quiz-availability";
interface RouteParams {
  params: Promise<{ id: string }>;
}
function parseQuizId(value: string) {
  const quizId = Number(value);
  return Number.isSafeInteger(quizId) && quizId > 0 ? quizId : null;
}
// Build JSON after commit so the body carries its committed Arena revision.
function jsonAfterCommit(body: unknown, init?: ResponseInit) {
  return () => NextResponse.json(body, init);
}
async function getAuthorizedQuiz(quizId: number, userId: string, role: string, db: Prisma.TransactionClient = prisma) {
  const quiz = await db.quiz.findUnique({
    where: { id: quizId },
    select: {
      id: true,
      teacherId: true,
      quizStatus: true,
      quizMode: true,
      questions: { select: { id: true }, orderBy: { id: "asc" } },
      _count: { select: { questions: true } },
    },
  });
  if (!quiz)
    return null;
  if (role === "teacher" && quiz.teacherId !== userId)
    return null;
  if (role === "student") {
    const enrolled = await db.studentQuiz.findFirst({
      where: {
        quizId,
        studentId: userId,
        ...(isQuizAvailable(quiz.quizStatus)
          ? { quizStatus: { notIn: ["rejected", "pending_approval"] } }
          : {}),
      },
      select: { id: true },
      orderBy: { attemptNumber: "desc" },
    });
    if (!enrolled)
      return null;
  }
  return quiz;
}
async function GETImpl(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session || !["teacher", "student", "admin"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const quizId = parseQuizId(id);
    if (!quizId)
      return NextResponse.json({ error: "Invalid quiz ID" }, { status: 400 });
    if (req.nextUrl?.searchParams.get("view") === "snapshot") {
      // Client reconciliation must never finalize, resolve attacks or award EXP.
      // One repeatable, read-only PostgreSQL snapshot also prevents mixed reset/
      // completion facts between the authorization, state and attempt reads.
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const quiz = await getAuthorizedQuiz(quizId, session.userId, session.role, tx);
        if (!quiz) return NextResponse.json({ error: "Quiz not found or unauthorized" }, { status: 404 });
        if (!isQuizAvailable(quiz.quizStatus)) return NextResponse.json(quizNotAvailableResponse(), { status: 410 });
        if (quiz.quizMode !== "arena") return NextResponse.json({ error: "Not an Arena quiz", code: "INVALID_QUIZ_MODE" }, { status: 409 });
        const record = await tx.setting.findUnique({ where: { settingKey: `arena:state:${quizId}` } });
        const state: ArenaState | null = record?.settingValue ? JSON.parse(record.settingValue) : null;
        const resultReady = !!state?.finalizedAt && state.status === "ended";
        const payout = state?.payouts?.find((p) => p.studentId === session.userId);
        const attempt = session.role === "student" && resultReady && payout
          ? await tx.studentQuiz.findFirst({ where: { quizId, studentId: session.userId, attemptMode: "arena" }, orderBy: { attemptNumber: "desc" } }) : null;
        const result = attempt?.quizStatus === "completed" && attempt.endTime && attempt.score !== null && payout
          ? { score: Number(attempt.score), rank: payout.rank, expEarned: payout.amount } : null;
        return NextResponse.json({ success: true, quizId, serverTime: Date.now(), arena: state,
          status: state?.status ?? "lobby", sessionId: state?.sessionId,
          participants: state?.participants ? computeArenaRankings(state.participants) : [],
          usedPowers: state?.usedPowers?.[session.userId] ?? {}, quizStatus: quiz.quizStatus, resultReady, result,
        }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
      }, { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 10_000 });
    }
    const reply = await mutateArena(quizId, async (mutation) => {
      const prisma = mutation.tx;
      const quiz = await getAuthorizedQuiz(quizId, session.userId, session.role, prisma);
      if (!quiz)
        return jsonAfterCommit({ error: "Quiz not found or unauthorized" }, { status: 404 });
      if (!isQuizAvailable(quiz.quizStatus)) {
        return jsonAfterCommit(quizNotAvailableResponse(), { status: 410 });
      }
      if (quiz.quizMode !== "arena") {
        return jsonAfterCommit({
          error: "This quiz is configured as a Proctored Exam. Only quizzes with quizMode 'arena' can be accessed in Power Arena.",
          code: "INVALID_QUIZ_MODE",
        }, { status: 409 });
      }
      const state = mutation.state;
      if (state)
        reconcileArenaAttacksInState(state, mutation.now);
      try {
        await recoverArenaFinalization(mutation, quiz.quizStatus);
        // Only return participants who explicitly joined the current Arena session (NO ghost participants)
        const rankedParticipants = state?.participants
          ? computeArenaRankings(state.participants)
          : [];
        return jsonAfterCommit({
          success: true,
          serverTime: Date.now(),
          arena: state,
          status: state?.status || "lobby",
          sessionId: state?.sessionId,
          participants: rankedParticipants,
          usedPowers: (state?.usedPowers && state.usedPowers[session.userId]) || {},
          quizStatus: state?.status === "ended" ? "ended" : quiz.quizStatus,
        }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
      }
      finally {
        mutation.state = state;
      }
    });
    return reply();
  }
  catch (error) {
    console.error("Get arena state error:", error);
    return NextResponse.json({ error: "Failed to load arena state" }, { status: 500 });
  }
}
async function POSTImpl(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session || !["teacher", "student", "admin"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const quizId = parseQuizId(id);
    if (!quizId)
      return NextResponse.json({ error: "Invalid quiz ID" }, { status: 400 });
    const body: unknown = await req.json().catch(() => null);
    const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
    if (!record || !isArenaAction(record.action)) {
      return NextResponse.json({ error: "Invalid arena action" }, { status: 400 });
    }
    const action = record.action;
    const payload = record.payload && typeof record.payload === "object"
      ? record.payload as Record<string, unknown>
      : {};
    const reply = await mutateArena(quizId, async (mutation) => {
      const prisma = mutation.tx;
      const realtime = arenaRealtime(mutation);
      const quiz = await getAuthorizedQuiz(quizId, session.userId, session.role, prisma);
      if (!quiz)
        return jsonAfterCommit({ error: "Quiz not found or unauthorized" }, { status: 404 });
      if (!isQuizAvailable(quiz.quizStatus)) {
        return jsonAfterCommit(quizNotAvailableResponse(), { status: 410 });
      }
      if (quiz.quizMode !== "arena") {
        return jsonAfterCommit({
          error: "This quiz is configured as a Proctored Exam. Only quizzes with quizMode 'arena' can be launched in Power Arena.",
          code: "INVALID_QUIZ_MODE",
        }, { status: 409 });
      }
      if (quiz._count.questions === 0) {
        return jsonAfterCommit({ error: "Add at least one question before launching an arena" }, { status: 409 });
      }
      let state = mutation.state;
      if (state && action !== "end")
        reconcileArenaAttacksInState(state, mutation.now);
      try {
        const actionId = typeof record.actionId === "string" ? record.actionId : undefined;
        const actionFingerprint = JSON.stringify({ action, payload, sessionId: record.sessionId ?? null });
        if (actionId && !/^[a-zA-Z0-9_-]{1,128}$/.test(actionId)) {
          return jsonAfterCommit({ error: "Invalid action identity" }, { status: 400 });
        }
        await recoverArenaFinalization(mutation, quiz.quizStatus);
        if (state?.status === "ended" && action !== "end") {
          return jsonAfterCommit({ error: "Arena match has already ended", code: "ARENA_ENDED" }, { status: 409 });
        }
        let payouts: Awaited<ReturnType<typeof finalizeArena>> = [];
        // ─────────────────────────────────────────────────────────────
        // ACTION: JOIN (Student explicitly joins current session lobby)
        // ─────────────────────────────────────────────────────────────
        if (action === "join") {
          if (typeof record.sessionId === "string" && state?.sessionId !== record.sessionId) {
            return jsonAfterCommit({ error: "Stale Arena session", code: "STALE_ARENA_SESSION" }, { status: 409 });
          }
          if (session.role !== "student") {
            return jsonAfterCommit({ error: "Only students can join an arena session" }, { status: 403 });
          }
          if (quiz.quizStatus === "ended" || state?.status === "ended") {
            return jsonAfterCommit({
              error: "This Power Arena quiz has already been completed. Create a new quiz to host another Arena match.",
              code: "ARENA_QUIZ_ALREADY_COMPLETED",
            }, { status: 409 });
          }
          // Initialize lobby arena state if none exists yet
          if (!state) {
            state = createArenaState({
              quizId,
              teacherId: quiz.teacherId,
              status: "lobby",
              totalQuestions: quiz.questions.length,
              config: normalizeArenaConfig(payload),
            });
          }
          if (!state.participants)
            state.participants = {};
          if (!state.usedPowers)
            state.usedPowers = {};
          const alreadyJoined = Boolean(state.participants[session.userId]);
          const participant = ensureArenaPlayer(state, {
            studentId: session.userId,
            studentName: session.fullName || "Student Fighter",
          });
          const rankedParticipants = computeArenaRankings(state.participants);
          // Only broadcast join if student was not already in current session
          if (!alreadyJoined) {
            try {
              await realtime.trigger(`private-arena-${quizId}`, "arena-student-joined", {
                studentId: session.userId,
                studentName: session.fullName,
                initials: participant.initials,
                participantsCount: Object.keys(state.participants).length,
              });
              await realtime.trigger(`private-teacher-${quiz.teacherId}`, "arena-student-joined", {
                studentId: session.userId,
                studentName: session.fullName,
                initials: participant.initials,
                participantsCount: Object.keys(state.participants).length,
              });
            }
            catch (pusherErr) {
              console.error("Pusher join broadcast error:", pusherErr);
            }
          }
          return jsonAfterCommit({
            success: true,
            message: "Joined arena session",
            sessionId: state.sessionId,
            status: state.status,
            participantsCount: Object.keys(state.participants).length,
            arena: state,
          });
        }
        // ─────────────────────────────────────────────────────────────
        // TEACHER-ONLY ACTIONS (start, end, airdrop, reset, wave)
        // ─────────────────────────────────────────────────────────────
        if (session.role !== "teacher") {
          return jsonAfterCommit({ error: "Unauthorized teacher action" }, { status: 403 });
        }
        if (!(await hasActiveProSubscription(session.userId, prisma))) {
          return jsonAfterCommit({ error: "Pro subscription required" }, { status: 403 });
        }
        if (actionId && state?.actionReceipts && Object.hasOwn(state.actionReceipts, actionId)) {
          if (state.actionReceipts[actionId] !== actionFingerprint)
            return jsonAfterCommit({ error: "Action identity conflict" }, { status: 409 });
          return jsonAfterCommit({ success: true, alreadyProcessed: true, action, arena: state, status: state.status, sessionId: state.sessionId });
        }
        if (typeof record.sessionId === "string" && state?.sessionId !== record.sessionId) {
          return jsonAfterCommit({ error: "Stale Arena session", code: "STALE_ARENA_SESSION" }, { status: 409 });
        }
        // Server-Side Reuse Block: Completed Arena Quizzes cannot be re-hosted or reset
        if ((quiz.quizStatus === "ended" || state?.status === "ended") && action !== "end") {
          return jsonAfterCommit({
            error: "This Power Arena quiz has already been completed. Create a new quiz to host another Arena match.",
            code: "ARENA_QUIZ_ALREADY_COMPLETED",
          }, { status: 409 });
        }
        if (action === "reset" || action === "create_session") {
          const freshSessionId = crypto.randomUUID();
          state = {
            sessionId: freshSessionId,
            quizId,
            teacherId: session.userId,
            status: "lobby",
            mode: "score_arena",
            matchDuration: 1800,
            matchEndsAt: null,
            enabledPowers: ["meteor", "earthquake", "blizzard", "shield"],
            totalQuestions: quiz.questions.length,
            startedAt: null,
            endedAt: null,
            participants: {},
            usedPowers: {},
            pendingAttacks: {},
            currentWave: 0,
            currentQuestionId: quiz.questions[0]?.id || 0,
            waveStartedAt: null,
            waveEndsAt: null,
          };
          await prisma.quiz.update({
            where: { id: quizId },
            data: { quizStatus: "active" },
          });
          try {
            await realtime.trigger(`private-arena-${quizId}`, "arena-session-created", {
              quizId,
              status: "lobby",
              sessionId: freshSessionId,
              timestamp: new Date().toISOString(),
            });
            await realtime.trigger(`private-arena-${quizId}`, "arena-reset", {
              quizId,
              status: "lobby",
              sessionId: freshSessionId,
              timestamp: new Date().toISOString(),
            });
          }
          catch (error) {
            console.error("Arena reset push failed:", error);
          }
          if (actionId)
            state.actionReceipts = { [actionId]: actionFingerprint };
          return jsonAfterCommit({
            success: true,
            message: "Fresh arena session created",
            sessionId: freshSessionId,
            status: "lobby",
            arena: state,
            participants: [],
          });
        }
        if (action === "start") {
          if (state?.status === "active") {
            return jsonAfterCommit({ success: true, action, arena: state, status: state.status, sessionId: state.sessionId, participants: computeArenaRankings(state.participants) });
          }
          if (!["draft", "active", "in_progress"].includes(quiz.quizStatus)) {
            return jsonAfterCommit({ error: "Quiz status cannot be started" }, { status: 409 });
          }
          const rawDuration = payload.matchDuration ?? payload.duration;
          const matchDuration = normalizeArenaConfig(payload).waveDuration === 0 ? 1800 : (typeof rawDuration === "number" || typeof rawDuration === "string"
            ? (Number(rawDuration) === 3600 || Number(rawDuration) === 60 ? 3600 : 1800)
            : 1800);
          const startedAt = new Date();
          {
            const tx = prisma;
            await tx.quiz.updateMany({
              where: { id: quizId, quizStatus: { in: ["draft", "active"] } },
              data: { quizStatus: "in_progress" },
            });
            await tx.studentQuiz.updateMany({
              where: { quizId, quizStatus: { in: ["enrolled", "pending_approval"] } },
              data: { quizStatus: "in_progress", startTime: startedAt },
            });
          }
          // Preserve existing joined participants, reset scores and used powers for clean match start
          const currentParticipants = state?.participants ? { ...state.participants } : {};
          const newSessionId = state?.status === "ended" ? crypto.randomUUID() : (state?.sessionId || crypto.randomUUID());
          const startedAtStr = new Date().toISOString();
          const matchEndsAt = new Date(Date.now() + matchDuration * 1000).toISOString();
          state = {
            sessionId: newSessionId,
            quizId,
            teacherId: session.userId,
            status: "active",
            mode: "score_arena",
            matchDuration,
            matchEndsAt,
            enabledPowers: ["meteor", "earthquake", "blizzard", "shield"],
            totalQuestions: quiz.questions.length,
            startedAt: startedAtStr,
            endedAt: null,
            participants: currentParticipants,
            usedPowers: {},
            pendingAttacks: {},
            currentWave: 0,
            currentQuestionId: quiz.questions[0]?.id || 0,
            waveStartedAt: startedAtStr,
            waveEndsAt: matchEndsAt,
          };
          // Reset match progress for genuine joined participants
          for (const p of Object.values(state.participants)) {
            p.score = 0;
            p.questionsAnswered = 0;
            p.isFinished = false;
            p.hasShield = false;
            p.totalQuestions = quiz.questions.length;
          }
          computeArenaRankings(state.participants);
        }
        else {
          if (!state || state.teacherId !== session.userId) {
            return jsonAfterCommit({ error: "No active arena session exists for this quiz" }, { status: 409 });
          }
          const isEndRetry = action === "end" && state.status === "ended";
          if (state.status !== "active" && !isEndRetry) {
            return jsonAfterCommit({ error: "No active arena session exists for this quiz" }, { status: 409 });
          }
          if (action === "wave") {
            const waveIndex = Number(payload.waveIndex);
            if (Number.isInteger(waveIndex) && waveIndex >= 0 && waveIndex < quiz.questions.length) {
              state.currentWave = waveIndex;
              state.currentQuestionId = quiz.questions[waveIndex].id;
            }
          }
          else if (action === "end") {
            mutation.state = state;
            payouts = await finalizeArena(mutation);
          }
          else if (action === "airdrop") {
            if (state.participants) {
              for (const p of Object.values(state.participants)) {
                p.hasShield = true;
                p.score += 50;
              }
              computeArenaRankings(state.participants);
            }
          }
        }
        if (actionId) {
          state.actionReceipts = { ...state.actionReceipts, [actionId]: actionFingerprint };
        }
        const rankedParticipants = computeArenaRankings(state.participants || {});
        const event = `arena-${action}`;
        const eventData = {
          quizId,
          arena: state,
          sessionId: state.sessionId,
          status: state.status,
          mode: state.mode,
          matchDuration: state.matchDuration,
          matchEndsAt: state.matchEndsAt,
          waveDuration: state.matchDuration,
          enabledPowers: state.enabledPowers,
          totalQuestions: state.totalQuestions,
          participants: rankedParticipants,
          sender: session.fullName,
          teacherId: session.userId,
          timestamp: new Date().toISOString(),
          payouts: payouts.map((payout) => ({
            studentId: payout.studentId,
            rank: payout.rank,
            amount: payout.amount,
          })),
        };
        if (action !== "end") await realtime.trigger(`private-arena-${quizId}`, event, eventData);
        return jsonAfterCommit({
          success: true,
          action,
          arena: state,
          status: state.status,
          sessionId: state.sessionId,
          payouts: eventData.payouts,
          participants: rankedParticipants,
        });
      }
      finally {
        mutation.state = state;
      }
    });
    return reply();
  }
  catch (error) {
    console.error("Arena action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
export const POST = withBackupWriteGate(POSTImpl);
const gatedGET = withBackupWriteGate(GETImpl);
export const GET = (req: NextRequest, params: RouteParams) => req.nextUrl?.searchParams.get("view") === "snapshot"
  ? GETImpl(req, params) : gatedGET(req, params);
