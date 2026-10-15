import type { TeacherQuizSummary } from "../types.ts";
/** Pure display filtering. Server authorization and feature policy remain authoritative. */
export function filterTeacherQuizzes<T extends TeacherQuizSummary>(quizzes: T[], search: string, arenaEnabled: boolean): T[] {
  return quizzes.filter(quiz => arenaEnabled || quiz.quizMode !== "arena")
    .filter(quiz => quiz.title.toLowerCase().includes(search.toLowerCase()));
}
