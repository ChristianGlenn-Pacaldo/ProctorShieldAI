import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { readArenaQuestionWork } from "@/lib/arena-question-work";
import { getAttemptQuestionOrder } from "@/lib/quiz-question-order";
import { ArenaContent } from "./content";
import { isQuizAvailable } from "@/lib/quiz-availability";

interface ArenaPageProps {
  params: Promise<{ id: string }>;
}

export default async function ArenaPage({ params }: ArenaPageProps) {
  const { id } = await params;
  const quizId = parseInt(id, 10);
  if (!Number.isInteger(quizId) || quizId <= 0) {
    notFound();
  }

  const session = await getSession("student");
  if (!session || session.role !== "student") {
    redirect(`/login/student?redirect=/arena/${quizId}`);
  }

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      subject: true,
      questions: {
        orderBy: { id: "asc" },
        include: {
          choices: {
            orderBy: { id: "asc" },
            select: {
              id: true,
              choiceText: true,
            },
          },
        },
      },
    },
  });

  if (!quiz || !isQuizAvailable(quiz.quizStatus)) {
    notFound();
  }

  // ARENA ROUTE GUARD:
  // If quiz is not configured with quizMode "arena", do NOT render the Arena UI.
  // Redirect safely to standard quiz runner. Never mutate quizMode automatically.
  if (quiz.quizMode !== "arena") {
    redirect(`/quiz/${quizId}`);
  }

  // Verify student enrollment in this quiz
  const studentQuiz = await prisma.studentQuiz.findFirst({
    where: {
      quizId,
      studentId: session.userId,
    },
    orderBy: { attemptNumber: "desc" },
  });

  if (!studentQuiz) {
    redirect(`/join?code=${quiz.accessCode}`);
  }

  // Load existing answers locked by server for this attempt
  const existingAnswers = await prisma.answer.findMany({
    where: { studentQuizId: studentQuiz.id, isCorrect: { not: null } },
    select: { questionId: true, answerText: true, isCorrect: true },
  });

  const arenaRecord = await prisma.setting.findUnique({ where: { settingKey: `arena:state:${quizId}` } });
  const arena = arenaRecord?.settingValue ? JSON.parse(arenaRecord.settingValue) : null;
  const initialQuestionWork = (await readArenaQuestionWork(prisma, studentQuiz.id, arena?.sessionId ?? "", quiz.questions,
    quiz.quizStatus === "ended" || studentQuiz.quizStatus === "completed", { matchEndsAt: arena?.matchEndsAt })).work;
  return (
    <ArenaContent
      initialQuestionWork={initialQuestionWork}
      quizId={quiz.id}
      quizTitle={quiz.title}
      subjectName={quiz.subject.subjectName}
      teacherId={quiz.teacherId}
      questions={getAttemptQuestionOrder(quiz.questions, studentQuiz.id).map((q) => ({
        id: q.id,
        questionText: q.questionText,
        points: q.points,
        choices: [...q.choices].sort((a, b) => a.id - b.id),
      }))}
      studentId={session.userId}
      studentName={session.fullName || "Student"}
      studentQuizId={studentQuiz.id}
      initialQuizStatus={quiz.quizStatus}
      initialStudentStatus={studentQuiz.quizStatus || "enrolled"}
      savedAnswers={existingAnswers.flatMap((a) => {
        const choiceId = Number(a.answerText);
        return Number.isInteger(choiceId)
          ? [{ questionId: a.questionId, choiceId, isCorrect: Boolean(a.isCorrect) }]
          : [];
      })}
    />
  );
}
