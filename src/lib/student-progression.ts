import prisma from "./prisma.ts";
import type { Prisma, PrismaClient } from "@prisma/client";

export const EXP_REWARDS = {
  XP_PER_LEVEL: 500,
  PROCTORED_COMPLETION: 100,
  ARENA_PARTICIPATION: 100,
  ARENA_RANK_1: 100,
  ARENA_RANK_2: 60,
  ARENA_RANK_3: 40,
} as const;

export const XP_PER_LEVEL = EXP_REWARDS.XP_PER_LEVEL;
export const EXP_PER_LEVEL = EXP_REWARDS.XP_PER_LEVEL;

export interface StudentProgression {
  studentId: string;
  totalExp: number;
  level: number;
  currentLevelExp: number;
  expToNextLevel: number;
  progressPercent: number;
  title: string;
}

export const PROGRESSION_TITLES = [
  "Novice Cadet",
  "Quiz Runner",
  "Focus Adept",
  "Shield Scholar",
  "Grand Sentinel",
  "Legendary Proctor",
];

/**
 * Deterministic EXP -> Level calculation.
 * Central single source of truth across UI and APIs.
 */
export function deriveLevelFromTotalExp(totalExp: number): {
  level: number;
  currentLevelExp: number;
  expToNextLevel: number;
  progressPercent: number;
  title: string;
} {
  const safeExp = Math.max(0, Math.floor(totalExp || 0));
  const level = Math.max(1, Math.floor(safeExp / EXP_PER_LEVEL) + 1);
  const currentLevelExp = safeExp % EXP_PER_LEVEL;
  const expToNextLevel = EXP_PER_LEVEL - currentLevelExp;
  const progressPercent = Math.min(100, Math.round((currentLevelExp / EXP_PER_LEVEL) * 100));
  const title = PROGRESSION_TITLES[Math.min(PROGRESSION_TITLES.length - 1, level - 1)];

  return {
    level,
    currentLevelExp,
    expToNextLevel,
    progressPercent,
    title,
  };
}

function progressionKey(studentId: string): string {
  return `student:progression:${studentId}`;
}

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Authoritative PostgreSQL-backed progression lookup.
 * Automatically bootstraps from completed quiz history if no progression entry exists yet.
 * Protected against race conditions using advisory transaction locks so initialization occurs only once.
 */
export async function getStudentProgression(
  studentId: string,
  client: DbClient = prisma
): Promise<StudentProgression> {
  const key = progressionKey(studentId);

  // Fast-path read without lock
  try {
    const record = await client.setting.findUnique({
      where: { settingKey: key },
    });

    if (record?.settingValue) {
      const parsed = JSON.parse(record.settingValue) as { totalExp?: number };
      const totalExp = typeof parsed.totalExp === "number" ? parsed.totalExp : 0;
      const derived = deriveLevelFromTotalExp(totalExp);
      return {
        studentId,
        totalExp,
        ...derived,
      };
    }
  } catch (err) {
    console.error(`Error reading progression for student ${studentId}:`, err);
  }

  // Idempotent one-time bootstrap protected by transaction / advisory lock
  const runBootstrap = async (tx: DbClient): Promise<number> => {
    // Re-check under lock / inside transaction
    const existing = await tx.setting.findUnique({
      where: { settingKey: key },
    });
    if (existing?.settingValue) {
      const parsed = JSON.parse(existing.settingValue) as { totalExp?: number };
      return typeof parsed.totalExp === "number" ? parsed.totalExp : 0;
    }

    // Calculate baseline from existing completed quizzes
    let baselineExp = 0;
    try {
      const completed = await tx.studentQuiz.findMany({
        where: { studentId, quizStatus: "completed" },
        select: { score: true },
      });
      const count = completed.length;
      const totalScore = completed.reduce((sum, q) => sum + (Number(q.score) || 0), 0);
      const avgScore = count > 0 ? Math.round(totalScore / count) : 0;
      baselineExp = count * 180 + Math.round(avgScore * 4);

      await tx.setting.upsert({
        where: { settingKey: key },
        update: {
          settingValue: JSON.stringify({
            studentId,
            totalExp: baselineExp,
            initializedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        },
        create: {
          settingKey: key,
          settingValue: JSON.stringify({
            studentId,
            totalExp: baselineExp,
            initializedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        },
      });
    } catch (err) {
      console.error(`Error bootstrapping progression for student ${studentId}:`, err);
    }

    return baselineExp;
  };

  let totalExp = 0;
  if ("$transaction" in client && typeof (client as PrismaClient).$transaction === "function") {
    try {
      totalExp = await (client as PrismaClient).$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`student-progression:${studentId}`}))`;
        return runBootstrap(tx);
      });
    } catch {
      totalExp = await runBootstrap(client);
    }
  } else {
    totalExp = await runBootstrap(client);
  }

  const derived = deriveLevelFromTotalExp(totalExp);
  return {
    studentId,
    totalExp,
    ...derived,
  };
}

/**
 * Authoritative PostgreSQL-backed EXP reward.
 * Persists immediately and deterministically recalculates level.
 * Protected by advisory transaction locks.
 */
export async function awardStudentExp(
  studentId: string,
  amount: number,
  reason: string,
  client: DbClient = prisma
): Promise<StudentProgression & { expAwarded: number; reason: string }> {
  const safeAmount = Math.max(0, Math.floor(amount || 0));
  const key = progressionKey(studentId);

  const runAward = async (tx: DbClient) => {
    const current = await getStudentProgression(studentId, tx);
    const newTotalExp = current.totalExp + safeAmount;

    await tx.setting.upsert({
      where: { settingKey: key },
      update: {
        settingValue: JSON.stringify({
          studentId,
          totalExp: newTotalExp,
          updatedAt: new Date().toISOString(),
          lastAward: { amount: safeAmount, reason, at: new Date().toISOString() },
        }),
      },
      create: {
        settingKey: key,
        settingValue: JSON.stringify({
          studentId,
          totalExp: newTotalExp,
          initializedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastAward: { amount: safeAmount, reason, at: new Date().toISOString() },
        }),
      },
    });

    const derived = deriveLevelFromTotalExp(newTotalExp);
    return {
      studentId,
      totalExp: newTotalExp,
      ...derived,
      expAwarded: safeAmount,
      reason,
    };
  };

  if ("$transaction" in client && typeof (client as PrismaClient).$transaction === "function") {
    return (client as PrismaClient).$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`student-progression:${studentId}`}))`;
      return runAward(tx);
    });
  }

  return runAward(client);
}

export function arenaExpRewardedKey(sessionId: string, studentId: string): string {
  return `arena:exp_rewarded:${sessionId}:${studentId}`;
}

export async function isArenaExpAlreadyAwarded(
  sessionId: string,
  studentId: string,
  client: DbClient = prisma
): Promise<boolean> {
  const key = arenaExpRewardedKey(sessionId, studentId);
  const found = await client.setting.findUnique({
    where: { settingKey: key },
  });
  return Boolean(found);
}

export async function markArenaExpAwarded(
  sessionId: string,
  studentId: string,
  expAwarded: number,
  client: DbClient = prisma
): Promise<void> {
  const key = arenaExpRewardedKey(sessionId, studentId);
  await client.setting.upsert({
    where: { settingKey: key },
    update: {
      settingValue: JSON.stringify({
        sessionId,
        studentId,
        expAwarded,
        rewardedAt: new Date().toISOString(),
      }),
    },
    create: {
      settingKey: key,
      settingValue: JSON.stringify({
        sessionId,
        studentId,
        expAwarded,
        rewardedAt: new Date().toISOString(),
      }),
    },
  });
}

