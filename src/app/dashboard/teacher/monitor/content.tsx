"use client";

import { useState, useEffect, useRef } from "react";
import PusherClient from "pusher-js";
import Link from "next/link";
import { Crown, Shield, Check, Radio } from "lucide-react";

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
    <div className={`rounded-xl overflow-hidden border-2 ${feed.border} transition-all duration-300 hover:scale-[1.02] cursor-pointer bg-slate-950 shadow-lg`}>
      <div className="bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 h-44 flex items-center justify-center relative overflow-hidden">
        {/* Live Snapshot Stream Feed */}
        {feed.snapshot ? (
          <img 
            src={feed.snapshot} 
            alt={feed.name} 
            className="w-full h-full object-cover animate-fade-in" 
          />
        ) : (
          <div className="flex flex-col items-center gap-2.5 px-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-xl font-extrabold text-blue-400 shadow-md">
              {feed.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
            </div>
            <span className="text-[11px] text-amber-400 font-semibold animate-pulse">
              In Exam Lobby (Starting...)
            </span>
          </div>
        )}

        {/* Live indicator badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2.5 py-1 bg-black/85 backdrop-blur-md rounded-lg text-[9px] font-extrabold border shadow-md">
          {feed.snapshot ? (
            <>
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_#10b981]" />
              <span className="text-emerald-400 tracking-wider">📸 LIVE SNAPSHOT</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
              <span className="text-amber-400 tracking-wider">⏳ IN LOBBY</span>
            </>
          )}
        </div>

        {/* Violation badge */}
        {feed.violationCount > 0 && (
          <div className="absolute top-2 right-2 px-2.5 py-1 bg-red-600 rounded-lg text-[9px] font-extrabold text-white shadow-md border border-red-400/30 animate-pulse">
            {feed.violationCount}/3 ⚠ VIOLATION
          </div>
        )}
      </div>

      <div className="px-4 py-3 bg-[var(--surface2)] border-t border-[var(--border)]">
        <div className="flex items-center justify-between text-xs font-bold">
          <span className="text-[var(--ink)] truncate max-w-[150px]">{feed.name}</span>
          <span className={`${feed.statusColor} whitespace-nowrap text-[11px]`}>{feed.status}</span>
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
  const feedsRef = useRef<Feed[]>([]);

  // Subscription gating
  const [isSubscribed, setIsSubscribed] = useState(false);
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

  // Keep ref in sync
  useEffect(() => {
    feedsRef.current = feeds;
  }, [feeds]);

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

    channel.bind("live-snapshot", (data: any) => {
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
            },
          ];
        }
      });
    });

    return () => {
      pusher.unsubscribe(`teacher-${teacherId}`);
      pusher.disconnect();
    };
  }, [teacherId]);

  // ── Poll snapshots from server ──
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
              Real-time webcam monitoring of students during quizzes requires a Premium subscription.
              Upgrade to watch live feeds, approve late joins, and catch cheating in real-time.
            </p>
            <div className="space-y-2.5 text-left mb-6 bg-[var(--surface2)] rounded-xl p-4 border border-[var(--border)]">
              {[
                "Real-time 1-second webcam feeds",
                "Live violation alerts & trust scores",
                "Late join approval system",
                "Retake request management",
                "AI-powered cheating detection",
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
              className="w-full py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:opacity-90 transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-1.5"
            >
              <Crown className="w-4 h-4" /> Upgrade to Premium
            </Link>
            <div className="flex items-center justify-center gap-1.5 mt-4 text-[10px] text-[var(--muted)]">
              <Shield className="w-3 h-3" />
              Secured by PayMongo · GCash & Card accepted
            </div>
          </div>
        </div>
      </div>
    );
  }

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
