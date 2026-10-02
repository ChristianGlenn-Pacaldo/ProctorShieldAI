import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1. Fetch counts for stats (Active Sessions, Active Quizzes, Active Violations, AI Flags)
    const now = new Date();
    const presenceCutoff = new Date(now.getTime() - 45_000);
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const tomorrowUtc = new Date(todayUtc.getTime() + 86_400_000);
    const activeSessions = await prisma.user.count({
      where: { status: "active", isOnline: true, lastSeenAt: { gte: presenceCutoff } },
    });

    const activeQuizzes = await prisma.quiz.count({
      where: { quizStatus: "in_progress" },
    });

    const activeViolations = await prisma.violation.count({
      where: {
        studentQuiz: {
          quizStatus: "in_progress",
          quiz: { quizStatus: "in_progress" },
        },
      },
    });

    const aiFlags = await prisma.aiAnalysis.count({
      where: {
        finalVerdict: { in: ["suspicious", "cheated"] },
        analyzedAt: { gte: todayUtc, lt: tomorrowUtc },
      },
    });

    // 2. Platform user distribution (all registered users)
    const totalStudents = await prisma.user.count({
      where: { role: { roleName: "student" } },
    });
    const totalTeachers = await prisma.user.count({
      where: { role: { roleName: "teacher" } },
    });
    const totalAdmins = await prisma.user.count({
      where: { role: { roleName: "admin" } },
    });

    const totalCalculated = Math.max(1, totalStudents + totalTeachers + totalAdmins);

    // 3. User Management table list (Fetch all non-admin users)
    const dbUsers = await prisma.user.findMany({
      where: {
        role: { roleName: { not: "admin" } }
      },
      include: { 
        role: true,
        userSubscriptions: {
          where: {
            subscriptionStatus: "active",
            endDate: { gt: now },
            plan: { yearlyPrice: { gt: 0 } },
          },
          include: { plan: true }
        }
      },
      orderBy: { createdAt: "desc" },
    });

    const formattedUsers = dbUsers.map((u) => {
      let roleClass = "bg-indigo-500/10 text-indigo-600";
      if (u.role.roleName === "teacher") {
        roleClass = "bg-violet-500/10 text-violet-600";
      } else if (u.role.roleName === "admin") {
        roleClass = "bg-rose-500/10 text-rose-600";
      }

      const statusClass = u.status === "suspended"
        ? "bg-red-500/10 text-red-500"
        : "bg-emerald-500/10 text-emerald-600";

      // Determine Subscription Plan
      let plan = "N/A";
      let subscription = "N/A";
      let subClass = "bg-white/5 text-[var(--muted)]";

      if (u.role.roleName === "teacher") {
        const activeSub = u.userSubscriptions?.[0];
        if (activeSub) {
          plan = activeSub.plan?.planName?.includes("Premium") ? "Premium" : "PRO (Active)";
          subscription = "PRO (Active)";
          subClass = "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20";
        } else {
          plan = "Free Tier";
          subscription = "Free Plan";
          subClass = "bg-white/10 text-white/50";
        }
      }

      return {
        id: u.id,
        name: u.fullName,
        email: u.email,
        isOnline: u.status === "active" && u.isOnline && Boolean(u.lastSeenAt && u.lastSeenAt >= presenceCutoff),
        role: u.role.roleName.charAt(0).toUpperCase() + u.role.roleName.slice(1),
        roleClass,
        plan,
        status: u.status.charAt(0).toUpperCase() + u.status.slice(1),
        statusClass,
        subscription,
        subClass,
        joined: new Date(u.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      };
    });

    return NextResponse.json({
      success: true,
      stats: {
        totalUsers: activeSessions,       // Mapped to Active Sessions
        totalQuizzes: activeQuizzes,          // Mapped to Quizzes In-Progress
        totalViolations: activeViolations, // Mapped to Violations (Live)
        aiVerdictsToday: aiFlags,          // Mapped to AI Flags
      },
      platformBars: [
        { label: "Students", value: totalStudents, pct: Math.round((totalStudents / totalCalculated) * 100), color: "bg-indigo-500" },
        { label: "Teachers", value: totalTeachers, pct: Math.round((totalTeachers / totalCalculated) * 100), color: "bg-violet-500" },
        { label: "Admins", value: totalAdmins, pct: Math.round((totalAdmins / totalCalculated) * 100), color: "bg-rose-500" },
      ],
      activityBars: [
        { label: "Quizzes In-Progress", value: activeQuizzes, pct: activeQuizzes > 0 ? 100 : 0, color: "bg-emerald-500" },
        { label: "Active Violations", value: activeViolations, pct: activeViolations > 0 ? 100 : 0, color: "bg-red-500" },
      ],
      activities: [], // Return empty array to start the live activities feed clean
      users: formattedUsers,
    });
  } catch (error: unknown) {
    console.error("Fetch admin dashboard error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
