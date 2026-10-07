export type SubmissionReason = "manual" | "all_questions_completed" | "timer_expired" | "violation_limit" | "teacher_ended";

export function remainingExamSeconds(deadline: number, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function allQuestionsAnswered(questions: { id: number }[], answers: Record<number, unknown>) {
  return questions.length > 0 && questions.every((question) => Number.isInteger(answers[question.id]));
}

export function canSubmitProctored(input: {
  reason: unknown; active: boolean; questionCount: number; answeredCount: number;
  remainingSeconds: number; violationCount: number; teacherEnded: boolean;
}) {
  if (!input.active || input.questionCount < 1) return false;
  switch (input.reason) {
    case "manual": return true;
    case "all_questions_completed": return input.answeredCount === input.questionCount;
    case "timer_expired": return Number.isFinite(input.remainingSeconds) && input.remainingSeconds <= 0;
    case "violation_limit": return input.violationCount >= 3;
    case "teacher_ended": return input.teacherEnded;
    default: return false;
  }
}

export function isCurrentTeacherEnd(event: { quizId?: unknown; quizStatus?: unknown; timestamp?: unknown }, quizId: string, startedAt: number) {
  const occurredAt = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : NaN;
  return Number(event.quizId) === Number(quizId) && event.quizStatus === "ended"
    && Number.isFinite(occurredAt) && occurredAt >= startedAt;
}

export function resumeProctoredMedia(
  stream: { getVideoTracks(): { readyState: string }[]; getTracks(): { stop(): void }[] } | null,
  video: { paused: boolean; play(): Promise<void> } | null,
) {
  if (stream && !stream.getVideoTracks().some((track) => track.readyState === "live")) {
    stream.getTracks().forEach((track) => track.stop());
    return true; // Recreate the media/detector effect, reusing cached models.
  }
  if (stream && video?.paused) void video.play().catch(() => {});
  return false;
}

// Convert a server-owned deadline to a monotonic local countdown. Changing the
// device's wall clock cannot extend it. Server checks still decide expiry.
export function examCountdownDeadline(clock: { remainingSeconds: number; sessionEndsAt?: string; serverTime?: number }, requestStartedAt: number, responseReceivedAt: number) {
  const exactRemaining = typeof clock.sessionEndsAt === "string" && typeof clock.serverTime === "number"
    ? Date.parse(clock.sessionEndsAt) - clock.serverTime : clock.remainingSeconds * 1000;
  const remaining = Math.min(clock.remainingSeconds * 1000, Number.isFinite(exactRemaining) ? exactRemaining : 0);
  const transit = Math.max(0, responseReceivedAt - requestStartedAt) / 2;
  return responseReceivedAt + Math.max(0, remaining - transit);
}
