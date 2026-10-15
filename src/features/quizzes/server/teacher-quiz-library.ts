import "server-only";
import type { Prisma } from "@prisma/client";
import type { TeacherEntitlementSummary } from "@/lib/subscription-rules";
import { UNAVAILABLE_QUIZ_STATUSES } from "@/lib/quiz-availability";

export interface TeacherQuizLibraryDependencies {
  prisma: Pick<Prisma.TransactionClient, "quiz" | "studentQuiz">;
  getTeacherEntitlements: (teacherId: string) => Promise<TeacherEntitlementSummary>;
  isPowerArenaEnabled: () => boolean;
  isDisabledArenaResource: typeof import("@/lib/power-arena-feature").isDisabledArenaResource;
}
/** Called only after the HTTP adapter verifies the Teacher session. No HTTP/cookie handling here. */
export async function getTeacherQuizLibrary(teacherId: string, dependencies: TeacherQuizLibraryDependencies) {
  const { prisma, getTeacherEntitlements, isPowerArenaEnabled, isDisabledArenaResource } = dependencies;
  const enabledQuizModes = !isPowerArenaEnabled() ? { quizMode: { not: "arena" } } : {};
  // Teachers get the quizzes they created
  const quizzes = await prisma.quiz.findMany({
    where: {
      teacherId,
      ...enabledQuizModes,
      quizStatus: { notIn: [...UNAVAILABLE_QUIZ_STATUSES] },
    },
    include: {
      subject: true,
      _count: { select: { studentQuizzes: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch pending retakes for this teacher
  const pendingRetakes = await prisma.studentQuiz.findMany({
    where: {
      quizStatus: "pending_retake",
      quiz: { teacherId, ...enabledQuizModes },
    },
    include: {
      student: { select: { fullName: true } },
      quiz: { select: { title: true } },
    },
  });

  // Fetch pending late-join approvals for this teacher
  const pendingApprovals = await prisma.studentQuiz.findMany({
    where: {
      quizStatus: "pending_approval",
      quiz: { teacherId, ...enabledQuizModes },
    },
    include: {
      student: { select: { fullName: true } },
      quiz: { select: { title: true } },
    },
  });

  const entitlements = await getTeacherEntitlements(teacherId);
  const distinctParticipants = await prisma.studentQuiz.findMany({
    where: { quizId: { in: quizzes.map((quiz) => quiz.id) } },
    select: { quizId: true, studentId: true },
    distinct: ["quizId", "studentId"],
  });
  const participantCounts = distinctParticipants.reduce((counts, enrollment) => {
    counts.set(enrollment.quizId, (counts.get(enrollment.quizId) ?? 0) + 1);
    return counts;
  }, new Map<number, number>());

  return {
    success: true,
    quizzes: quizzes.filter(row => !isDisabledArenaResource(row)).map((quiz) => ({
      ...quiz,
      participantCount: participantCounts.get(quiz.id) ?? 0,
      participantLimit: entitlements.studentLimitPerQuiz,
    })),
    entitlements,
    pendingRetakes: pendingRetakes.map((pr) => ({
      studentQuizId: pr.id,
      studentName: pr.student.fullName,
      quizTitle: pr.quiz.title,
      quizId: pr.quizId,
    })),
    pendingApprovals: pendingApprovals.map((pa) => ({
      studentQuizId: pa.id,
      studentName: pa.student.fullName,
      quizTitle: pa.quiz.title,
      quizId: pa.quizId,
    })),
  };

}
