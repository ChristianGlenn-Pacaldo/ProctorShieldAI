"use client";

import { useState, useEffect, useRef } from "react";
import PusherClient from "pusher-js";

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
}

function StudentVideoFeed({ feed }: { feed: Feed }) {
  return (
    <div className={`rounded-xl overflow-hidden border-2 ${feed.border} transition-all duration-300 hover:scale-[1.02] cursor-pointer`}>
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 h-40 flex items-center justify-center relative overflow-hidden">
        {/* Live Snapshot Stream Feed */}
        {feed.snapshot ? (
          <img src={feed.snapshot} alt={feed.name} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-lg font-bold text-white shadow-inner">
              {feed.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
            </div>
            <span className="text-[10px] text-emerald-400 font-semibold animate-pulse">Live Feed Connecting...</span>
          </div>
        )}

        {/* Live indicator badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2.5 py-1 bg-black/80 backdrop-blur rounded-md text-[9px] font-extrabold text-emerald-400 border border-emerald-500/30 shadow-md">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          {feed.snapshot ? "📸 1.5s GEMINI SNAPSHOT" : "CONNECTING..."}
        </div>

        {/* Violation badge */}
        {feed.violationCount > 0 && (
          <div className="absolute top-2 right-2 px-2.5 py-1 bg-red-600 rounded-md text-[9px] font-extrabold text-white shadow-md">
            {feed.violationCount}/3 ⚠
          </div>
        )}
      </div>

      <div className="px-3.5 py-2.5 bg-[var(--surface2)] border-t border-[var(--border)]">
        <div className="flex items-center justify-between text-xs font-bold">
          <span className="text-[var(--ink)] truncate max-w-[150px]">{feed.name}</span>
          <span className={`${feed.statusColor} whitespace-nowrap`}>{feed.status}</span>
        </div>
        <div className="text-[10px] font-medium text-[var(--muted)] mt-0.5 truncate">{feed.quizTitle}</div>
      </div>
    </div>
  );
}

export default function LiveMonitorContent({ teacherId }: { teacherId: string }) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [totalViolations, setTotalViolations] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [pendingRetakes, setPendingRetakes] = useState<any[]>([]);

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

  // ── Pusher for lightweight join/violation events ──
  useEffect(() => {
    if (!teacherId || teacherId === "unknown") return;

    const pusher = new PusherClient(
      process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
      { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1" }
    );

    const channel = pusher.subscribe(`teacher-${teacherId}`);

    channel.bind("late-join-request", (data: any) => {
      setPendingApprovals((prev) => {
        if (prev.find((p) => p.studentQuizId === data.studentQuizId)) return prev;
        return [...prev, data];
      });
    });

    channel.bind("retake-request", (data: any) => {
      setPendingRetakes((prev) => {
        if (prev.find((p) => p.studentQuizId === data.studentQuizId)) return prev;
        return [...prev, data];
      });
    });

    channel.bind("student-joined", (data: any) => {
      const studentId = data.studentId ? String(data.studentId) : data.studentName;
      setFeeds((prev) => {
        const exists = prev.findIndex((f) => f.id === studentId || f.name === data.studentName);
        if (exists >= 0) {
          const updated = [...prev];
          updated[exists] = { ...updated[exists], id: studentId, lastSeen: new Date() };
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
          },
        ];
      });
    });

    channel.bind("new-violation", (data: any) => {
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
      pusher.unsubscribe(`teacher-${teacherId}`);
      pusher.disconnect();
    };
  }, [teacherId]);

  // ── Poll snapshots as fallback ──
  useEffect(() => {
    if (!teacherId || teacherId === "unknown") return;

    const pollSnapshots = async () => {
      try {
        const res = await fetch("/api/live/snapshot");
        if (!res.ok) return;
        const data = await res.json();
        const snapshots: any[] = data.snapshots || [];

        if (snapshots.length > 0) {
          setFeeds((prev) => {
            let updated = [...prev];

            // ── Single Student Guarantee Fallback ──
            // If 1 student card exists on screen and 1 snapshot exists in storage, bind them directly!
            if (updated.length === 1 && snapshots.length === 1 && snapshots[0].snapshot) {
              updated[0] = {
                ...updated[0],
                snapshot: snapshots[0].snapshot,
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
                });
              }
            }
            return updated;
          });
        }
      } catch {}
    };

    const interval = setInterval(pollSnapshots, 1500);
    pollSnapshots();

    return () => clearInterval(interval);
  }, [teacherId]);

  return (
    <div className="animate-fade-in space-y-4">
      {/* Pending Approvals */}
      {pendingApprovals.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-4">
          <h3 className="text-sm font-bold text-amber-500 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            Late Join Requests ({pendingApprovals.length})
          </h3>
          <div className="space-y-2">
            {pendingApprovals.map((req) => (
              <div key={req.studentQuizId} className="flex items-center justify-between bg-[var(--surface)] p-3 rounded-lg border border-[var(--border)]">
                <div>
                  <div className="text-sm font-bold text-[var(--ink)]">{req.studentName}</div>
                  <div className="text-xs text-[var(--muted)]">wants to join &quot;{req.quizTitle}&quot; late</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleApprove(req.studentQuizId, "reject")} className="px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-lg transition-colors border border-red-500/20">Reject</button>
                  <button onClick={() => handleApprove(req.studentQuizId, "accept")} className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-all shadow-lg shadow-emerald-600/20">Accept</button>
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
              <div key={req.studentQuizId} className="flex items-center justify-between bg-[var(--surface)] p-3 rounded-lg border border-[var(--border)]">
                <div>
                  <div className="text-sm font-bold text-[var(--ink)]">{req.studentName}</div>
                  <div className="text-xs text-[var(--muted)]">requested to retake &quot;{req.quizTitle}&quot;</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleRetakeApprove(req.studentQuizId, "reject")} className="px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-lg transition-colors border border-red-500/20">Reject</button>
                  <button onClick={() => handleRetakeApprove(req.studentQuizId, "accept")} className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-all shadow-lg shadow-indigo-600/20">Accept</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats Bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] px-5 py-4">
          <div className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1">Active Students</div>
          <div className="text-2xl font-bold text-emerald-500">{feeds.length}</div>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] px-5 py-4">
          <div className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1">Total Violations</div>
          <div className="text-2xl font-bold text-red-500">{totalViolations}</div>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] px-5 py-4">
          <div className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1">Status</div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-sm font-bold text-emerald-500">LIVE SNAPSHOT STREAM (1.5s)</span>
          </div>
        </div>
      </div>

      {/* Main Monitor Grid */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">📸 Live Video Monitoring — Real-Time Snapshot Stream</h3>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wide">REAL-TIME SNAPSHOT STREAM</span>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {feeds.length === 0 ? (
              <div className="col-span-full h-40 flex flex-col items-center justify-center border border-dashed border-[var(--border)] rounded-xl text-[var(--muted)]">
                <span className="text-3xl mb-3">📸</span>
                <p className="text-sm font-semibold mb-1">Waiting for active student snapshot feeds...</p>
                <p className="text-xs text-[var(--muted)]">Students will appear here with live webcam snapshot feeds when they start a quiz.</p>
              </div>
            ) : (
              feeds.map((f) => (
                <StudentVideoFeed key={f.id} feed={f} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
