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

async function awardArenaBounty(state: ArenaState) {
  const completed = await prisma.studentQuiz.findMany({
    where: {
      quizId: state.quizId,
      quizStatus: "completed",
      endTime: { not: null },
      score: { not: null },
      aiVerdict: { not: "cheated" },
    },
    select: { id: true, studentId: true, score: true, endTime: true },
    orderBy: [{ score: "desc" }, { endTime: "asc" }],
  });
  const seen = new Set<string>();
  const podium = completed.filter((attempt) => {
    if (seen.has(attempt.studentId)) return false;
    seen.add(attempt.studentId);
    return true;
  }).slice(0, 3);
  const multipliers = [1, 0.6, 0.4];
  const awards = podium.map((attempt, index) => ({
    ...attempt,
    rank: index + 1,
    amount: Math.round(state.coinBounty * multipliers[index]),
  }));
  if (awards.length === 0) return [];

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arena-bounty:${state.sessionId}`}))`;
    const created = await tx.studentCoinLedger.createMany({
      data: awards.map((award) => ({
        studentId: award.studentId,
        sourceType: "arena-bounty",
        sourceId: state.sessionId,
        amount: award.amount,
        metadata: { quizId: state.quizId, rank: award.rank, studentQuizId: award.id },
      })),
      skipDuplicates: true,
    });
    if (created.count === 0) return awards;
    if (created.count !== awards.length) throw new Error("Partial arena bounty ledger state detected");

    for (const award of awards) {
      await ensureStudentGameProfile(tx, award.studentId);
      await tx.studentGameProfile.update({
        where: { studentId: award.studentId },
        data: {
          coins: { increment: award.amount },
          topOneWins: award.rank === 1 ? { increment: 1 } : undefined,
        },
      });
      await tx.notification.create({
        data: {
          userId: award.studentId,
          title: award.rank === 1 ? "🏆 Arena Champion!" : `Arena Podium — Rank ${award.rank}`,
          message: `You earned +${award.amount} coins from the live arena podium.`,
        },
      });
    }
    return awards;
  });
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

    const attempts = await prisma.studentQuiz.findMany({
      where: { quizId, quizStatus: { not: "rejected" } },
      select: {
        studentId: true,
        attemptNumber: true,
        score: true,
        student: {
          select: {
            fullName: true,
            gameProfile: { select: { equippedAvatar: true } },
          },
        },
      },
      orderBy: { attemptNumber: "desc" },
    });
    const seen = new Set<string>();
    const enrolledStudents = attempts.flatMap((attempt) => {
      if (seen.has(attempt.studentId)) return [];
      seen.add(attempt.studentId);
      const avatarId = attempt.student.gameProfile?.equippedAvatar || "shield";
      return [{
        studentId: attempt.studentId,
        studentName: attempt.student.fullName,
        avatar: AVATAR_CATALOG.find((avatar) => avatar.id === avatarId)?.emoji || "🎓",
        score: attempt.score || 0,
      }];
    });

    if (quiz.quizStatus === "ended") {
      if (state) {
        state = { ...state, status: "ended", endedAt: state.endedAt || new Date().toISOString() };
      }
    }

    if (state) {
      if (!state.participants) state.participants = {};
      if (!state.usedPowers) state.usedPowers = {};
      for (const p of enrolledStudents) {
        ensureArenaPlayer(state, p);
      }
      await setArenaState(state);
    }

    const rankedParticipants = state ? computeArenaRankings(state.participants) : enrolledStudents.map((s, i) => ({
      ...s,
      rank: i + 1,
      questionsAnswered: 0,
      totalQuestions: quiz._count.questions,
      isFinished: false,
    }));

    return NextResponse.json({
      success: true,
      arena: state,
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
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasActiveProSubscription(session.userId))) {
      return NextResponse.json({ error: "Pro subscription required" }, { status: 403 });
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
    let payouts: Awaited<ReturnType<typeof awardArenaBounty>> = [];

    if (action === "reset") {
      await clearArenaState(quizId);
      try {
        await pusherServer.trigger(`private-arena-${quizId}`, "arena-end", {
          quizId,
          reset: true,
        });
      } catch (error) {
        console.error("Arena reset push failed:", error);
      }
      return NextResponse.json({ success: true, message: "Arena state reset" });
    }

    if (action === "start") {
      if (quiz.quizStatus === "ended") {
        return NextResponse.json(
          { error: "This quiz has ended and cannot be started" },
          { status: 409 },
        );
      }
      if (!["draft", "active", "in_progress"].includes(quiz.quizStatus)) {
        return NextResponse.json(
          { error: "Quiz cannot be started in its current status" },
          { status: 409 },
        );
      }
      if (state?.status === "active" && state.teacherId !== session.userId) {
        return NextResponse.json({ error: "This quiz already has an active arena host" }, { status: 409 });
      }
      if (["draft", "active"].includes(quiz.quizStatus)) {
        const startedAt = new Date();
        const started = await prisma.$transaction(async (tx) => {
          const claimed = await tx.quiz.updateMany({
            where: { id: quizId, teacherId: session.userId, quizStatus: { in: ["draft", "active"] } },
            data: { quizStatus: "in_progress" },
          });
          if (claimed.count !== 1) return false;
          await tx.studentQuiz.updateMany({
            where: { quizId, quizStatus: { in: ["enrolled", "pending_approval"] } },
            data: { quizStatus: "in_progress", startTime: startedAt },
          });
          return true;
        });
        if (!started) {
          return NextResponse.json({ error: "Quiz was already started or changed" }, { status: 409 });
        }
      } else if (quiz.quizStatus === "in_progress") {
        await prisma.studentQuiz.updateMany({
          where: { quizId, quizStatus: { in: ["enrolled", "pending_approval"] } },
          data: { quizStatus: "in_progress", startTime: new Date() },
        });
      }
      // Retrying a start after a saved-state/broadcast failure must reuse the
      // same session instead of resetting every connected student's arena.
      if (!state || state.status !== "active") {
        state = createArenaState({
          quizId,
          teacherId: session.userId,
          totalQuestions: quiz.questions.length,
          currentQuestionId: quiz.questions[0].id,
          config: normalizeArenaConfig(payload),
        });
      }

      state.participants = state.participants || {};
      state.usedPowers = state.usedPowers || {};

      // Initialize all enrolled students in state.participants
      const enrolled = await prisma.studentQuiz.findMany({
        where: { quizId, quizStatus: { not: "rejected" } },
        select: {
          studentId: true,
          score: true,
          student: { select: { fullName: true, gameProfile: { select: { equippedAvatar: true } } } },
        },
      });
      for (const e of enrolled) {
        const avatarId = e.student.gameProfile?.equippedAvatar || "shield";
        ensureArenaPlayer(state, {
          studentId: e.studentId,
          studentName: e.student.fullName,
          avatar: AVATAR_CATALOG.find((a) => a.id === avatarId)?.emoji || "🎓",
        });
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
        // Backwards compatibility for legacy wave calls if any
        const waveIndex = Number(payload.waveIndex);
        if (Number.isInteger(waveIndex) && waveIndex >= 0 && waveIndex < quiz.questions.length) {
          state.currentWave = waveIndex;
          state.currentQuestionId = quiz.questions[waveIndex].id;
        }
      } else if (action === "end") {
        // Sync final participant scores to studentQuiz attempts before awarding bounty
        if (state.participants) {
          for (const p of Object.values(state.participants)) {
            await prisma.studentQuiz.updateMany({
              where: { quizId, studentId: p.studentId },
              data: { score: p.score },
            }).catch(() => {});
          }
        }
        payouts = await awardArenaBounty(state);
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
        // Airdrop in score-based arena: gives all participants +50 bonus score and a Guardian Shield!
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

    return NextResponse.json({ success: true, action, arena: state, payouts: eventData.payouts, participants: rankedParticipants });
  } catch (error) {
    console.error("Arena action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
