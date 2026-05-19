"use client";

import { useState, useEffect, useRef } from "react";
import PusherClient from "pusher-js";

interface Feed {
  id: string;
  name: string;
  examTitle: string;
  status: string;
  statusColor: string;
  border: string;
  joinedAt: Date;
  lastSeen: Date;
  violationCount: number;
  snapshot: string | null;
}

export default function LiveMonitorContent({ teacherId }: { teacherId: string }) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [totalViolations, setTotalViolations] = useState(0);
  const feedsRef = useRef<Feed[]>([]);

  // Keep ref in sync
  useEffect(() => {
    feedsRef.current = feeds;
  }, [feeds]);

  // ── Pusher for lightweight join/violation events ──
  useEffect(() => {
    if (!teacherId || teacherId === "unknown") return;

    const pusher = new PusherClient(
      process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
      { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1" }
    );

    const channel = pusher.subscribe(`teacher-${teacherId}`);

    // Student joined (lightweight, no snapshot)
    channel.bind("student-joined", (data: any) => {
      console.log("Student joined:", data);
      setFeeds((prev) => {
        const exists = prev.findIndex(f => f.name === data.studentName);
        if (exists >= 0) {
          const updated = [...prev];
          updated[exists] = { ...updated[exists], lastSeen: new Date() };
          return updated;
        }
        return [
          ...prev,
          {
            id: data.studentId || data.studentName + Date.now(),
            name: data.studentName,
            examTitle: data.examTitle || "Exam",
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

    // Violation received
    channel.bind("new-violation", (data: any) => {
      console.log("Violation received:", data);
      setTotalViolations((prev) => prev + 1);

      setFeeds((prev) => {
        const existingIndex = prev.findIndex(f => f.name === data.studentName);

        let statusText = "⚠ Alert";
        if (data.violationType === "multiple_faces") statusText = "⚠ Multiple Faces";
        if (data.violationType === "no_face") statusText = "⚠ No Face";
        if (data.violationType === "looking_away") statusText = "⚠ Looking Away";
        if (data.violationType === "tab_switch") statusText = "⚠ Tab Switch";
        if (data.violationType === "device_detected") statusText = "📱 Device Detected";
        if (data.violationType === "attempted_screenshot") statusText = "📸 Screenshot/Copy";

        const violationFeed: Feed = {
          id: data.studentName + Date.now(),
          name: data.studentName,
          examTitle: data.examTitle || "Exam",
          status: statusText,
          statusColor: "text-red-500",
          border: "border-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.3)] animate-pulse",
          joinedAt: existingIndex >= 0 ? prev[existingIndex].joinedAt : new Date(),
          lastSeen: new Date(),
          violationCount: existingIndex >= 0 ? prev[existingIndex].violationCount + 1 : 1,
          snapshot: existingIndex >= 0 ? prev[existingIndex].snapshot : null,
        };

        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = violationFeed;
          return updated;
        } else {
          return [violationFeed, ...prev];
        }
      });

      // Auto-reset the flashing red after 6 seconds
      setTimeout(() => {
        setFeeds((prev) =>
          prev.map(f =>
            f.name === data.studentName && f.statusColor === "text-red-500"
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

  // ── Poll snapshots from server every 3 seconds ──
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
            for (const snap of snapshots) {
              const idx = updated.findIndex(f => f.name === snap.studentName);
              if (idx >= 0) {
                updated[idx] = {
                  ...updated[idx],
                  snapshot: snap.snapshot,
                  lastSeen: new Date(),
                };
              } else {
                // Student exists in snapshot store but not in feeds yet
                updated.push({
                  id: snap.studentName + Date.now(),
                  name: snap.studentName,
                  examTitle: snap.examTitle || "Exam",
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
      } catch (err) {
        // Silently fail
      }
    };

    // Start polling
    const interval = setInterval(pollSnapshots, 3000);
    pollSnapshots(); // immediate first poll

    return () => clearInterval(interval);
  }, [teacherId]);

  return (
    <div className="animate-fade-in space-y-4">
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
            <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm font-bold text-red-500">LIVE</span>
          </div>
        </div>
      </div>

      {/* Main Monitor Grid */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">🔴 Live Monitoring — Full View</h3>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-bold text-red-500">LIVE</span>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {feeds.length === 0 ? (
              <div className="col-span-full h-40 flex flex-col items-center justify-center border border-dashed border-[var(--border)] rounded-xl text-[var(--muted)]">
                <span className="text-3xl mb-3">📹</span>
                <p className="text-sm font-semibold mb-1">Waiting for active test sessions...</p>
                <p className="text-xs text-[var(--muted)]">Students will appear here when they start an exam</p>
              </div>
            ) : (
              feeds.map((f) => (
                <div
                  key={f.name}
                  className={`rounded-xl overflow-hidden border-2 ${f.border} transition-all duration-300 hover:scale-[1.02] cursor-pointer`}
                >
                  {/* Camera feed */}
                  <div className="bg-gradient-to-br from-slate-800 to-slate-900 h-36 flex items-center justify-center relative overflow-hidden">
                    {f.snapshot ? (
                      <img src={f.snapshot} alt={f.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-lg font-bold text-white">
                          {f.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                        </div>
                        <span className="text-[10px] text-gray-500 animate-pulse">Loading feed...</span>
                      </div>
                    )}
                    {/* Live indicator */}
                    <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/50 backdrop-blur rounded text-[9px] font-bold text-emerald-400">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                      LIVE
                    </div>
                    {/* Violation badge */}
                    {f.violationCount > 0 && (
                      <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-red-500 rounded text-[9px] font-bold text-white">
                        {f.violationCount}/3 ⚠
                      </div>
                    )}
                  </div>
                  <div className="px-3 py-2.5 bg-[var(--surface2)]">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-[var(--ink)] truncate">{f.name}</span>
                      <span className={`${f.statusColor} whitespace-nowrap`}>{f.status}</span>
                    </div>
                    <div className="text-[10px] text-[var(--muted)] mt-0.5">{f.examTitle}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
