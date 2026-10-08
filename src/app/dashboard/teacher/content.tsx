"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FileText, Users, AlertTriangle, Brain, Search, Crown, ArrowRight, Zap } from "lucide-react";
import PusherClient from "pusher-js";
import Link from "next/link";
import ProctorShieldCreateHub from "@/components/teacher/proctorshield-create-hub";
import { useUserSessionWork, UserSessionReauthentication } from "@/components/user-session-lifecycle";

interface StatCard {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}

interface ViolationBreakdownItem {
  type: string;
  count: number;
  pct: number;
  color: string;
}

interface RecentVerdict {
  name: string;
  quiz: string;
  violations: string[];
  verdict: string;
  verdictClass: string;
  score: string;
}

export default function TeacherDashboardContent({
  teacherId,
  isSubscribed,
  teacherName = "Teacher",
}: {
  teacherId: string;
  isSubscribed: boolean;
  teacherName?: string;
}) {
  const [stats, setStats] = useState({
    totalQuizzes: 0,
    studentsMonitored: 0,
    totalViolations: 0,
    flaggedStudents: 0,
  });
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
  const [hasLoadedDashboard, setHasLoadedDashboard] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { work, loss } = useUserSessionWork(() => {
    setStats({ totalQuizzes: 0, studentsMonitored: 0, totalViolations: 0, flaggedStudents: 0 });
    setRecentVerdicts([]);
    setViolationsBreakdown([]);
    setSearchQuery("");
    setHasLoadedDashboard(false);
    setLoadError(null);
    setIsLoading(false);
  });
  const refreshSequence = useRef(0);

  const fetchDashboardData = useCallback(async () => {
    const request = work.beginRequest();
    if (!request) return;
    const refresh = ++refreshSequence.current;
    try {
      const res = await fetch("/api/dashboard/teacher", { signal: request.controller.signal, cache: "no-store" });
      if (!await work.acceptResponse(res, request)) return;
      if (!res.ok) throw new Error(`Dashboard request failed (${res.status})`);
      const data = await res.json();
      if (!work.isCurrent(request.generation) || request.controller.signal.aborted || refresh !== refreshSequence.current) return;
      setStats(data.stats);
      setRecentVerdicts(data.recentVerdicts);
      if (data.violationsBreakdown && data.violationsBreakdown.length > 0) {
        setViolationsBreakdown(data.violationsBreakdown);
      }
      setHasLoadedDashboard(true);
      setLoadError(null);
    } catch (err) {
      if (!work.isCurrent(request.generation) || request.controller.signal.aborted || refresh !== refreshSequence.current) return;
      console.error("Failed to load dashboard data:", err);
      setLoadError("Could not load the Teacher Dashboard. Please try again.");
    } finally {
      if (work.isCurrent(request.generation) && refresh === refreshSequence.current) setIsLoading(false);
      work.finishRequest(request.controller);
    }
  }, [work]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Pusher real-time updates
  useEffect(() => {
    const generation = work.capture();
    if (!work.isCurrent(generation)) return;
    if (!isSubscribed || !teacherId || teacherId === "unknown") return;

    const pusher = new PusherClient(
      process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
      { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1", authEndpoint: "/api/pusher/auth?scope=user&role=teacher" }
    );

    const channel = pusher.subscribe(`private-teacher-${teacherId}`);
    channel.bind("pusher:subscription_error", (error: { status?: number }) => {
      if (work.isCurrent(generation) && error.status === 401) work.reportLoss(401);
    });

    // Student Joined Event
    channel.bind("student-joined", () => {
      if (!work.isCurrent(generation)) return;
      fetchDashboardData();
    });

    // New Violation Event
    channel.bind("new-violation", (data: any) => {
      if (!work.isCurrent(generation)) return;

      // Increment general violations counters
      setStats((curr) => work.isCurrent(generation) ? ({
        ...curr,
        totalViolations: curr.totalViolations + 1,
      }) : curr);

      // Update violation breakdown percentages dynamically
      setViolationsBreakdown((prev) => {
        if (!work.isCurrent(generation)) return prev;
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
    });

    // Student Submitted / Quiz Complete Event
    channel.bind("student-submitted", () => {
      if (!work.isCurrent(generation)) return;

      // Re-fetch all dynamic table history and stats from database
      fetchDashboardData();
    });

    let stopped = false;
    return work.addCleanup(() => {
      if (stopped) return;
      stopped = true;
      channel.unbind_all();
      pusher.unsubscribe(`private-teacher-${teacherId}`);
      pusher.disconnect();
    });
  }, [isSubscribed, teacherId, work, fetchDashboardData]);

  if (loss) return <UserSessionReauthentication status={loss} />;

  const statCards = [
    {
      label: "Total Quizzes",
      value: stats.totalQuizzes,
      icon: <FileText className="w-5 h-5" />,
      color: "bg-blue-600/10 text-blue-600 dark:text-blue-400 border border-blue-500/20",
      sub: "AI & Manual Quizzes",
      badge: "ACTIVE",
    },
    {
      label: "Unique Quiz Students",
      value: stats.studentsMonitored,
      icon: <Users className="w-5 h-5" />,
      color: "bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
      sub: "All-time across your quizzes",
      badge: "ALL-TIME",
    },
    {
      label: "Total Violations",
      value: stats.totalViolations,
      icon: <AlertTriangle className="w-5 h-5" />,
      color: "bg-rose-600/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
      sub: "Auto CCTV Evidence Logs",
      badge: "AUDIT",
    },
    {
      label: "Flagged Students",
      value: stats.flaggedStudents,
      icon: <Brain className="w-5 h-5" />,
      color: "bg-amber-600/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
      sub: "Gemini Forensic Alerts",
      badge: "AI FLAGS",
    },
  ];

  const filteredVerdicts = recentVerdicts.filter(
    (v) =>
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.quiz.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const loadFailure = loadError && (
    <div role="alert" className="flex items-center justify-between gap-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-600 dark:text-rose-400">
      <span>{loadError}</span>
      <button type="button" onClick={() => void fetchDashboardData()} className="font-bold underline">Retry</button>
    </div>
  );

  if (isLoading && !hasLoadedDashboard) {
    return <div className="flex h-64 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>;
  }

  if (!hasLoadedDashboard) return loadFailure;

  return (
    <div className="space-y-6 animate-fade-in">
      {loadFailure}
      {/* ProctorShield Activity Creation Hub */}
      <ProctorShieldCreateHub
        teacherName={teacherName}
        isSubscribed={isSubscribed}
        onOpenCreateQuiz={(mode = "proctored") => {
          window.location.href = `/dashboard/teacher/quizzes?create=true&mode=${mode}`;
        }}
        onOpenAiGenerator={() => {
          if (!isSubscribed) {
            window.location.href = "/dashboard/teacher/billing";
            return;
          }
          window.location.href = "/dashboard/teacher/quizzes?ai=true";
        }}
        onOpenArena={() => {
          if (!isSubscribed) {
            window.location.href = "/dashboard/teacher/billing";
            return;
          }
          window.location.href = "/dashboard/teacher/playground";
        }}
        onRequirePro={() => {
          window.location.href = "/dashboard/teacher/billing";
        }}
      />

      {/* Power Arena Quick Action Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-blue-500/10 p-4 sm:p-5 backdrop-blur-xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg shadow-amber-500/5 transition-all hover:border-amber-500/50">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-2xl shadow-md shadow-amber-500/30 shrink-0">
            ⚔️
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-sm sm:text-base text-[var(--ink)] font-[family-name:var(--font-display)]">
                Battle Power Arena Mode
              </h3>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-500 border border-amber-500/30">
                PRO ARENA
              </span>
            </div>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Host live competitive classroom quizzes with active student power-ups (Meteors, Blizzards, Shields).
            </p>
          </div>
        </div>

        <Link
          href={isSubscribed ? "/dashboard/teacher/playground" : "/dashboard/teacher/billing"}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs font-extrabold text-white flex items-center justify-center gap-2 transition-all shadow-md shadow-amber-500/25 shrink-0 active:scale-95"
          style={{ background: "linear-gradient(110deg, #d97706 0%, #f59e0b 50%, #ea580c 100%)" }}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>{isSubscribed ? "Launch Power Arena" : "Unlock Power Arena"}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <div
            key={s.label}
            className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 shadow-xs transition-all hover:border-blue-500/40 hover:shadow-lg hover:shadow-blue-500/5 group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform`}>
                {s.icon}
              </div>
              <span className="text-[9px] font-mono font-bold tracking-wider px-2 py-0.5 rounded-full bg-[var(--surface2)] text-[var(--muted)] border border-[var(--border)]">
                {s.badge}
              </span>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-[var(--ink)] tracking-tight font-[family-name:var(--font-display)]">
              {s.value}
            </div>
            <div className="text-xs font-bold text-[var(--ink2)] mt-0.5">{s.label}</div>
            <div className="text-[10px] text-[var(--muted)] mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Violations Breakdown */}
      <div className="grid gap-4">
        {/* Violations Breakdown */}
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-xs">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">📊 Violation Breakdown</h3>
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
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-xs">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">🧠 AI Verdict Summary — Recent Submissions</h3>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
            <input
              type="text"
              placeholder="Search students..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-blue-500 w-48"
            />
          </div>
        </div>
        <div className="overflow-x-auto min-h-[150px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredVerdicts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)] text-center">
              <span className="text-xl mb-1.5">🎓</span>
              <p className="text-xs font-semibold">No recent quiz submissions</p>
              <p className="text-[10px] text-[var(--muted2)] mt-0.5">
                Completed student sessions will be displayed here immediately
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface2)]/50">
                  {["Student", "Quiz", "Violations Summary", "AI Verdict", "Score", "Action"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredVerdicts.map((v, i) => (
                  <tr key={v.name + i} className="hover:bg-[var(--surface2)]/60 transition-colors">
                    <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{v.name}</td>
                    <td className="px-5 py-3 text-sm text-[var(--muted)]">{v.quiz}</td>
                    <td className="px-5 py-3">
                      {v.violations.length > 0 ? (
                        <div className="flex gap-1.5 flex-wrap">
                          {v.violations.map((viol) => (
                            <span key={viol} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
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
                        className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline transition-colors"
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
