"use client";

import { useEffect } from "react";
import PusherClient from "pusher-js";
import { getQuizJoinDestination } from "@/lib/quiz-join";
import { getApprovedRetakeDestination, getPendingRetakes, type RetakeEnrollment } from "@/lib/retake-redirect";
import { useUserSessionWork } from "@/components/user-session-lifecycle";

export default function RetakeRedirect({ userId }: { userId: string }) {
  const { work } = useUserSessionWork();

  useEffect(() => {
    const generation = work.capture();
    if (!work.isCurrent(generation)) return;
    let active = true;
    const isActive = () => active && work.isCurrent(generation);
    let navigating = false;
    let checking = false;
    let initialized = false;
    let navigationSequence = 0;
    let pendingRetakes = new Map<number, number>();

    const navigateStudent = (destination: string | null) => {
      navigating = true;
      // A fresh document request carries this consistency guard through the
      // final proxy boundary, even if the preceding identity response is stale.
      const target = destination || "/dashboard/student";
      window.location.assign(`${target}?_retakeStudent=${encodeURIComponent(userId)}`);
    };

    const confirmStudentSession = async () => {
      const request = work.beginRequest();
      if (!request) return false;
      try {
        const response = await fetch("/api/auth/session?scope=user&role=student", {
          cache: "no-store", signal: request.controller.signal,
        });
        if (!await work.acceptResponse(response, request) || !response.ok) return false;
        const data = await response.json();
        if (!isActive() || request.controller.signal.aborted) return false;
        if (data.user?.role !== "student" || data.user?.userId !== userId) {
          work.reportLoss(401);
          return false;
        }
        return true;
      } finally {
        work.finishRequest(request.controller);
      }
    };

    const navigateRealtime = async (destination: string | null) => {
      if (!isActive() || navigating) return;
      const sequence = ++navigationSequence;
      try {
        if (!await confirmStudentSession() || !isActive() || navigating || sequence !== navigationSequence) return;
        navigateStudent(destination);
      } catch (error) {
        if (isActive()) console.error("Failed to validate retake session", error);
      }
    };

    const reconcile = async () => {
      if (checking || !isActive()) return;
      const request = work.beginRequest();
      if (!request) return;
      checking = true;
      const sequence = navigationSequence;
      try {
        const response = await fetch("/api/quizzes?scope=user&role=student", { cache: "no-store", signal: request.controller.signal });
        if (!await work.acceptResponse(response, request)) return;
        if (!response.ok || !isActive() || navigating) return;
        const data = await response.json();
        if (!isActive() || request.controller.signal.aborted || navigating) return;
        // A response authorized when it started may finish after another tab
        // replaces the cookie. Revalidate the mounted Student before using it.
        if (!await confirmStudentSession() || !isActive() || navigating || sequence !== navigationSequence) return;
        const enrollments: RetakeEnrollment[] = data.quizzes || [];
        const destination = getApprovedRetakeDestination(enrollments, pendingRetakes);
        if (destination) {
          navigateStudent(destination);
          return;
        }
        const nextPendingRetakes = getPendingRetakes(enrollments);
        if (pendingRetakes.size && nextPendingRetakes.size < pendingRetakes.size) {
          navigateStudent(null);
          return;
        }
        pendingRetakes = nextPendingRetakes;
        initialized = true;
      } catch (error) {
        if (isActive() && !request.controller.signal.aborted) console.error("Failed to check retake status", error);
      } finally {
        checking = false;
        work.finishRequest(request.controller);
      }
    };

    void reconcile();
    const interval = window.setInterval(() => {
      if (!initialized || pendingRetakes.size) void reconcile();
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
        void navigateRealtime(getQuizJoinDestination(data.quizId, data.quizMode === "arena" ? "arena" : "proctored"));
      } else if (data.action === "reject") {
        void navigateRealtime(null);
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
  }, [userId, work]);

  return null;
}
