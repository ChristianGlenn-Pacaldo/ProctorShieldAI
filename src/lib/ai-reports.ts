import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getViolationLabel } from "@/lib/proctoring-detection";

export type ReportRole = "student" | "teacher";
export type ReportViolation = {
  id: string;
  studentQuizId: string;
  violationType: string | null;
  label: string;
  timestamp: string;
  confidenceScore: number | null;
  durationSeconds: number | null;
  evidence: {
    records: { id: string; fileType: string | null; uploadedAt: string }[];
    hasLegacyEvidence: boolean;
    metadataUnavailable: boolean;
    reviewUrl: string | null;
  };
};
export type AIReport = {
  id: string;
  attemptNumber: number;
  quizStatus: string | null;
  createdAt: string;
  startTime: string | null;
  endTime: string | null;
  isCompleted: boolean;
  score: number | null;
  integrityInvalidated: boolean;
  quiz: { id: number; title: string };
  student: { id: string; fullName: string } | null;
  violationCount: number;
  violations: ReportViolation[];
  aiVerdict: string | null;
  cheatingProbability: number | null;
  analysisCurrent: boolean;
  aiAnalysis: { totalViolations: number; aiExplanation: string | null; analyzedAt: string } | null;
};
export type AIReportsResponse = {
  success: true;
  reports: AIReport[];
  totalReports: number;
  totalViolations: number;
  page: number;
  pageSize: number;
  pageCount: number;
  types: { value: string; label: string }[];
  filters: { search: string; type: string };
};

export class InvalidReportQuery extends Error {}
const PAGE_SIZE = 20;
const UNTYPED_VALUE = "__untyped__";
const legacyLabels: Record<string, string> = {
  tab_switching: "App/tab switch or window minimized",
  phone_detected: "Unauthorized phone/device detected",
};
const label = (type: string | null) => type === null ? "Unspecified recorded event" : legacyLabels[type] || getViolationLabel(type);
const numeric = (value: unknown) => value == null ? null : Number(value);

const reportSelect = {
  id: true, attemptNumber: true, quizStatus: true, createdAt: true,
  startTime: true, endTime: true, score: true, aiVerdict: true, cheatingProbability: true,
  quiz: { select: { id: true, title: true } },
  student: { select: { id: true, fullName: true } },
  aiAnalysis: { select: { totalViolations: true, aiExplanation: true, analyzedAt: true } },
  violations: {
    select: { id: true, studentQuizId: true, violationType: true, timestamp: true, confidenceScore: true, durationSeconds: true, screenshotPath: true },
    orderBy: [{ timestamp: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.StudentQuizSelect;

export async function readAIReports(role: ReportRole, userId: string, url: string): Promise<AIReportsResponse> {
  const params = new URL(url).searchParams;
  const requestedPage = Number(params.get("page") ?? "1");
  const search = (params.get("search") ?? "").trim();
  const type = params.get("type") ?? "";
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || search.length > 120 || type.length > 80) {
    throw new InvalidReportQuery("Invalid report page or filter");
  }
  const scope: Prisma.StudentQuizWhereInput = role === "teacher" ? { quiz: { teacherId: userId } } : { studentId: userId };
  // Attempt mode is historical: a later quiz-mode edit must not hide its reports.
  // Unfinished attempts with real events are visible; empty unfinished attempts
  // are not presented as completed, clean reports.
  const baseWhere: Prisma.StudentQuizWhereInput = {
    ...scope,
    attemptMode: "proctored",
    OR: [
      { quizStatus: { in: ["completed", "pending_retake"] }, endTime: { not: null } },
      { violations: { some: {} } },
    ],
  };
  const filters: Prisma.StudentQuizWhereInput[] = [baseWhere];
  if (search) filters.push({ OR: [
    { quiz: { title: { contains: search, mode: "insensitive" } } },
    ...(role === "teacher" ? [{ student: { fullName: { contains: search, mode: "insensitive" as const } } }] : []),
  ] });
  if (type) filters.push({ violations: { some: { violationType: type === UNTYPED_VALUE ? null : type } } });
  const where: Prisma.StudentQuizWhereInput = { AND: filters };

  // Counts and pages use one database snapshot so a newly recorded event cannot
  // produce a timeline/count mismatch within the same response.
  const snapshot = await prisma.$transaction(async (tx) => {
    const totalReports = await tx.studentQuiz.count({ where });
    const totalViolations = await tx.violation.count({ where: { studentQuiz: where } });
    const pageCount = Math.max(1, Math.ceil(totalReports / PAGE_SIZE));
    const page = Math.min(requestedPage, pageCount);
    const reports = await tx.studentQuiz.findMany({
      where, select: reportSelect, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const types = await tx.violation.findMany({
      where: { studentQuiz: baseWhere }, select: { violationType: true },
      distinct: ["violationType"], orderBy: { violationType: "asc" },
    });
    return { totalReports, totalViolations, page, pageCount, reports, types };
  }, { isolationLevel: "RepeatableRead" });

  const violationIds = snapshot.reports.flatMap((report) => report.violations.map((event) => event.id));
  // Evidence enrichment must not hide recorded events if storage metadata is
  // unavailable. Media access still uses the existing teacher/admin endpoint.
  // Select audit metadata only: never send private storage keys or inline media.
  const evidenceRecords = violationIds.length ? await prisma.evidenceFile.findMany({
    where: { violationId: { in: violationIds } },
    select: { id: true, violationId: true, fileType: true, uploadedAt: true },
    orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
  }).catch(() => {
    console.warn("AI report evidence metadata unavailable; violation history retained");
    return null;
  }) : [];
  return {
    success: true,
    totalReports: snapshot.totalReports, totalViolations: snapshot.totalViolations,
    page: snapshot.page, pageSize: PAGE_SIZE, pageCount: snapshot.pageCount,
    filters: { search, type },
    types: snapshot.types.map((event) => ({ value: event.violationType ?? UNTYPED_VALUE, label: label(event.violationType) })),
    reports: snapshot.reports.map((report) => {
      const isCompleted = report.endTime !== null && ["completed", "pending_retake"].includes(report.quizStatus ?? "");
      const violationCount = report.violations.length;
      const integrityInvalidated = isCompleted && violationCount >= 3;
      return {
        id: report.id, attemptNumber: report.attemptNumber, quizStatus: report.quizStatus,
        createdAt: report.createdAt.toISOString(), startTime: report.startTime?.toISOString() ?? null,
        endTime: report.endTime?.toISOString() ?? null, isCompleted,
        score: integrityInvalidated ? null : numeric(report.score), integrityInvalidated,
        quiz: report.quiz, student: role === "teacher" ? report.student : null,
        violationCount, aiVerdict: report.aiVerdict, cheatingProbability: numeric(report.cheatingProbability),
        analysisCurrent: isCompleted && report.aiAnalysis !== null && report.aiAnalysis.totalViolations === violationCount,
        aiAnalysis: report.aiAnalysis ? { ...report.aiAnalysis, analyzedAt: report.aiAnalysis.analyzedAt.toISOString() } : null,
        violations: report.violations.map((event) => {
          const records = (evidenceRecords ?? []).filter((file) => file.violationId === event.id)
            .map((file) => ({ id: String(file.id), fileType: file.fileType, uploadedAt: file.uploadedAt.toISOString() }));
          const hasLegacyEvidence = Boolean(event.screenshotPath);
          return {
            id: String(event.id), studentQuizId: event.studentQuizId, violationType: event.violationType,
            label: label(event.violationType), timestamp: event.timestamp.toISOString(),
            confidenceScore: numeric(event.confidenceScore), durationSeconds: event.durationSeconds,
            evidence: { records, hasLegacyEvidence, metadataUnavailable: evidenceRecords === null,
              reviewUrl: role === "teacher" && (records.length > 0 || hasLegacyEvidence) ? "/api/evidence/" + event.id : null },
          };
        }),
      };
    }),
  };
}
