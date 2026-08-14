import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── User counts
    const totalStudents = await prisma.user.count({ where: { role: { roleName: "student" } } });
    const totalTeachers = await prisma.user.count({ where: { role: { roleName: "teacher" } } });
    const totalAdmins   = await prisma.user.count({ where: { role: { roleName: "admin" } } });
    const totalUsers    = totalStudents + totalTeachers + totalAdmins;

    // ── Subscription stats
    const proTeachers = await prisma.userSubscription.count({
      where: { subscriptionStatus: "active", user: { role: { roleName: "teacher" } } },
    });
    const freeTeachers = Math.max(0, totalTeachers - proTeachers);
    const subConversionPct = totalTeachers > 0 ? Math.round((proTeachers / totalTeachers) * 100) : 0;

    // ── Quiz stats
    const totalQuizzes    = await prisma.quiz.count();
    const completedQuizzes = await prisma.studentQuiz.count({ where: { quizStatus: "completed" } });
    const totalAttempts   = await prisma.studentQuiz.count();

    // ── AI verdict distribution
    const cleanCount      = await prisma.aiAnalysis.count({ where: { finalVerdict: "clean" } });
    const suspiciousCount = await prisma.aiAnalysis.count({ where: { finalVerdict: "suspicious" } });
    const cheatedCount    = await prisma.aiAnalysis.count({ where: { finalVerdict: "cheated" } });
    const totalVerdicts   = cleanCount + suspiciousCount + cheatedCount;
    const totalVerdictsSafe = Math.max(1, totalVerdicts);

    // ── Violation stats
    const totalViolations = await prisma.violation.count();

    // ── Recent 30 days new user registrations
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const newUsersThisMonth = await prisma.user.count({
      where: { createdAt: { gte: thirtyDaysAgo } },
    });

    return NextResponse.json({
      success: true,
      userStats: {
        totalUsers,
        totalStudents,
        totalTeachers,
        totalAdmins,
        newUsersThisMonth,
      },
      subscriptionStats: {
        proTeachers,
        freeTeachers,
        conversionPct: subConversionPct,
      },
      quizStats: {
        totalQuizzes,
        completedQuizzes,
        totalAttempts,
      },
      aiStats: {
        totalVerdicts,
        totalViolations,
        cleanCount,
        suspiciousCount,
        cheatedCount,
        cleanPct: Math.round((cleanCount / totalVerdictsSafe) * 100),
        suspiciousPct: Math.round((suspiciousCount / totalVerdictsSafe) * 100),
        cheatedPct: Math.round((cheatedCount / totalVerdictsSafe) * 100),
        flaggedPct: Math.round(((suspiciousCount + cheatedCount) / totalVerdictsSafe) * 100),
      },
    });
  } catch (error: unknown) {
    console.error("Admin analytics error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
