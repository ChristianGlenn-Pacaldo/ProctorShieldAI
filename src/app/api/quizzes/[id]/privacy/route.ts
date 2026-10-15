import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { evidenceRetentionDays } from "@/lib/evidence-retention";
import { QUIZ_PRIVACY_SETTING_KEYS, quizPrivacyInfo } from "@/lib/quiz-privacy";
import { isDisabledArenaResource, ARENA_DISABLED_BODY, ARENA_DISABLED_HEADERS } from "@/lib/power-arena-feature";

const headers = { "Cache-Control": "private, no-store, max-age=0" };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getUserSession("student", { touchActivity: false });
    if (!session) return NextResponse.json({ error: "Student sign-in required" }, { status: 401, headers });
    const { id } = await params;
    if (!/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2_147_483_647) return NextResponse.json({ error: "Quiz unavailable" }, { status: 404, headers });
    const attempt = await prisma.studentQuiz.findFirst({
      where: { studentId: session.userId, quizId: Number(id) },
      select: { quiz: { select: { quizMode: true } } },
    });
    if (!attempt) return NextResponse.json({ error: "Quiz unavailable" }, { status: 404, headers });
    if (isDisabledArenaResource(attempt.quiz)) return NextResponse.json(ARENA_DISABLED_BODY, { status: 403, headers: ARENA_DISABLED_HEADERS });
    const settings = await prisma.setting.findMany({
      where: { settingKey: { in: [...QUIZ_PRIVACY_SETTING_KEYS] } },
      select: { settingKey: true, settingValue: true },
    });
    const retention = settings.find(row => row.settingKey === "evidence_retention_days")?.settingValue;
    return NextResponse.json(quizPrivacyInfo(settings, evidenceRetentionDays(retention)), { headers });
  } catch {
    return NextResponse.json({ error: "Privacy information is temporarily unavailable" }, { status: 503, headers });
  }
}

