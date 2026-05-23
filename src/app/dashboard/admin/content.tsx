"use client";

import { useState, useEffect } from "react";
import { Users, FileText, AlertTriangle, Brain } from "lucide-react";
import PusherClient from "pusher-js";
import Link from "next/link";

interface Activity {
  id: string;
  icon: string;
  title: string;
  sub: string;
  type: string;
  timestamp: string;
}

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  roleClass: string;
  status: string;
  statusClass: string;
  joined: string;
}

const activityColors: Record<string, string> = {
  danger: "bg-red-50 dark:bg-red-500/5 border-red-500/15",
  info: "bg-indigo-50 dark:bg-indigo-500/5 border-indigo-500/15",
  success: "bg-emerald-50 dark:bg-emerald-500/5 border-emerald-500/15",
  warning: "bg-amber-50 dark:bg-amber-500/5 border-amber-500/15",
};

export default function AdminDashboardContent() {
  const [stats, setStats] = useState({
    totalUsers: 0, // Mapped to Active Sessions
    totalExams: 0, // Mapped to Exams In-Progress
    totalViolations: 0, // Mapped to Violations (Live)
    aiVerdictsToday: 0, // Mapped to AI Flags
  });

  const [platformBars, setPlatformBars] = useState<any[]>([]);
  const [activityBars, setActivityBars] = useState<any[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch initial dashboard metrics from database (online users, active exams)
  const fetchDashboardData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch("/api/dashboard/admin");
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
        setPlatformBars(data.platformBars);
        setActivityBars(data.activityBars);
        // Pre-populate activities if needed, but start empty to prevent old "data left" from showing
        setActivities(data.activities || []);
        setUsers(data.users);
      }
    } catch (err) {
      console.error("Failed to load admin dashboard data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();

    // Set up Pusher subscription for real-time admin updates
    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774";
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1";

    const pusher = new PusherClient(pusherKey, {
      cluster: pusherCluster,
    });

    const channel = pusher.subscribe("admin-dashboard");

    // Listen for platform activities in real-time
    channel.bind("activity", (data: any) => {
      console.log("Admin received real-time event:", data);

      // 1. Prepend the new activity to the local UI state
      setActivities((prev) => {
        let icon = "⚙️";
        let type = "info";

        if (data.type === "login") {
          icon = "👤";
          type = "info";
        } else if (data.type === "logout") {
          icon = "🚪";
          type = "info";
        } else if (data.type === "register") {
          icon = "🆕";
          type = "success";
        } else if (data.type === "violation") {
          icon = "🚨";
          type = "danger";
        } else if (data.type === "exam-submit") {
          icon = "✅";
          type = "success";
        } else if (data.type === "exam-created") {
          icon = "📝";
          type = "success";
        } else if (data.type === "exam-join") {
          icon = "🎯";
          type = "info";
        }

        const newActivity: Activity = {
          id: Math.random().toString(),
          icon,
          title: data.activity,
          sub: `${data.fullName} (${data.role.toUpperCase()}) · just now`,
          type,
          timestamp: new Date().toISOString(),
        };

        return [newActivity, ...prev.slice(0, 9)];
      });

      // 2. Fetch fresh stats in the background to ensure all DB charts and user tables are 100% accurate
      fetchDashboardData(true);
    });

    return () => {
      pusher.unsubscribe("admin-dashboard");
      pusher.disconnect();
    };
  }, []);

  const statCards = [
    { label: "Active Sessions", value: stats.totalUsers, icon: <Users className="w-5 h-5" />, color: "bg-indigo-500/10 text-indigo-500" },
    { label: "Exams In-Progress", value: stats.totalExams, icon: <FileText className="w-5 h-5" />, color: "bg-emerald-500/10 text-emerald-500" },
    { label: "Violations (Live)", value: stats.totalViolations, icon: <AlertTriangle className="w-5 h-5" />, color: "bg-red-500/10 text-red-500" },
    { label: "AI Flags", value: stats.aiVerdictsToday, icon: <Brain className="w-5 h-5" />, color: "bg-violet-500/10 text-violet-500" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center`}>{s.icon}</div>
            </div>
            {isLoading && s.value === 0 ? (
              <div className="h-8 w-12 bg-white/5 animate-pulse rounded-lg mt-1" />
            ) : (
              <div className="text-2xl font-extrabold text-[var(--ink)]">{s.value}</div>
            )}
            <div className="text-xs text-[var(--muted)] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Platform Analytics + Recent Activity */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Platform Analytics */}
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)]">📈 Platform Analytics (Online)</h3>
          </div>
          <div className="p-5 space-y-4">
            {platformBars.length === 0 && isLoading ? (
              <div className="space-y-4 py-2">
                <div className="h-4 bg-white/5 animate-pulse rounded w-3/4" />
                <div className="h-4 bg-white/5 animate-pulse rounded w-2/3" />
                <div className="h-4 bg-white/5 animate-pulse rounded w-1/2" />
              </div>
            ) : platformBars.length === 0 ? (
              <div className="text-xs text-[var(--muted)] py-4 text-center">No online sessions active</div>
            ) : (
              platformBars.map((b) => (
                <div key={b.label} className="flex items-center gap-3 animate-fade-in">
                  <span className="text-xs text-[var(--muted)] w-24 shrink-0">{b.label}</span>
                  <div className="flex-1 h-2.5 bg-[var(--surface2)] rounded-full overflow-hidden">
                    <div className={`h-full ${b.color} rounded-full transition-all duration-500`} style={{ width: `${b.pct}%` }} />
                  </div>
                  <span className="text-xs font-bold text-[var(--ink)] w-8 text-right">{b.value}</span>
                </div>
              ))
            )}

            <div className="pt-4 mt-4 border-t border-[var(--border)] space-y-4">
              {activityBars.length === 0 && isLoading ? (
                <div className="space-y-4 py-2">
                  <div className="h-4 bg-white/5 animate-pulse rounded w-5/6" />
                  <div className="h-4 bg-white/5 animate-pulse rounded w-4/5" />
                </div>
              ) : (
                activityBars.map((b) => (
                  <div key={b.label} className="flex items-center gap-3 animate-fade-in">
                    <span className="text-xs text-[var(--muted)] w-28 shrink-0">{b.label}</span>
                    <div className="flex-1 h-2.5 bg-[var(--surface2)] rounded-full overflow-hidden">
                      <div className={`h-full ${b.color} rounded-full transition-all duration-500`} style={{ width: `${b.pct}%` }} />
                    </div>
                    <span className="text-xs font-bold text-[var(--ink)] w-8 text-right">{b.value}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--ink)]">🕐 Recent Activity Feed</h3>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-500/15 text-indigo-400 animate-pulse">REAL-TIME</span>
          </div>
          <div className="p-5 space-y-2 max-h-[300px] overflow-y-auto">
            {activities.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-[var(--muted)] text-center h-[160px]">
                <span className="text-xl mb-1">📋</span>
                <p className="text-xs font-semibold">No platform activity yet</p>
                <p className="text-[10px] text-[var(--muted2)] mt-0.5">
                  User registrations, logins, and exam metrics will appear here in real-time
                </p>
              </div>
            ) : (
              activities.map((a) => (
                <div key={a.id} className={`flex items-start gap-3 p-3 rounded-xl border ${activityColors[a.type]} transition-all duration-300 animate-fade-in`}>
                  <span className="text-lg">{a.icon}</span>
                  <div>
                    <div className="text-xs font-semibold text-[var(--ink)]">{a.title}</div>
                    <div className="text-[10px] text-[var(--muted)]">{a.sub}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Online Users */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">👥 Online Users</h3>
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-600">
            {users.length} online
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["User", "Email", "Role", "Status", "Joined", "Actions"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading && users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <div className="inline-block w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-xs text-[var(--muted)]">
                    No users currently online.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-[var(--surface2)] transition-colors animate-fade-in">
                    <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{u.name}</td>
                    <td className="px-5 py-3 text-sm text-[var(--muted)]">{u.email}</td>
                    <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${u.roleClass}`}>{u.role}</span></td>
                    <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${u.statusClass}`}>{u.status}</span></td>
                    <td className="px-5 py-3 text-sm text-[var(--muted)]">{u.joined}</td>
                    <td className="px-5 py-3 flex gap-2">
                      <button className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500 cursor-pointer">Edit</button>
                      {u.status === "Suspended" ? (
                        <button className="text-xs font-semibold text-emerald-500 hover:text-emerald-600 cursor-pointer">Restore</button>
                      ) : (
                        <button className="text-xs font-semibold text-red-400 hover:text-red-500 cursor-pointer">Suspend</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
