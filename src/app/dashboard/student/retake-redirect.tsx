"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PusherClient from "pusher-js";
import { getQuizJoinDestination } from "@/lib/quiz-join";
import { getApprovedRetakeDestination, getPendingRetakes, type RetakeEnrollment } from "@/lib/retake-redirect";

export default function RetakeRedirect({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    let navigating = false;
    let checking = false;
    let pendingRetakes = new Map<number, number>();

    const reconcile = async () => {
      if (checking || !active) return;
      checking = true;
      try {
        const response = await fetch("/api/quizzes", { cache: "no-store" });
        if (!response.ok || !active || navigating) return;
        const data = await response.json();
        if (!active || navigating) return;
        const enrollments: RetakeEnrollment[] = data.quizzes || [];
        const destination = getApprovedRetakeDestination(enrollments, pendingRetakes);
        if (destination) {
          navigating = true;
          router.push(destination);
          return;
        }
        const nextPendingRetakes = getPendingRetakes(enrollments);
        if (pendingRetakes.size && nextPendingRetakes.size < pendingRetakes.size) {
          window.location.reload();
          return;
        }
        pendingRetakes = nextPendingRetakes;
      } catch (error) {
        console.error("Failed to check retake status", error);
      } finally {
        checking = false;
      }
    };

    void reconcile();
    const interval = window.setInterval(() => {
      if (pendingRetakes.size) void reconcile();
    }, 5_000);

    const pusher = new PusherClient(
      process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
      { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1", authEndpoint: "/api/pusher/auth" }
    );
    const channelName = `private-student-${userId}`;
    const channel = pusher.subscribe(channelName);
    channel.bind("retake-decision", (data: { action: string; quizId: number; quizMode?: string }) => {
      if (data.action === "accept" && Number.isInteger(data.quizId) && !navigating) {
        navigating = true;
        router.push(getQuizJoinDestination(data.quizId, data.quizMode === "arena" ? "arena" : "proctored"));
      } else if (data.action === "reject") {
        window.location.reload();
      }
    });

    return () => {
      active = false;
      window.clearInterval(interval);
      channel.unbind("retake-decision");
      pusher.unsubscribe(channelName);
      pusher.disconnect();
    };
  }, [userId, router]);

  return null;
}
