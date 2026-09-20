import { getSession } from "@/lib/auth";
import { getTeacherEntitlements } from "@/lib/teacher-entitlements";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import ArenaHostContent from "./content";
import { normalizeArenaConfig, normalizeMatchDuration } from "@/lib/arena";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ArenaHostPage({ params, searchParams }: PageProps) {
  const session = await getSession();
  if (!session || session.role !== "teacher") {
    redirect("/login");
  }

  // Verify Pro subscription
  const entitlements = await getTeacherEntitlements(session.userId);
  if (!entitlements.isSubscribed) {
    redirect("/dashboard/teacher/playground");
  }

  const { id } = await params;
  const quizId = parseInt(id, 10);
  if (isNaN(quizId)) {
    notFound();
  }

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      subject: true,
      questions: {
        include: {
          choices: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!quiz || quiz.teacherId !== session.userId) {
    notFound();
  }

  const sp = await searchParams;
  const rawDuration = typeof sp.duration === "string" ? sp.duration : undefined;
  const matchDuration = rawDuration ? normalizeMatchDuration(rawDuration) : 1800;
  const config = normalizeArenaConfig({
    mode: typeof sp.mode === "string" ? sp.mode : undefined,
    waveDuration: matchDuration === 3600 ? 3600 : 1800,
    enabledPowers: typeof sp.powers === "string" ? sp.powers.split(",") : undefined,
  });

  const sanitizedQuiz = {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description || "",
    accessCode: quiz.accessCode || `ARENA-${quiz.id}`,
    duration: matchDuration,
    passingScore: quiz.passingScore || 70,
    subjectName: quiz.subject?.subjectName || "General",
    subjectCode: quiz.subject?.subjectCode || "GEN",
    questions: quiz.questions.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      points: q.points || 1,
      choices: q.choices.map((c) => ({
        id: c.id,
        choiceText: c.choiceText,
        isCorrect: c.isCorrect,
      })),
    })),
  };

  return (
    <ArenaHostContent
      quiz={sanitizedQuiz}
      mode={config.mode}
      matchDuration={matchDuration}
      waveDuration={matchDuration}
      enabledPowers={config.enabledPowers}
      teacherId={session.userId}
    />
  );
}
