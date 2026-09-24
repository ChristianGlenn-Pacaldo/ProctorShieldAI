import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { pusherServer } from "@/lib/pusher";
import { hasActiveProSubscription } from "@/lib/teacher-entitlements";
import { UNAVAILABLE_QUIZ_STATUSES } from "@/lib/quiz-availability";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const socketId = formData.get("socket_id");
  const channelName = formData.get("channel_name");
  if (typeof socketId !== "string" || typeof channelName !== "string") {
    return NextResponse.json({ error: "Invalid channel request" }, { status: 400 });
  }

  let allowed = false;
  if (channelName === `private-user-${session.userId}`) allowed = true;
  if (channelName === `private-student-${session.userId}` && session.role === "student") allowed = true;
  if (channelName === `private-teacher-${session.userId}` && session.role === "teacher") {
    allowed = await hasActiveProSubscription(session.userId);
  }
  if (channelName === "private-admin-dashboard" && session.role === "admin") allowed = true;

  const channelMatch = /^private-(quiz|arena)-(\d+)$/.exec(channelName);
  if (channelMatch) {
    const channelType = channelMatch[1];
    const quizId = Number(channelMatch[2]);
    if (session.role === "admin") {
      allowed = true;
    } else if (session.role === "teacher") {
      allowed = Boolean(await prisma.quiz.findFirst({
        where: {
          id: quizId,
          teacherId: session.userId,
          quizStatus: { notIn: [...UNAVAILABLE_QUIZ_STATUSES] },
          ...(channelType === "arena" ? { quizMode: "arena" } : {}),
        },
        select: { id: true },
      }));
    } else if (session.role === "student") {
      allowed = Boolean(await prisma.studentQuiz.findFirst({
        where: {
          quizId,
          studentId: session.userId,
          endTime: null,
          quizStatus: { in: ["enrolled", "in_progress", "pending_approval"] },
          quiz: {
            quizStatus: { notIn: [...UNAVAILABLE_QUIZ_STATUSES] },
            ...(channelType === "arena" ? { quizMode: "arena" } : {}),
          },
          ...(channelType === "arena"
            ? { attemptMode: "arena" }
            : {}),
        },
        select: { id: true },
      }));
    }
  }

  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(pusherServer.authorizeChannel(socketId, channelName));
}
