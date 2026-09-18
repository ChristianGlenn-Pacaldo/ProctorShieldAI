import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasActiveProSubscription } from "@/lib/teacher-entitlements";
import prisma from "@/lib/prisma";
import { pusherServer } from "@/lib/pusher";
import {
  clearArenaState,
  computeArenaRankings,
  createArenaState,
  ensureArenaPlayer,
  getArenaState,
  isArenaAction,
  normalizeArenaConfig,
  setArenaState,
  type PlayerHealth,
} from "@/lib/arena";
import { AVATAR_CATALOG } from "@/lib/student-coins";
import { ensureStudentGameProfile } from "@/lib/student-game-profile";
import {
  awardStudentExp,
  EXP_REWARDS,
  isArenaExpAlreadyAwarded,
  markArenaExpAwarded,
} from "@/lib/student-progression";
import type { ArenaState } from "@/lib/arena";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseQuizId(value: string) {
  const quizId = Number(value);
  return Number.isSafeInteger(quizId) && quizId > 0 ? quizId : null;
}

async function getAuthorizedQuiz(quizId: number, userId: string, role: string) {
  const quiz = await prisma.quiz.findUnique({
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
  if (!quiz) return null;
  if (role === "teacher" && quiz.teacherId !== userId) return null;
  if (role === "student") {
    const enrolled = await prisma.studentQuiz.findFirst({
      where: { quizId, studentId: userId, quizStatus: { notIn: ["rejected", "pending_approval"] } },
      select: { id: true },
      orderBy: { attemptNumber: "desc" },
    });
    if (!enrolled) return null;
  }
  return quiz;
}

async function awardArenaExp(state: ArenaState) {
  if (!state.participants) return [];
  const ranked = computeArenaRankings(state.participants);
  const awards: Array<{ studentId: string; rank: number; amount: number }> = [];

  for (const p of ranked) {
    let exp = EXP_REWARDS.ARENA_PARTICIPATION;
    if (p.rank === 1) exp += EXP_REWARDS.ARENA_RANK_1;
    else if (p.rank === 2) exp += EXP_REWARDS.ARENA_RANK_2;
    else if (p.rank === 3) exp += EXP_REWARDS.ARENA_RANK_3;

    // Idempotency: ensure each student receives Arena final EXP at most once per sessionId
    const alreadyAwarded = await isArenaExpAlreadyAwarded(state.sessionId, p.studentId);
    if (!alreadyAwarded) {
      await awardStudentExp(p.studentId, exp, `Arena Match Completion (Rank #${p.rank})`).catch((err) => {
        console.error(`Failed to award Arena EXP to ${p.studentId}:`, err);
      });
      await markArenaExpAwarded(state.sessionId, p.studentId, exp).catch((err) => {
        console.error(`Failed to mark Arena EXP awarded to ${p.studentId}:`, err);
      });
    }

    awards.push({ studentId: p.studentId, rank: p.rank, amount: exp });
  }
  return awards;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session || !["teacher", "student", "admin"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const quizId = parseQuizId(id);
    if (!quizId) return NextResponse.json({ error: "Invalid quiz ID" }, { status: 400 });

    const quiz = await getAuthorizedQuiz(quizId, session.userId, session.role);
    if (!quiz) return NextResponse.json({ error: "Quiz not found or unauthorized" }, { status: 404 });
    if (quiz.quizMode !== "arena") {
      return NextResponse.json(
        {
          error: "This quiz is configured as a Proctored Exam. Only quizzes with quizMode 'arena' can be accessed in Power Arena.",
          code: "INVALID_QUIZ_MODE",
        },
        { status: 409 },
      );
    }

    let state = await getArenaState(quizId);

    // Authoritative check: If overall timer expired while active, transition to ended
    if (state?.status === "active" && state.matchEndsAt && Date.now() >= Date.parse(state.matchEndsAt)) {
      state = {
        ...state,
        status: "ended",
        endedAt: state.endedAt || new Date().toISOString(),
        pendingAttacks: {},
      };
      await setArenaState(state);
      await prisma.quiz.update({
        where: { id: quizId },
        data: { quizStatus: "ended" },
      }).catch(() => {});
      await prisma.studentQuiz.updateMany({
        where: { quizId, quizStatus: "in_progress" },
        data: { quizStatus: "completed", endTime: new Date() },
      }).catch(() => {});
    }

    if (quiz.quizStatus === "ended") {
      if (state && state.status !== "ended") {
        state = { ...state, status: "ended", endedAt: state.endedAt || new Date().toISOString() };
        await setArenaState(state);
      }
    }

    // Only return participants who explicitly joined the current Arena session (NO ghost participants)
    const rankedParticipants = state?.participants
      ? computeArenaRankings(state.participants)
      : [];

    return NextResponse.json({
      success: true,
      arena: state,
      status: state?.status || "lobby",
      sessionId: state?.sessionId,
      participants: rankedParticipants,
      usedPowers: (state?.usedPowers && state.usedPowers[session.userId]) || {},
      quizStatus: quiz.quizStatus,
    });
  } catch (error) {
    console.error("Get arena state error:", error);
    return NextResponse.json({ error: "Failed to load arena state" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session || !["teacher", "student", "admin"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const quizId = parseQuizId(id);
    if (!quizId) return NextResponse.json({ error: "Invalid quiz ID" }, { status: 400 });

    const quiz = await getAuthorizedQuiz(quizId, session.userId, session.role);
    if (!quiz) return NextResponse.json({ error: "Quiz not found or unauthorized" }, { status: 404 });
    if (quiz.quizMode !== "arena") {
      return NextResponse.json(
        {
          error: "This quiz is configured as a Proctored Exam. Only quizzes with quizMode 'arena' can be launched in Power Arena.",
          code: "INVALID_QUIZ_MODE",
        },
        { status: 409 },
      );
    }
    if (quiz._count.questions === 0) {
      return NextResponse.json({ error: "Add at least one question before launching an arena" }, { status: 409 });
    }

    const body: unknown = await req.json().catch(() => null);
    const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
    if (!record || !isArenaAction(record.action)) {
      return NextResponse.json({ error: "Invalid arena action" }, { status: 400 });
    }
    const action = record.action;
    const payload = record.payload && typeof record.payload === "object"
      ? record.payload as Record<string, unknown>
      : {};

    let state = await getArenaState(quizId);
    let payouts: Awaited<ReturnType<typeof awardArenaExp>> = [];

    // ─────────────────────────────────────────────────────────────
    // ACTION: JOIN (Student explicitly joins current session lobby)
    // ─────────────────────────────────────────────────────────────
    if (action === "join") {
      if (session.role !== "student") {
        return NextResponse.json({ error: "Only students can join an arena session" }, { status: 403 });
      }
      if (quiz.quizStatus === "ended" || state?.status === "ended") {
        return NextResponse.json(
          {
            error: "This Power Arena quiz has already been completed. Create a new quiz to host another Arena match.",
            code: "ARENA_QUIZ_ALREADY_COMPLETED",
          },
          { status: 409 },
        );
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

      if (!state.participants) state.participants = {};
      if (!state.usedPowers) state.usedPowers = {};

      const alreadyJoined = Boolean(state.participants[session.userId]);

      // Resolve equipped avatar from DB
      const userProfile = await prisma.studentGameProfile.findUnique({
        where: { studentId: session.userId },
        select: { equippedAvatar: true },
      });
      const avatarId = userProfile?.equippedAvatar || "shield";
      const catalogAvatar = AVATAR_CATALOG.find((a) => a.id === avatarId)?.emoji;
      const studentAvatar = catalogAvatar || (avatarId.length <= 4 ? avatarId : "🛡️");

      const participant = ensureArenaPlayer(state, {
        studentId: session.userId,
        studentName: session.fullName || "Student Fighter",
        avatar: studentAvatar,
      });

      await setArenaState(state);
      const rankedParticipants = computeArenaRankings(state.participants);

      // Only broadcast join if student was not already in current session
      if (!alreadyJoined) {
        const joinPayload = {
          quizId,
          sessionId: state.sessionId,
          studentId: session.userId,
          studentName: session.fullName,
          avatar: participant.avatar,
          participants: rankedParticipants,
          timestamp: new Date().toISOString(),
        };
        try {
          await pusherServer.trigger(`private-arena-${quizId}`, "arena-student-joined", {
            studentId: session.userId,
            studentName: session.fullName,
            avatar: studentAvatar,
            participantsCount: Object.keys(state.participants).length,
          });
          await pusherServer.trigger(`private-teacher-${quiz.teacherId}`, "arena-student-joined", {
            studentId: session.userId,
            studentName: session.fullName,
            avatar: studentAvatar,
            participantsCount: Object.keys(state.participants).length,
          });
        } catch (pusherErr) {
          console.error("Pusher join broadcast error:", pusherErr);
        }
      }

      return NextResponse.json({
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
      return NextResponse.json({ error: "Unauthorized teacher action" }, { status: 403 });
    }
    if (!(await hasActiveProSubscription(session.userId))) {
      return NextResponse.json({ error: "Pro subscription required" }, { status: 403 });
    }

    // Server-Side Reuse Block: Completed Arena Quizzes cannot be re-hosted or reset
    if (quiz.quizStatus === "ended" || (state?.status === "ended" && action !== "end")) {
      return NextResponse.json(
        {
          error: "This Power Arena quiz has already been completed. Create a new quiz to host another Arena match.",
          code: "ARENA_QUIZ_ALREADY_COMPLETED",
        },
        { status: 409 },
      );
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
        coinBounty: 0,
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
      await setArenaState(state);
      await prisma.quiz.update({
        where: { id: quizId },
        data: { quizStatus: "active" },
      }).catch(() => {});
      try {
        await pusherServer.trigger(`private-arena-${quizId}`, "arena-session-created", {
          quizId,
          status: "lobby",
          sessionId: freshSessionId,
          timestamp: new Date().toISOString(),
        });
        await pusherServer.trigger(`private-arena-${quizId}`, "arena-reset", {
          quizId,
          status: "lobby",
          sessionId: freshSessionId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Arena reset push failed:", error);
      }
      return NextResponse.json({
        success: true,
        message: "Fresh arena session created",
        sessionId: freshSessionId,
        status: "lobby",
        arena: state,
        participants: [],
      });
    }

    if (action === "start") {
      if (!["draft", "active", "in_progress"].includes(quiz.quizStatus)) {
        return NextResponse.json({ error: "Quiz status cannot be started" }, { status: 409 });
      }
      if (state?.status === "active" && state.teacherId !== session.userId) {
        return NextResponse.json({ error: "This quiz already has an active arena host" }, { status: 409 });
      }

      const rawDuration = payload.matchDuration ?? payload.duration;
      const matchDuration = normalizeArenaConfig(payload).waveDuration === 0 ? 1800 : (
        typeof rawDuration === "number" || typeof rawDuration === "string"
          ? (Number(rawDuration) === 3600 || Number(rawDuration) === 60 ? 3600 : 1800)
          : 1800
      );

      const startedAt = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.quiz.updateMany({
          where: { id: quizId, quizStatus: { in: ["draft", "active"] } },
          data: { quizStatus: "in_progress" },
        });
        await tx.studentQuiz.updateMany({
          where: { quizId, quizStatus: { in: ["enrolled", "pending_approval"] } },
          data: { quizStatus: "in_progress", startTime: startedAt },
        });
      });

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
        coinBounty: 0,
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
    } else {
      if (!state || state.teacherId !== session.userId) {
        return NextResponse.json({ error: "No active arena session exists for this quiz" }, { status: 409 });
      }
      const isEndRetry = action === "end" && state.status === "ended";
      if (state.status !== "active" && !isEndRetry) {
        return NextResponse.json({ error: "No active arena session exists for this quiz" }, { status: 409 });
      }
      if (action === "wave") {
        const waveIndex = Number(payload.waveIndex);
        if (Number.isInteger(waveIndex) && waveIndex >= 0 && waveIndex < quiz.questions.length) {
          state.currentWave = waveIndex;
          state.currentQuestionId = quiz.questions[waveIndex].id;
        }
      } else if (action === "end") {
        if (state.participants) {
          for (const p of Object.values(state.participants)) {
            await prisma.studentQuiz.updateMany({
              where: { quizId, studentId: p.studentId },
              data: { score: p.score },
            }).catch(() => {});
          }
        }
        payouts = await awardArenaExp(state);
        if (!isEndRetry) {
          state = {
            ...state,
            status: "ended",
            endedAt: new Date().toISOString(),
            pendingAttacks: {},
          };
          await prisma.quiz.update({
            where: { id: quizId },
            data: { quizStatus: "ended" },
          }).catch((err) => console.error("Failed to mark quiz ended:", err));
          await prisma.studentQuiz.updateMany({
            where: { quizId, quizStatus: "in_progress" },
            data: { quizStatus: "completed", endTime: new Date() },
          }).catch((err) => console.error("Failed to mark student quizzes completed:", err));
        }
      } else if (action === "airdrop") {
        if (state.participants) {
          for (const p of Object.values(state.participants)) {
            p.hasShield = true;
            p.score += 50;
          }
          computeArenaRankings(state.participants);
        }
      }
    }

    await setArenaState(state);
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
      coinBounty: state.coinBounty,
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

    try {
      await pusherServer.trigger(`private-arena-${quizId}`, event, eventData);
    } catch (error) {
      console.error("Arena realtime broadcast failed:", error);
      return NextResponse.json(
        { error: "Arena state was saved, but the real-time broadcast failed. Please retry." },
        { status: 503 },
      );
    }

    return NextResponse.json({
      success: true,
      action,
      arena: state,
      status: state.status,
      sessionId: state.sessionId,
      payouts: eventData.payouts,
      participants: rankedParticipants,
    });
  } catch (error) {
    console.error("Arena action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
