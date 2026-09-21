import { getSession } from "@/lib/auth";
import { getTeacherEntitlements } from "@/lib/teacher-entitlements";
import prisma from "@/lib/prisma";
import PlaygroundContent from "./content";
import { redirect } from "next/navigation";

export default async function TeacherPlaygroundPage() {
  const session = await getSession();

  if (!session || session.role !== "teacher") {
    redirect("/login/teacher");
  }

  const entitlements = await getTeacherEntitlements(session.userId);

  // Only persisted Arena quizzes can be launched from Playground.
  const rawQuizzes = await prisma.quiz.findMany({
    where: {
      teacherId: session.userId,
      quizMode: "arena",
      quizStatus: { not: "ended" },
    },
    include: {
      subject: { select: { subjectName: true, subjectCode: true } },
      _count: { select: { questions: true, studentQuizzes: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const quizzes = rawQuizzes.map((q) => ({
    id: q.id,
    title: q.title,
    description: q.description || "",
    accessCode: q.accessCode || "",
    quizType: q.quizType || "standard",
    quizMode: "arena" as const,
    quizStatus: q.quizStatus,
    duration: q.duration || 10,
    passingScore: q.passingScore || 70,
    subjectName: q.subject?.subjectName || "General",
    subjectCode: q.subject?.subjectCode || "GEN",
    questionsCount: q._count.questions,
    attemptsCount: q._count.studentQuizzes,
    createdAt: q.createdAt.toISOString(),
  }));

  return (
    <PlaygroundContent
      isSubscribed={entitlements.isSubscribed}
      planName={entitlements.planName}
      teacherId={session.userId}
      teacherName={session.fullName}
      quizzes={quizzes}
    />
  );
}
