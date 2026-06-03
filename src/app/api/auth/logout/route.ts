import { NextRequest, NextResponse } from "next/server";
import { clearSession, getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (session) {
      const dbUser = await prisma.user.findUnique({
        where: { id: session.userId }
      });

      if (dbUser && dbUser.password === "GOOGLE_AUTH_NO_PASSWORD") {
        // Cascade delete Google user from database on logout
        await prisma.$transaction(async (tx) => {
          // A. Deletion of teacher-related data
          const exams = await tx.exam.findMany({
            where: { teacherId: session.userId },
            select: { id: true }
          });
          const examIds = exams.map(e => e.id);

          if (examIds.length > 0) {
            const questions = await tx.question.findMany({
              where: { examId: { in: examIds } },
              select: { id: true }
            });
            const questionIds = questions.map(q => q.id);

            const studentExams = await tx.studentExam.findMany({
              where: { examId: { in: examIds } },
              select: { id: true }
            });
            const studentExamIds = studentExams.map(se => se.id);

            if (studentExamIds.length > 0) {
              const violations = await tx.violation.findMany({
                where: { studentExamId: { in: studentExamIds } },
                select: { id: true }
              });
              const violationIds = violations.map(v => v.id);

              if (violationIds.length > 0) {
                await tx.evidenceFile.deleteMany({
                  where: { violationId: { in: violationIds } }
                });
              }

              await tx.violation.deleteMany({
                where: { studentExamId: { in: studentExamIds } }
              });

              await tx.aiAnalysis.deleteMany({
                where: { studentExamId: { in: studentExamIds } }
              });

              await tx.answer.deleteMany({
                where: { studentExamId: { in: studentExamIds } }
              });

              await tx.studentExam.deleteMany({
                where: { id: { in: studentExamIds } }
              });
            }

            if (questionIds.length > 0) {
              await tx.choice.deleteMany({
                where: { questionId: { in: questionIds } }
              });

              await tx.question.deleteMany({
                where: { examId: { in: examIds } }
              });
            }

            await tx.exam.deleteMany({
              where: { teacherId: session.userId }
            });
          }

          // Delete subjects created by this teacher
          await tx.subject.deleteMany({
            where: { teacherId: session.userId }
          });

          // B. Deletion of student-related data
          const studentExamsAsStudent = await tx.studentExam.findMany({
            where: { studentId: session.userId },
            select: { id: true }
          });
          const studentExamIdsAsStudent = studentExamsAsStudent.map(se => se.id);

          if (studentExamIdsAsStudent.length > 0) {
            const violations = await tx.violation.findMany({
              where: { studentExamId: { in: studentExamIdsAsStudent } },
              select: { id: true }
            });
            const violationIds = violations.map(v => v.id);

            if (violationIds.length > 0) {
              await tx.evidenceFile.deleteMany({
                where: { violationId: { in: violationIds } }
              });
            }

            await tx.violation.deleteMany({
              where: { studentExamId: { in: studentExamIdsAsStudent } }
            });

            await tx.aiAnalysis.deleteMany({
              where: { studentExamId: { in: studentExamIdsAsStudent } }
            });

            await tx.answer.deleteMany({
              where: { studentExamId: { in: studentExamIdsAsStudent } }
            });

            await tx.studentExam.deleteMany({
              where: { studentId: session.userId }
            });
          }

          // C. Delete generic user-related tables
          await tx.notification.deleteMany({
            where: { userId: session.userId }
          });

          await tx.activityLog.deleteMany({
            where: { userId: session.userId }
          });

          // Delete subscriptions and payments
          const subs = await tx.userSubscription.findMany({
            where: { userId: session.userId },
            select: { id: true }
          });
          const subIds = subs.map(s => s.id);

          if (subIds.length > 0) {
            await tx.payment.deleteMany({
              where: { subscriptionId: { in: subIds } }
            });
            await tx.userSubscription.deleteMany({
              where: { userId: session.userId }
            });
          }

          // Finally, delete the User record
          await tx.user.delete({
            where: { id: session.userId }
          });
        });
      } else {
        // Regular user: set offline and log logout activity
        await prisma.user.update({
          where: { id: session.userId },
          data: { isOnline: false },
        });

        await prisma.activityLog.create({
          data: {
            userId: session.userId,
            activity: `Logged out as ${session.role}`,
            ipAddress: req.headers.get("x-forwarded-for") || "unknown",
          },
        });
      }

      // Broadcast activity to admin
      try {
        const { pusherServer } = await import("@/lib/pusher");
        await pusherServer.trigger("admin-dashboard", "activity", {
          type: "logout",
          userId: session.userId,
          fullName: session.fullName,
          role: session.role,
          activity: `Logged out as ${session.role} ${dbUser && dbUser.password === "GOOGLE_AUTH_NO_PASSWORD" ? "(Google Account Cleaned Up)" : ""}`,
          timestamp: new Date().toISOString(),
        });
      } catch (pusherErr) {
        console.error("Pusher logout broadcast error:", pusherErr);
      }
    }

    await clearSession();
    return NextResponse.json({ success: true, message: "Logged out" });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Failed to logout" },
      { status: 500 }
    );
  }
}
