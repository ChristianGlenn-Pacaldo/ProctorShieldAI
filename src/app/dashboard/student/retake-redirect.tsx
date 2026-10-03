"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PusherClient from "pusher-js";
import { getQuizJoinDestination } from "@/lib/quiz-join";
import { getApprovedRetakeDestination, getPendingRetakes, type RetakeEnrollment } from "@/lib/retake-redirect";
import { useUserSessionWork } from "@/components/user-session-lifecycle";

export default function RetakeRedirect({ userId }: { userId: string }) {
  const router = useRouter();
  const { work } = useUserSessionWork();

  useEffect(() => {
    const generation = work.capture();
    if (!work.isCurrent(generation)) return;
    let active = true;
    const isActive = () => active && work.isCurrent(generation);
    let navigating = false;
    let checking = false;
    let pendingRetakes = new Map<number, number>();

    const reconcile = async () => {
      if (checking || !isActive()) return;
      const request = work.beginRequest();
      if (!request) return;
      checking = true;
      try {
        const response = await fetch("/api/quizzes", { cache: "no-store", signal: request.controller.signal });
        if (!await work.acceptResponse(response, request)) return;
        if (!response.ok || !isActive() || navigating) return;
        const data = await response.json();
        if (!isActive() || navigating) return;
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
        if (isActive() && !request.controller.signal.aborted) console.error("Failed to check retake status", error);
      } finally {
        checking = false;
        work.finishRequest(request.controller);
      }
    };

    void reconcile();
    const interval = window.setInterval(() => {
      if (pendingRetakes.size) void reconcile();
    }, 5_000);

    const pusher = new PusherClient(
      process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
      { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1", authEndpoint: "/api/pusher/auth?scope=user&role=student" }
    );
    const channelName = `private-student-${userId}`;
    const channel = pusher.subscribe(channelName);
    channel.bind("pusher:subscription_error", (error: { status?: number }) => {
      if (isActive() && error.status === 401) work.reportLoss(401);
    });
    channel.bind("retake-decision", (data: { action: string; quizId: number; quizMode?: string }) => {
      if (!isActive()) return;
      if (data.action === "accept" && Number.isInteger(data.quizId) && !navigating) {
        navigating = true;
        router.push(getQuizJoinDestination(data.quizId, data.quizMode === "arena" ? "arena" : "proctored"));
      } else if (data.action === "reject") {
        window.location.reload();
      }
    });

    return work.addCleanup(() => {
      if (!active) return;
      active = false;
      window.clearInterval(interval);
      channel.unbind("retake-decision");
      channel.unbind("pusher:subscription_error");
      pusher.unsubscribe(channelName);
      pusher.disconnect();
    });
  }, [userId, router, work]);

  return null;
}
