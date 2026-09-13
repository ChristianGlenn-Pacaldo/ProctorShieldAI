"use client";

import { useState, useEffect, useRef } from "react";
import PusherClient from "pusher-js";
import Link from "next/link";
import { Crown, Shield, Check, Camera, Radio, AlertTriangle } from "lucide-react";

interface Feed {
  id: string;
  name: string;
  quizTitle: string;
  status: string;
  statusColor: string;
  border: string;
  joinedAt: Date;
  lastSeen: Date;
  violationCount: number;
  snapshot: string | null;
  deviceType?: "desktop" | "mobile";
  monitoringLevel?: "strict" | "reduced";
  connectionStatus?: "online" | "offline";
}

function StudentVideoFeed({ feed, onClick }: { feed: Feed; onClick?: () => void }) {
  const [imgError, setImgError] = useState(false);
  const hasValidSnapshot = Boolean(feed.snapshot && feed.snapshot.startsWith("data:image/") && !imgError);

  return (
    <div
      onClick={onClick}
      className={`rounded-2xl overflow-hidden border-2 ${feed.border} transition-all duration-300 hover:scale-[1.02] cursor-pointer bg-slate-950 shadow-xl`}
    >
      <div className="bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 h-48 flex items-center justify-center relative overflow-hidden">
        {/* Adaptive snapshot stream */}
        {hasValidSnapshot ? (
          <img 
            key={feed.snapshot?.slice(-20)}
            src={feed.snapshot!} 
            alt={feed.name} 
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-opacity duration-200" 
          />
        ) : (
          <div className="flex flex-col items-center gap-2.5 px-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-2xl font-extrabold text-blue-400 shadow-inner">
              {feed.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
            </div>
            <span className="text-[11px] text-amber-400 font-semibold animate-pulse">
              {feed.snapshot ? "Capturing AI Snapshot..." : "In Exam Lobby (Waiting to Start)"}
            </span>
          </div>
        )}

        {/* Top-Left Live Indicator Badge */}
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2.5 py-1 bg-black/85 backdrop-blur-md rounded-lg text-[10px] font-extrabold border border-white/10 shadow-md">
          {hasValidSnapshot ? (
            <>
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_#10b981]" />
              <span className="text-emerald-400 tracking-wider font-mono">📸 AI SNAPSHOT · LIVE SYNC</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
              <span className="text-amber-400 tracking-wider">⏳ IN LOBBY</span>
            </>
          )}
        </div>

        {/* Top-Right Violation Badge */}
        {feed.violationCount > 0 && (
          <div className="absolute top-2.5 right-2.5 px-2.5 py-1 bg-red-600 rounded-lg text-[10px] font-extrabold text-white shadow-md border border-red-400/40 animate-pulse">
            {feed.violationCount}/3 ⚠ VIOLATION
          </div>
        )}
      </div>

      <div className="px-4 py-3 bg-[var(--surface2)] border-t border-[var(--border)]">
        <div className="flex items-center justify-between text-xs font-bold">
          <span className="text-[var(--ink)] truncate max-w-[160px] font-semibold">{feed.name}</span>
          <span className={`${feed.statusColor} whitespace-nowrap text-[11px]`}>{feed.status}</span>
        </div>
        <div className="text-[11px] font-medium text-[var(--muted)] mt-0.5 truncate flex items-center justify-between">
          <span>{feed.quizTitle}</span>
          <span className={`text-[9px] font-bold ${feed.monitoringLevel === "reduced" ? "text-violet-400" : "text-emerald-500"}`}>
            {feed.deviceType === "mobile" ? "Mobile" : "Desktop"} · {feed.monitoringLevel === "reduced" ? "Reduced" : "Strict"}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function LiveMonitorContent({
  teacherId,
  initialIsSubscribed = false,
}: {
  teacherId: string;
  initialIsSubscribed?: boolean;
}) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [totalViolations, setTotalViolations] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [pendingRetakes, setPendingRetakes] = useState<any[]>([]);
  const [selectedStudentModal, setSelectedStudentModal] = useState<Feed | null>(null);
  const [warningSendState, setWarningSendState] = useState<"idle" | "sending" | "sent" | "queued" | "error">("idle");
  const [warningSendMessage, setWarningSendMessage] = useState("");

  // Subscription gating
  const [isSubscribed, setIsSubscribed] = useState(initialIsSubscribed);
  const [isCheckingSub, setIsCheckingSub] = useState(true);

  useEffect(() => {
    const checkSub = async () => {
      try {
        const res = await fetch("/api/billing/status");
        if (res.ok) {
          const data = await res.json();
          setIsSubscribed(data.isSubscribed);
        }
      } catch (err) {
        console.error("Subscription check failed:", err);
      } finally {
        setIsCheckingSub(false);
      }
    };
    checkSub();
  }, []);

  const openStudentModal = (feed: Feed) => {
    setWarningSendState("idle");
    setWarningSendMessage("");
    setSelectedStudentModal(feed);
  };

  const handleSendWarning = async () => {
    if (!selectedStudentModal || warningSendState === "sending") return;
    setWarningSendState("sending");
    setWarningSendMessage("");

    try {
      const response = await fetch("/api/live/warning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selectedStudentModal.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to send the warning.");

      if (data.realtimeDelivered) {
        setWarningSendState("sent");
        setWarningSendMessage("Warning delivered to the student's active quiz.");
      } else {
        setWarningSendState("queued");
        setWarningSendMessage("Realtime delivery was interrupted. The warning is queued and will appear after the student's next sync.");
      }
    } catch (error) {
      setWarningSendState("error");
      setWarningSendMessage(error instanceof Error ? error.message : "Unable to send the warning.");
    }
  };

  const handleApprove = async (studentQuizId: number, action: "accept" | "reject") => {
    try {
      const res = await fetch("/api/quizzes/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentQuizId, action }),
      });
      if (res.ok) {
        setPendingApprovals((prev) => prev.filter((p) => p.studentQuizId !== studentQuizId));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRetakeApprove = async (studentQuizId: number, action: "accept" | "reject") => {
    try {
      const res = await fetch("/api/quizzes/retake/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentQuizId, action }),
      });
      if (res.ok) {
        setPendingRetakes((prev) => prev.filter((p) => p.studentQuizId !== studentQuizId));
      }
    } catch (e) {
      console.error(e);
    }
  };

  // ── Pusher for real-time joins, approvals, violations, and optional snapshots ──
  useEffect(() => {
    if (!isSubscribed || !teacherId || teacherId === "unknown") return;

    const pusher = new PusherClient(
      process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
      { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1", authEndpoint: "/api/pusher/auth" }
    );

    const teacherChannel = pusher.subscribe(`private-teacher-${teacherId}`);

    // Optional server-pushed snapshot receiver
    const handleLiveSnapshot = (data: any) => {
      const studentId = data.studentId ? String(data.studentId) : String(data.studentName);
      const studentNameLower = String(data.studentName || "").toLowerCase().trim();

      setFeeds((prev) => {
        const existingIndex = prev.findIndex((f) => 
          String(f.id) === studentId || 
          String(f.name || "").toLowerCase().trim() === studentNameLower
        );

        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            snapshot: data.snapshot,
            deviceType: data.deviceType === "mobile" ? "mobile" : "desktop",
            monitoringLevel: data.monitoringLevel === "strict" ? "strict" : "reduced",
            connectionStatus: "online",
            status: "✓ Active",
            statusColor: "text-emerald-500",
            border: "border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]",
            lastSeen: new Date(),
          };
          return updated;
        } else {
          return [
            ...prev,
            {
              id: studentId,
              name: data.studentName,
              quizTitle: data.quizTitle || "Quiz",
              status: "✓ Active",
              statusColor: "text-emerald-500",
              border: "border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]",
              joinedAt: new Date(),
              lastSeen: new Date(),
              violationCount: 0,
              snapshot: data.snapshot,
              deviceType: data.deviceType === "mobile" ? "mobile" : "desktop",
              monitoringLevel: data.monitoringLevel === "strict" ? "strict" : "reduced",
              connectionStatus: "online",
            },
          ];
        }
      });
    };

    teacherChannel.bind("live-snapshot", handleLiveSnapshot);

    teacherChannel.bind("late-join-request", (data: any) => {
      setPendingApprovals((prev) => {
        if (prev.find((p) => p.studentQuizId === data.studentQuizId)) return prev;
        return [...prev, data];
      });
    });

    teacherChannel.bind("retake-request", (data: any) => {
      setPendingRetakes((prev) => {
        if (prev.find((p) => p.studentQuizId === data.studentQuizId)) return prev;
        return [...prev, data];
      });
    });

    teacherChannel.bind("student-joined", (data: any) => {
      const studentId = data.studentId ? String(data.studentId) : data.studentName;
      setFeeds((prev) => {
        const exists = prev.findIndex((f) => f.id === studentId || f.name === data.studentName);
        if (exists >= 0) {
          const updated = [...prev];
          updated[exists] = {
            ...updated[exists],
            id: studentId,
            deviceType: data.deviceType === "mobile" ? "mobile" : "desktop",
            monitoringLevel: data.monitoringLevel === "strict" ? "strict" : "reduced",
            connectionStatus: "online",
            lastSeen: new Date(),
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: studentId,
            name: data.studentName,
            quizTitle: data.quizTitle || "Quiz",
            status: "✓ Active",
            statusColor: "text-emerald-500",
            border: "border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]",
            joinedAt: new Date(),
            lastSeen: new Date(),
            violationCount: 0,
            snapshot: null,
            deviceType: data.deviceType === "mobile" ? "mobile" : "desktop",
            monitoringLevel: data.monitoringLevel === "strict" ? "strict" : "reduced",
            connectionStatus: "online",
          },
        ];
      });
    });

    teacherChannel.bind("new-violation", (data: any) => {
      setTotalViolations((prev) => prev + 1);
      const studentId = data.studentId ? String(data.studentId) : String(data.studentName);
      const studentNameLower = String(data.studentName || "").toLowerCase().trim();

      setFeeds((prev) => {
        const existingIndex = prev.findIndex((f) => 
          String(f.id) === studentId || 
          String(f.name || "").toLowerCase().trim() === studentNameLower
        );

        let statusText = "⚠ Alert";
        if (data.violationType === "multiple_faces") statusText = "⚠ Multiple Faces";
        if (data.violationType === "no_face") statusText = "⚠ No Face";
        if (data.violationType === "looking_away") statusText = "⚠ Looking Away";
        if (data.violationType === "tab_switch") statusText = "⚠ Tab Switch";
        if (data.violationType === "device_detected") statusText = "📱 Device Detected";
        if (data.violationType === "attempted_screenshot") statusText = "📸 Screenshot/Copy";
        if (data.violationType === "audio_anomaly") statusText = "🎙 Audio Anomaly";
        if (data.violationType === "window_resize") statusText = "📐 Window Resized";

        const currentSnap = data.snapshot || (existingIndex >= 0 ? prev[existingIndex].snapshot : null);

        const violationFeed: Feed = {
          id: studentId,
          name: data.studentName,
          quizTitle: data.quizTitle || "Quiz",
          status: statusText,
          statusColor: "text-red-500",
          border: "border-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.3)] animate-pulse",
          joinedAt: existingIndex >= 0 ? prev[existingIndex].joinedAt : new Date(),
          lastSeen: new Date(),
          violationCount: existingIndex >= 0 ? prev[existingIndex].violationCount + 1 : 1,
          snapshot: currentSnap,
          deviceType: data.deviceType === "mobile"
            ? "mobile"
            : existingIndex >= 0 ? prev[existingIndex].deviceType : "desktop",
          monitoringLevel: data.monitoringLevel === "strict"
            ? "strict"
            : existingIndex >= 0 ? prev[existingIndex].monitoringLevel : "reduced",
          connectionStatus: "online",
        };

        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = violationFeed;
          return updated;
        } else {
          return [violationFeed, ...prev];
        }
      });

      setTimeout(() => {
        setFeeds((prev) =>
          prev.map((f) =>
            (String(f.id) === studentId || String(f.name || "").toLowerCase().trim() === studentNameLower) && f.statusColor === "text-red-500"
              ? {
                  ...f,
                  statusColor: "text-amber-500",
                  border: "border-amber-500/50 shadow-[0_0_0_1px_rgba(245,158,11,0.2)]",
                }
              : f
          )
        );
      }, 6000);
    });

    return () => {
      pusher.unsubscribe(`private-teacher-${teacherId}`);
      pusher.disconnect();
    };
  }, [isSubscribed, teacherId]);

  useEffect(() => {
    if (!isSubscribed) return;
    const connectionCheck = window.setInterval(() => {
      const cutoff = Date.now() - 10_000;
      setFeeds((current) => current.map((feed) => {
        if (feed.lastSeen.getTime() >= cutoff || feed.connectionStatus === "offline") return feed;
        return {
          ...feed,
          connectionStatus: "offline",
          status: "Connection lost",
          statusColor: "text-rose-500",
          border: "border-rose-500/50",
        };
      }));
    }, 5_000);
    return () => window.clearInterval(connectionCheck);
  }, [isSubscribed]);

  // ── Poll the snapshot store as an adaptive background sync ──
  useEffect(() => {
    if (!isSubscribed || !teacherId || teacherId === "unknown") return;

    const pollSnapshots = async () => {
      try {
        const res = await fetch("/api/live/snapshot");
        if (!res.ok) return;
        const data = await res.json();
        const snapshots: any[] = data.snapshots || [];

        if (snapshots.length > 0) {
          setFeeds((prev) => {
            const updated = [...prev];

            // Single Student Direct Bind Guarantee
            if (updated.length === 1 && snapshots.length === 1 && snapshots[0].snapshot) {
              updated[0] = {
                ...updated[0],
                snapshot: snapshots[0].snapshot,
                deviceType: snapshots[0].deviceType === "mobile" ? "mobile" : "desktop",
                monitoringLevel: snapshots[0].monitoringLevel === "strict" ? "strict" : "reduced",
                connectionStatus: "online",
                status: "✓ Active",
                statusColor: "text-emerald-500",
                border: "border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]",
                lastSeen: new Date(),
              };
              return updated;
            }

            for (const snap of snapshots) {
              const sIdStr = String(snap.studentId || "");
              const sNameStr = String(snap.studentName || "").toLowerCase().trim();

              const idx = updated.findIndex((f) => {
                const fIdStr = String(f.id || "");
                const fNameLower = String(f.name || "").toLowerCase().trim();

                if (fIdStr && fIdStr === sIdStr) return true;
                if (fNameLower && sNameStr && fNameLower === sNameStr) return true;
                if (fNameLower && sNameStr && fNameLower.includes(sNameStr)) return true;
                if (fNameLower && sNameStr && sNameStr.includes(fNameLower.split(",")[0].trim())) return true;
                return false;
              });

              if (idx >= 0) {
                updated[idx] = {
                  ...updated[idx],
                  id: sIdStr || updated[idx].id,
                  snapshot: snap.snapshot || updated[idx].snapshot,
                  deviceType: snap.deviceType === "mobile" ? "mobile" : "desktop",
                  monitoringLevel: snap.monitoringLevel === "strict" ? "strict" : "reduced",
                  connectionStatus: "online",
                  status: "✓ Active",
                  statusColor: "text-emerald-500",
                  border: "border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]",
                  lastSeen: new Date(),
                };
              } else {
                updated.push({
                  id: sIdStr,
                  name: snap.studentName,
                  quizTitle: snap.quizTitle || "Quiz",
                  status: "✓ Active",
                  statusColor: "text-emerald-500",
                  border: "border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]",
                  joinedAt: new Date(),
                  lastSeen: new Date(),
                  violationCount: 0,
                  snapshot: snap.snapshot,
                  deviceType: snap.deviceType === "mobile" ? "mobile" : "desktop",
                  monitoringLevel: snap.monitoringLevel === "strict" ? "strict" : "reduced",
                  connectionStatus: "online",
                });
              }
            }
            return updated;
          });
        }
      } catch {}
    };

    const interval = setInterval(pollSnapshots, 1000);
    pollSnapshots();

    return () => clearInterval(interval);
  }, [isSubscribed, teacherId]);

  // Subscription paywall
  if (isCheckingSub) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSubscribed) {
    return (
      <div className="animate-fade-in flex items-center justify-center min-h-[60vh]">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/10 via-violet-600/10 to-amber-500/5 pointer-events-none" />
          <div className="relative z-10 p-8 text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-xl shadow-amber-500/20">
              <Crown className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-extrabold text-[var(--ink)] mb-2">Live Monitoring is Premium</h2>
            <p className="text-sm text-[var(--muted)] leading-relaxed mb-6">
              Real-time adaptive AI snapshot monitoring of students during quizzes requires a Premium subscription.
            </p>
            <div className="space-y-2.5 text-left mb-6 bg-[var(--surface2)] rounded-xl p-4 border border-[var(--border)]">
              {[
                "Adaptive 1–2 Second AI Webcam Snapshots",
                "Live violation alerts & trust scores",
                "Late join approval system",
                "Retake request management",
                "AI-powered cheating detection verdicts",
              ].map((feat) => (
                <div key={feat} className="flex items-center gap-2 text-xs">
                  <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span className="text-[var(--ink)] font-medium">{feat}</span>
                </div>
              ))}
            </div>
            <div className="text-center mb-5">
              <span className="text-3xl font-extrabold text-[var(--ink)]">₱500</span>
              <span className="text-sm text-[var(--muted)]">/month</span>
            </div>
            <Link
              href="/dashboard/teacher/billing"
              className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:opacity-90 transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-1.5"
            >
              <Crown className="w-4 h-4" /> Go to Billing & Upgrade
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Pending Approvals */}
      {pendingApprovals.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-4">
          <h3 className="text-sm font-bold text-amber-500 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            Late Join Requests ({pendingApprovals.length})
          </h3>
          <div className="space-y-2">
            {pendingApprovals.map((req) => (
              <div key={req.studentQuizId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--surface)] p-3 rounded-xl border border-[var(--border)]">
                <div>
                  <div className="text-sm font-bold text-[var(--ink)]">{req.studentName}</div>
                  <div className="text-xs text-[var(--muted)]">wants to join &quot;{req.quizTitle}&quot; late</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleApprove(req.studentQuizId, "reject")} className="px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-lg transition-colors border border-red-500/20 cursor-pointer">Reject</button>
                  <button onClick={() => handleApprove(req.studentQuizId, "accept")} className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-all shadow-lg shadow-emerald-600/20 cursor-pointer">Accept</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Retake Requests */}
      {pendingRetakes.length > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 mb-4">
          <h3 className="text-sm font-bold text-rose-500 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            Retake Requests ({pendingRetakes.length})
          </h3>
          <div className="space-y-2">
            {pendingRetakes.map((req) => (
              <div key={req.studentQuizId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--surface)] p-3 rounded-xl border border-[var(--border)]">
                <div>
                  <div className="text-sm font-bold text-[var(--ink)]">{req.studentName}</div>
                  <div className="text-xs text-[var(--muted)]">requested to retake &quot;{req.quizTitle}&quot;</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleRetakeApprove(req.studentQuizId, "reject")} className="px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-lg transition-colors border border-red-500/20 cursor-pointer">Reject</button>
                  <button onClick={() => handleRetakeApprove(req.studentQuizId, "accept")} className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-all shadow-lg shadow-indigo-600/20 cursor-pointer">Accept</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] px-5 py-4 shadow-xs">
          <div className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1">Active Students</div>
          <div className="text-2xl font-extrabold text-emerald-500 font-[family-name:var(--font-display)]">{feeds.length}</div>
        </div>
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] px-5 py-4 shadow-xs">
          <div className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1">Total Violations</div>
          <div className="text-2xl font-extrabold text-red-500 font-[family-name:var(--font-display)]">{totalViolations}</div>
        </div>
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] px-5 py-4 shadow-xs">
          <div className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1">Surveillance Mode</div>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_6px_#10b981]" />
            <span className="text-xs font-extrabold text-emerald-500 uppercase tracking-wide">1-SEC AI SNAPSHOT</span>
          </div>
        </div>
      </div>

      {/* Main Monitor Grid */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)] flex items-center gap-2">
            <Camera className="w-4 h-4 text-indigo-500" />
            Live AI Surveillance — Adaptive Snapshot Feed
          </h3>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-extrabold text-emerald-500 uppercase tracking-wide font-mono">ADAPTIVE REFRESH</span>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {feeds.length === 0 ? (
              <div className="col-span-full h-44 flex flex-col items-center justify-center border border-dashed border-[var(--border)] rounded-2xl text-[var(--muted)]">
                <Camera className="w-8 h-8 text-indigo-500 mb-2 opacity-50" />
                <p className="text-sm font-bold text-[var(--ink)] mb-1">Waiting for active students to join...</p>
                <p className="text-xs text-[var(--muted)]">Student webcam snapshots will appear automatically while a quiz is active. Refresh speed adapts to each device and connection.</p>
              </div>
            ) : (
              feeds.map((f) => (
                <StudentVideoFeed
                  key={f.id}
                  feed={f}
                  onClick={() => openStudentModal(f)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* LIVE STUDENT INSPECTOR MODAL */}
      {selectedStudentModal && (
        <div
          className="app-modal-backdrop bg-black/80 backdrop-blur-md animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedStudentModal(null);
          }}
        >
          <div
            className="app-modal-panel min-h-0 bg-[var(--surface)] border border-[var(--border)] rounded-2xl max-w-lg shadow-2xl overflow-hidden flex flex-col animate-modal"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface2)] px-4 py-3 sm:px-6 sm:py-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-500 font-bold text-xs">
                  {selectedStudentModal.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold leading-none text-[var(--ink)]">{selectedStudentModal.name}</h3>
                  <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{selectedStudentModal.quizTitle}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedStudentModal(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              {/* Snapshot View */}
              <div className="relative rounded-2xl overflow-hidden border-2 border-[var(--border)] bg-slate-950 aspect-[4/3] flex items-center justify-center shadow-lg">
                {selectedStudentModal.snapshot && selectedStudentModal.snapshot.startsWith("data:image/") ? (
                  <img
                    src={selectedStudentModal.snapshot}
                    alt={selectedStudentModal.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 p-6 text-center">
                    <Camera className="w-10 h-10 text-slate-500 mb-1 opacity-50" />
                    <p className="text-xs font-bold text-slate-300">Live Snapshot Initializing</p>
                    <p className="text-[11px] text-slate-500">Waiting for camera sync...</p>
                  </div>
                )}

                <div className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1 bg-black/85 backdrop-blur-md rounded-full text-[10px] font-extrabold border border-white/10 text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>LIVE AI SURVEILLANCE FEED</span>
                </div>
              </div>

              {/* Status & Violation Breakdown */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="p-3.5 bg-[var(--surface2)] border border-[var(--border)] rounded-xl">
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider mb-1">Status</div>
                  <div className="text-xs font-bold text-emerald-500">{selectedStudentModal.status}</div>
                </div>
                <div className="p-3.5 bg-[var(--surface2)] border border-[var(--border)] rounded-xl">
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider mb-1">Violations</div>
                  <div className={`text-xs font-bold ${selectedStudentModal.violationCount > 0 ? "text-red-500" : "text-emerald-500"}`}>
                    {selectedStudentModal.violationCount}/3 Violations
                  </div>
                </div>
                <div className="p-3.5 bg-[var(--surface2)] border border-[var(--border)] rounded-xl">
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider mb-1">Device</div>
                  <div className="text-xs font-bold text-indigo-500 capitalize">{selectedStudentModal.deviceType || "desktop"}</div>
                </div>
                <div className="p-3.5 bg-[var(--surface2)] border border-[var(--border)] rounded-xl">
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider mb-1">Monitoring</div>
                  <div className={`text-xs font-bold ${selectedStudentModal.monitoringLevel === "reduced" ? "text-violet-500" : "text-emerald-500"}`}>
                    {selectedStudentModal.monitoringLevel === "reduced" ? "Reduced Assurance" : "Strict"}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              {warningSendMessage && (
                <div
                  role="status"
                  className={`rounded-xl border px-3.5 py-2.5 text-xs font-semibold ${
                    warningSendState === "error"
                      ? "border-red-500/30 bg-red-500/10 text-red-400"
                      : warningSendState === "queued"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  }`}
                >
                  {warningSendMessage}
                </div>
              )}
              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:gap-3">
                <button
                  type="button"
                  onClick={() => void handleSendWarning()}
                  disabled={warningSendState === "sending"}
                  className="flex-1 py-2.5 rounded-xl font-bold text-xs bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-wait disabled:opacity-60"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {warningSendState === "sending" ? "Sending..." : warningSendState === "sent" ? "Send Again" : "Send Warning Pop-Up"}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStudentModal(null)}
                  className="w-full px-5 py-2.5 rounded-xl font-bold text-xs bg-indigo-600 text-white hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/20 cursor-pointer sm:w-auto"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
