/** Browser-safe contracts for the Teacher quiz library. No ORM or session imports. */
export interface TeacherQuizSummary {
  id: number;
  title: string;
  quizMode: string;
  quizStatus: string;
  duration: number;
  totalQuestions: number;
  accessCode?: string | null;
  subject?: { subjectName: string } | null;
  subjectName?: string;
  participantCount?: number;
  participantLimit?: number;
  allowRetake?: boolean;
}
export interface PendingQuizRequest {
  studentQuizId: string;
  studentName: string;
  quizTitle: string;
  quizId: number;
}
export type QuizRequestAction = "accept" | "reject";
