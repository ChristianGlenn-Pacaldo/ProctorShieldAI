"use client";

import { useState, useEffect, useRef } from "react";
import { FileText, Users, AlertTriangle, Brain, Search } from "lucide-react";
import PusherClient from "pusher-js";
import Link from "next/link";

interface StatCard {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}

interface LiveStudent {
  name: string;
  status: string;
  trust: number;
  trustColor: string;
  badge: string;
  flagged?: boolean;
  warning?: boolean;
  joinedAt: Date;
  lastSeen: Date;
}

interface ViolationBreakdownItem {
  type: string;
  count: number;
  pct: number;
  color: string;
}

interface RecentVerdict {
  name: string;
  exam: string;
  violations: string[];
  verdict: string;
  verdictClass: string;
  score: string;
}

export default function TeacherDashboardContent({ teacherId }: { teacherId: string }) {
  const [stats, setStats] = useState({
    totalExams: 0,
    studentsMonitored: 0,
    totalViolations: 0,
    flaggedStudents: 0,
  });

  const [liveStudents, setLiveStudents] = useState<LiveStudent[]>([]);
  const [violationsBreakdown, setViolationsBreakdown] = useState<ViolationBreakdownItem[]>([
    { type: "Tab Switching", count: 0, pct: 0, color: "bg-red-500" },
    { type: "No Face Detected", count: 0, pct: 0, color: "bg-amber-500" },
    { type: "Multiple Faces", count: 0, pct: 0, color: "bg-violet-500" },
    { type: "Looking Away", count: 0, pct: 0, color: "bg-indigo-500" },
    { type: "Device Detected", count: 0, pct: 0, color: "bg-cyan-500" },
    { type: "Screenshot/Copy", count: 0, pct: 0, color: "bg-rose-500" },
    { type: "Audio Anomaly", count: 0, pct: 0, color: "bg-orange-500" },
    { type: "Window Resized", count: 0, pct: 0, color: "bg-yellow-500" },
  ]);

  const [recentVerdicts, setRecentVerdicts] = useState<RecentVerdict[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Keep refs in sync for websocket handlers
  const liveStudentsRef = useRef<LiveStudent[]>([]);
  useEffect(() => {
    liveStudentsRef.current = liveStudents;
  }, [liveStudents]);

  const fetchDashboardData = async () => {
    try {
      const res = await fetch("/api/dashboard/teacher");
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
        setRecentVerdicts(data.recentVerdicts);
        if (data.violationsBreakdown && data.violationsBreakdown.length > 0) {
          setViolationsBreakdown(data.violationsBreakdown);
        }
      }
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Pusher real-time updates
  useEffect(() => {
    if (!teacherId || teacherId === "unknown") return;

    const pusher = new PusherClient(
      process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
      { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1" }
    );

    const channel = pusher.subscribe(`teacher-${teacherId}`);

    // Student Joined Event
    channel.bind("student-joined", (data: any) => {
      console.log("Student joined dashboard feed:", data);
      setLiveStudents((prev) => {
        const exists = prev.some((s) => s.name === data.studentName);
        if (exists) return prev;

        // Increment stats for dynamic display
        setStats((curr) => ({
          ...curr,
          studentsMonitored: curr.studentsMonitored + 1,
        }));

        return [
          ...prev,
          {
            name: data.studentName,
            status: "✓ Active",
            trust: 100,
            trustColor: "text-emerald-500",
            badge: "bg-emerald-500/15 text-emerald-600",
            joinedAt: new Date(),
            lastSeen: new Date(),
          },
        ];
      });
    });

    // New Violation Event
    channel.bind("new-violation", (data: any) => {
      console.log("Violation received on dashboard:", data);

      // Increment general violations counters
      setStats((curr) => ({
        ...curr,
        totalViolations: curr.totalViolations + 1,
      }));

      // Update violation breakdown percentages dynamically
      setViolationsBreakdown((prev) => {
        const typeMapping: Record<string, string> = {
          tab_switch: "Tab Switching",
          tab_switching: "Tab Switching",
          no_face: "No Face Detected",
          multiple_faces: "Multiple Faces",
          looking_away: "Looking Away",
          device_detected: "Device Detected",
          phone_detected: "Device Detected",
          attempted_screenshot: "Screenshot/Copy",
          audio_anomaly: "Audio Anomaly",
          window_resize: "Window Resized",
        };

        const displayType = typeMapping[data.violationType] || "Tab Switching";
        const updated = prev.map((item) => {
          if (item.type === displayType) {
            return { ...item, count: item.count + 1 };
          }
          return item;
        });

        const maxCount = Math.max(...updated.map((i) => i.count), 1);
        return updated.map((item) => ({
          ...item,
          pct: Math.round((item.count / maxCount) * 100),
        }));
      });

      // Update student feed state
      setLiveStudents((prev) => {
        return prev.map((student) => {
          if (student.name === data.studentName) {
            const newTrust = Math.max(0, student.trust - 15);
            let statusText = "⚠ Alert";
            if (data.violationType === "multiple_faces") statusText = "⚠ Multiple Faces";
            if (data.violationType === "no_face") statusText = "⚠ No Face";
            if (data.violationType === "looking_away") statusText = "⚠ Looking Away";
            if (data.violationType === "tab_switch") statusText = "⚠ Tab Switch";
            if (data.violationType === "device_detected") statusText = "📱 Device Detected";
            if (data.violationType === "attempted_screenshot") statusText = "📸 Screenshot/Copy";
            if (data.violationType === "audio_anomaly") statusText = "🎙 Audio Anomaly";
            if (data.violationType === "window_resize") statusText = "📐 Window Resized";

            const trustColor =
              newTrust > 75
                ? "text-emerald-500"
                : newTrust > 50
                ? "text-amber-500"
                : "text-red-500";
            const badge =
              newTrust > 75
                ? "bg-emerald-500/15 text-emerald-600"
                : newTrust > 50
                ? "bg-amber-500/15 text-amber-600"
                : "bg-red-500/15 text-red-500";

            // If trust dips below 50, increment flagged students count once
            if (newTrust <= 50 && student.trust > 50) {
              setStats((curr) => ({
                ...curr,
                flaggedStudents: curr.flaggedStudents + 1,
              }));
            }

            return {
              ...student,
              status: statusText,
              trust: newTrust,
              trustColor,
              badge,
              flagged: newTrust <= 50,
              warning: newTrust <= 75 && newTrust > 50,
              lastSeen: new Date(),
            };
          }
          return student;
        });
      });
    });

    // Student Submitted / Exam Complete Event
    channel.bind("student-submitted", (data: any) => {
      console.log("Student completed exam on dashboard:", data);

      // Remove from live view list
      setLiveStudents((prev) => prev.filter((s) => s.name !== data.studentName));

      // Re-fetch all dynamic table history and stats from database
      fetchDashboardData();
    });

    return () => {
      pusher.unsubscribe(`teacher-${teacherId}`);
      pusher.disconnect();
    };
  }, [teacherId]);

  const statCards: StatCard[] = [
    {
      label: "Total Exams",
      value: stats.totalExams,
      icon: <FileText className="w-5 h-5" />,
      color: "bg-indigo-500/10 text-indigo-500",
    },
    {
      label: "Students Monitored",
      value: stats.studentsMonitored,
      icon: <Users className="w-5 h-5" />,
      color: "bg-emerald-500/10 text-emerald-500",
    },
    {
      label: "Total Violations",
      value: stats.totalViolations,
      icon: <AlertTriangle className="w-5 h-5" />,
      color: "bg-red-500/10 text-red-500",
    },
    {
      label: "Flagged Students",
      value: stats.flaggedStudents,
      icon: <Brain className="w-5 h-5" />,
      color: "bg-amber-500/10 text-amber-500",
    },
  ];

  const filteredVerdicts = recentVerdicts.filter(
    (v) =>
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.exam.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center`}>
                {s.icon}
              </div>
            </div>
            <div className="text-2xl font-extrabold text-[var(--ink)]">{s.value}</div>
            <div className="text-xs text-[var(--muted)] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Live Monitor + Violations Breakdown */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Live Monitor Widget */}
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)]">🔴 Live Monitoring Feed</h3>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] font-bold text-red-500">LIVE</span>
            </div>
          </div>
          <div className="divide-y divide-[var(--border)] min-h-[160px]">
            {liveStudents.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-[var(--muted)] text-center h-[160px]">
                <span className="text-xl mb-1">📹</span>
                <p className="text-xs font-semibold">No active proctored sessions</p>
                <p className="text-[10px] text-[var(--muted2)] mt-0.5">
                  Students taking an exam will appear here in real-time
                </p>
              </div>
            ) : (
              liveStudents.map((s) => (
                <div
                  key={s.name}
                  className={`flex items-center justify-between px-5 py-3.5 transition-all ${
                    s.flagged
                      ? "bg-red-500/5 border-l-2 border-red-500"
                      : s.warning
                      ? "bg-amber-500/5 border-l-2 border-amber-500"
                      : ""
                  }`}
                >
                  <span className="text-sm font-semibold text-[var(--ink)]">{s.name}</span>
                  <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${s.badge}`}>
                    {s.status}
                  </span>
                  <strong className={`text-sm ${s.trustColor}`}>{s.trust}% Trust</strong>
                  <Link
                    href="/dashboard/teacher/monitor"
                    className="text-xs font-bold px-3 py-1.5 bg-[var(--surface2)] text-[var(--ink)] hover:text-indigo-500 border border-[var(--border)] rounded-lg transition-all"
                  >
                    View
                  </Link>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Violations Breakdown */}
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)]">📊 Violation Breakdown</h3>
          </div>
          <div className="p-5 space-y-4">
            {violationsBreakdown.map((v) => (
              <div key={v.type} className="flex items-center gap-3">
                <span className="text-xs text-[var(--muted)] w-28 shrink-0">{v.type}</span>
                <div className="flex-1 h-2 bg-[var(--surface2)] rounded-full overflow-hidden">
                  <div
                    className={`h-full ${v.color} rounded-full transition-all duration-500`}
                    style={{ width: `${v.pct}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-[var(--ink)] w-6 text-right">{v.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI Verdict Summary Table */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">🧠 AI Verdict Summary — Recent Submissions</h3>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
            <input
              type="text"
              placeholder="Search students..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-indigo-500/50 w-48"
            />
          </div>
        </div>
        <div className="overflow-x-auto min-h-[150px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredVerdicts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)] text-center">
              <span className="text-xl mb-1.5">🎓</span>
              <p className="text-xs font-semibold">No recent exam submissions</p>
              <p className="text-[10px] text-[var(--muted2)] mt-0.5">
                Completed student sessions will be displayed here immediately
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Student", "Exam", "Violations Summary", "AI Verdict", "Score", "Action"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredVerdicts.map((v, i) => (
                  <tr key={v.name + i} className="hover:bg-[var(--surface2)] transition-colors">
                    <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{v.name}</td>
                    <td className="px-5 py-3 text-sm text-[var(--muted)]">{v.exam}</td>
                    <td className="px-5 py-3">
                      {v.violations.length > 0 ? (
                        <div className="flex gap-1.5 flex-wrap">
                          {v.violations.map((viol) => (
                            <span key={viol} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-500">
                              {viol}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">None</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${v.verdictClass}`}>
                        {v.verdict}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{v.score}</td>
                    <td className="px-5 py-3">
                      <Link
                        href="/dashboard/teacher/evidence"
                        className="text-xs font-bold text-indigo-500 hover:text-indigo-600 transition-colors"
                      >
                        ▶ Evidence
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
