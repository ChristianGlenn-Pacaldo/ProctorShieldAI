interface StudentQuizAccessState {
  quizStatus: string | null | undefined;
  studentQuizStatus: string | null | undefined;
  startTime: Date | string | null | undefined;
  endTime?: Date | string | null | undefined;
}

export function canStudentEnterQuiz({
  quizStatus,
  studentQuizStatus,
  startTime,
  endTime,
}: StudentQuizAccessState): boolean {
  return (
    quizStatus === "in_progress" &&
    studentQuizStatus === "in_progress" &&
    Boolean(startTime) &&
    !endTime
  );
}

