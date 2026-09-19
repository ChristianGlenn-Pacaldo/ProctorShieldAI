export type SubmittedAnswer = { questionId: number; choiceId: number };

export type GradingQuestion = {
  id: number;
  points: number;
  questionType?: string | null;
  choices: Array<{ id: number; isCorrect: boolean }>;
};

export type Verdict = {
  cheatingProbability: number;
  riskLevel: "low" | "medium" | "high";
  finalVerdict: "clean" | "suspicious" | "cheated";
  aiExplanation: string;
};

export const INTEGRITY_INVALIDATION_THRESHOLD = 3;

export function isIntegrityInvalidated(violationCount: number): boolean {
  return Number.isInteger(violationCount) && violationCount >= INTEGRITY_INVALIDATION_THRESHOLD;
}

export function enforceIntegrityPolicy(verdict: Verdict, violationCount: number): Verdict {
  if (!isIntegrityInvalidated(violationCount)) return verdict;
  return {
    cheatingProbability: 100,
    riskLevel: "high",
    finalVerdict: "cheated",
    aiExplanation: `Result invalidated after ${violationCount} recorded integrity violations reached the three-strike limit.`,
  };
}

export function normalizeSubmittedAnswers(value: unknown): SubmittedAnswer[] {
  if (!Array.isArray(value)) return [];
  const byQuestion = new Map<number, SubmittedAnswer>();
  for (const answer of value) {
    if (
      typeof answer === "object"
      && answer !== null
      && Number.isInteger((answer as SubmittedAnswer).questionId)
      && Number.isInteger((answer as SubmittedAnswer).choiceId)
    ) {
      const submitted = answer as SubmittedAnswer;
      byQuestion.set(submitted.questionId, submitted);
    }
  }
  return Array.from(byQuestion.values());
}

export function mergeLockedAnswers(
  submittedAnswers: SubmittedAnswer[],
  lockedAnswers: SubmittedAnswer[],
) {
  const byQuestion = new Map(
    submittedAnswers.map((answer) => [answer.questionId, answer]),
  );
  for (const answer of lockedAnswers) {
    byQuestion.set(answer.questionId, answer);
  }
  return Array.from(byQuestion.values());
}

export function gradeSubmission(questions: GradingQuestion[], answers: SubmittedAnswer[]) {
  if (questions.length === 0) throw new Error("Quiz has no questions");
  const submittedByQuestion = new Map(answers.map((answer) => [answer.questionId, answer.choiceId]));
  let totalPoints = 0;
  let earnedPoints = 0;
  const records: Array<{
    questionId: number;
    answerText: string;
    isCorrect: boolean;
    pointsEarned: number;
  }> = [];

  for (const question of questions) {
    totalPoints += question.points;
    const selectedChoiceId = submittedByQuestion.get(question.id);
    if (selectedChoiceId === undefined) continue;
    const selectedChoice = question.choices.find((choice) => choice.id === selectedChoiceId);
    const wrongTextAnswer = question.questionType === "fill_in_blank" && selectedChoiceId === 0;
    if (!selectedChoice && !wrongTextAnswer) continue;
    const isCorrect = selectedChoice?.isCorrect ?? false;
    const pointsEarned = isCorrect ? question.points : 0;
    earnedPoints += pointsEarned;
    records.push({
      questionId: question.id,
      answerText: String(selectedChoice?.id ?? 0),
      isCorrect,
      pointsEarned,
    });
  }

  return {
    score: totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0,
    records,
  };
}

export function fallbackVerdict(violationCount: number): Verdict {
  if (violationCount === 0) {
    return {
      cheatingProbability: 0,
      riskLevel: "low",
      finalVerdict: "clean",
      aiExplanation: "No anomalies were recorded during the quiz session.",
    };
  }
  if (violationCount === 1) {
    return {
      cheatingProbability: 45,
      riskLevel: "medium",
      finalVerdict: "suspicious",
      aiExplanation: "One proctoring anomaly was recorded. The instructor should review the evidence.",
    };
  }
  return {
    cheatingProbability: violationCount === 2 ? 85 : 100,
    riskLevel: "high",
    finalVerdict: "cheated",
    aiExplanation: `Multiple integrity violations (${violationCount}) were recorded during the quiz session.`,
  };
}

export function parseVerdict(value: unknown, fallback: Verdict): Verdict {
  if (typeof value !== "object" || value === null) return fallback;
  const candidate = value as Record<string, unknown>;
  const probability = Number(candidate.cheatingProbability);
  const explanation = typeof candidate.aiExplanation === "string"
    ? candidate.aiExplanation.trim().slice(0, 1_000)
    : "";
  if (
    !Number.isFinite(probability)
    || probability < 0
    || probability > 100
    || !["low", "medium", "high"].includes(String(candidate.riskLevel))
    || !["clean", "suspicious", "cheated"].includes(String(candidate.finalVerdict))
    || !explanation
  ) {
    return fallback;
  }
  return {
    cheatingProbability: Math.round(probability),
    riskLevel: candidate.riskLevel as Verdict["riskLevel"],
    finalVerdict: candidate.finalVerdict as Verdict["finalVerdict"],
    aiExplanation: explanation,
  };
}
