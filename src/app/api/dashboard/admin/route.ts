import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1. Fetch counts for stats (Active Sessions, Active Exams, Active Violations, AI Flags)
    const activeSessions = await prisma.user.count({
      where: { isOnline: true },
    });

    const activeExams = await prisma.studentExam.count({
      where: {
        examStatus: {
          not: "completed",
        },
      },
    });

    const activeViolations = await prisma.violation.count({
      where: {
        studentExam: {
          examStatus: {
            not: "completed",
          },
        },
      },
    });

    // AI Flags (Lifetime)
    const aiFlags = await prisma.aiAnalysis.count({
      where: {
        finalVerdict: { in: ["suspicious", "cheated"] },
      },
    });

    // 2. Platform user distribution (online users only)
    const onlineStudents = await prisma.user.count({
      where: { isOnline: true, role: { roleName: "student" } },
    });
    const onlineTeachers = await prisma.user.count({
      where: { isOnline: true, role: { roleName: "teacher" } },
    });
    const onlineAdmins = await prisma.user.count({
      where: { isOnline: true, role: { roleName: "admin" } },
    });

    const totalOnlineCalculated = Math.max(1, onlineStudents + onlineTeachers + onlineAdmins);

    // 3. User Management table list (Online users only)
    const dbOnlineUsers = await prisma.user.findMany({
      where: { isOnline: true },
      include: { role: true },
      orderBy: { fullName: "asc" },
    });

    const formattedUsers = dbOnlineUsers.map((u) => {
      let roleClass = "bg-indigo-500/10 text-indigo-600";
      if (u.role.roleName === "teacher") {
        roleClass = "bg-violet-500/10 text-violet-600";
      } else if (u.role.roleName === "admin") {
        roleClass = "bg-rose-500/10 text-rose-600";
      }

      const statusClass = u.status === "suspended"
        ? "bg-red-500/10 text-red-500"
        : "bg-emerald-500/10 text-emerald-600";

      return {
        id: u.id,
        name: u.fullName,
        email: u.email,
        role: u.role.roleName.charAt(0).toUpperCase() + u.role.roleName.slice(1),
        roleClass,
        status: u.status.charAt(0).toUpperCase() + u.status.slice(1),
        statusClass,
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
        totalExams: activeExams,          // Mapped to Exams In-Progress
        totalViolations: activeViolations, // Mapped to Violations (Live)
        aiVerdictsToday: aiFlags,          // Mapped to AI Flags
      },
      platformBars: [
        { label: "Students Online", value: onlineStudents, pct: Math.round((onlineStudents / totalOnlineCalculated) * 100), color: "bg-indigo-500" },
        { label: "Teachers Online", value: onlineTeachers, pct: Math.round((onlineTeachers / totalOnlineCalculated) * 100), color: "bg-violet-500" },
        { label: "Admins Online", value: onlineAdmins, pct: Math.round((onlineAdmins / totalOnlineCalculated) * 100), color: "bg-rose-500" },
      ],
      activityBars: [
        { label: "Exams In-Progress", value: activeExams, pct: activeExams > 0 ? 100 : 0, color: "bg-emerald-500" },
        { label: "Active Violations", value: activeViolations, pct: activeViolations > 0 ? 100 : 0, color: "bg-red-500" },
      ],
      activities: [], // Return empty array to start the live activities feed clean
      users: formattedUsers,
    });
  } catch (error: any) {
    console.error("Fetch admin dashboard error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
