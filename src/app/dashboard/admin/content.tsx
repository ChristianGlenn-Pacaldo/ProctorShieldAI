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
  plan: string;
  status: string;
  statusClass: string;
  isOnline: boolean;
  subscription: string;
  subClass: string;
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
    totalQuizzes: 0, // Mapped to Quizzes In-Progress
    totalViolations: 0, // Mapped to Violations (Live)
    aiVerdictsToday: 0, // Mapped to AI Flags
  });

  const [platformBars, setPlatformBars] = useState<any[]>([]);
  const [activityBars, setActivityBars] = useState<any[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const handleToggleStatus = async (userId: string, currentStatus: string) => {
    const newStatus = currentStatus === "Suspended" ? "active" : "suspended";
    setStatusError(null);
    setUpdatingUserId(userId);
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) {
        setStatusError("Could not update user status. Changes were not saved.");
        await fetchDashboardData(true);
        return;
      }
      setUsers((previous) => previous.map((user) => user.id === userId ? {
        ...user,
        status: newStatus.charAt(0).toUpperCase() + newStatus.slice(1),
        statusClass: newStatus === "suspended"
          ? "bg-red-500/10 text-red-500"
          : "bg-emerald-500/10 text-emerald-600",
      } : user));
      await fetchDashboardData(true);
    } catch (e) {
      console.error("Failed to toggle status", e);
      setStatusError("Could not update user status. Changes were not saved.");
      await fetchDashboardData(true);
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setPlanError(null);
    setIsSaving(true);
    try {
      const response = await fetch(`/api/users/${editingUser.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: editingUser.plan }),
      });
      if (!response.ok) {
        setPlanError("Could not save subscription. Changes were not saved.");
        await fetchDashboardData(true);
        return;
      }
      setUsers((previous) => previous.map((user) => user.id === editingUser.id ? {
        ...user,
        plan: editingUser.plan,
      } : user));
      setEditingUser(null);
      await fetchDashboardData(true);
    } catch (e) {
      console.error("Failed to update plan", e);
      setPlanError("Could not save subscription. Changes were not saved.");
      await fetchDashboardData(true);
    } finally {
      setIsSaving(false);
    }
  };

  // Fetch initial dashboard metrics from database (online users, active quizzes)
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
      authEndpoint: "/api/pusher/auth",
    });

    const channel = pusher.subscribe("private-admin-dashboard");

    // Listen for platform activities in real-time
    channel.bind("activity", (data: any) => {

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
        } else if (data.type === "quiz-submit") {
          icon = "✅";
          type = "success";
        } else if (data.type === "quiz-created") {
          icon = "📝";
          type = "success";
        } else if (data.type === "quiz-join") {
          icon = "🎯";
          type = "info";
        } else if (data.type === "subscription") {
          icon = "💎";
          type = "warning";
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
      pusher.unsubscribe("private-admin-dashboard");
      pusher.disconnect();
    };
  }, []);

  const statCards = [
    {
      label: "Active Sessions",
      value: stats.totalUsers,
      icon: <Users className="w-5 h-5" />,
      color: "bg-blue-600/10 text-blue-600 dark:text-blue-400 border border-blue-500/20",
      badge: "LIVE",
      sub: "Active Classroom Users",
    },
    {
      label: "Quizzes In-Progress",
      value: stats.totalQuizzes,
      icon: <FileText className="w-5 h-5" />,
      color: "bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
      badge: "ACTIVE",
      sub: "Live Running Quizzes",
    },
    {
      label: "Violations (Live)",
      value: stats.totalViolations,
      icon: <AlertTriangle className="w-5 h-5" />,
      color: "bg-rose-600/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
      badge: "SECURITY",
      sub: "CCTV Evidence Captures",
    },
    {
      label: "AI Flags Today",
      value: stats.aiVerdictsToday,
      icon: <Brain className="w-5 h-5" />,
      color: "bg-violet-600/10 text-violet-600 dark:text-violet-400 border border-violet-500/20",
      badge: "GEMINI",
      sub: "Forensic Risk Analyses",
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats */}
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
            {isLoading && s.value === 0 ? (
              <div className="h-8 w-16 bg-[var(--surface2)] animate-pulse rounded-lg mt-1" />
            ) : (
              <div className="text-2xl sm:text-3xl font-black text-[var(--ink)] tracking-tight font-[family-name:var(--font-display)]">
                {s.value}
              </div>
            )}
            <div className="text-xs font-bold text-[var(--ink2)] mt-0.5">{s.label}</div>
            <div className="text-[10px] text-[var(--muted)] mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Platform Analytics + Recent Activity */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Platform Analytics */}
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-xs">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">📈 Platform Demographics</h3>
          </div>
          <div className="p-5 space-y-4">
            {platformBars.length === 0 && isLoading ? (
              <div className="space-y-4 py-2">
                <div className="h-4 bg-[var(--surface2)] animate-pulse rounded w-3/4" />
                <div className="h-4 bg-[var(--surface2)] animate-pulse rounded w-2/3" />
                <div className="h-4 bg-[var(--surface2)] animate-pulse rounded w-1/2" />
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
                  <div className="h-4 bg-[var(--surface2)] animate-pulse rounded w-5/6" />
                  <div className="h-4 bg-[var(--surface2)] animate-pulse rounded w-4/5" />
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
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-xs">
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">🕐 Recent Activity Feed</h3>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-600/15 text-blue-600 dark:text-blue-400 rounded-full animate-pulse">REAL-TIME</span>
          </div>
          <div className="p-5 space-y-2 max-h-[300px] overflow-y-auto">
            {activities.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-[var(--muted)] text-center h-[160px]">
                <span className="text-xl mb-1">📋</span>
                <p className="text-xs font-semibold">No platform activity yet</p>
                <p className="text-[10px] text-[var(--muted2)] mt-0.5">
                  User registrations, logins, and quiz metrics will appear here in real-time
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

      {/* All Platform Users */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-xs">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">👥 Platform Users</h3>
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-blue-600/15 text-blue-600 dark:text-blue-400">
            {users.length} registered
          </span>
        </div>
        {statusError && <p role="alert" className="px-5 py-3 text-xs font-semibold text-rose-500">{statusError}</p>}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface2)]/50">
                {["User", "Email", "Role", "Subscription", "Status", "Joined", "Actions"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading && users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-xs text-[var(--muted)]">
                    No users registered yet.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-[var(--surface2)]/60 transition-colors animate-fade-in">
                    <td className="px-5 py-3 flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${u.isOnline ? "bg-emerald-500 shadow-[0_0_8px_rgba(5,150,105,0.5)]" : "bg-[var(--border)]"}`} title={u.isOnline ? "Online" : "Offline"} />
                      <span className="text-sm font-semibold text-[var(--ink)]">{u.name}</span>
                    </td>
                    <td className="px-5 py-3 text-sm text-[var(--muted)]">{u.email}</td>
                    <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${u.roleClass}`}>{u.role}</span></td>
                    <td className="px-5 py-3">
                      {u.plan === "Premium" ? (
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">💎 Premium</span>
                      ) : u.plan === "Free Tier" ? (
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-500/10 text-slate-500 border border-slate-500/20">Free Tier</span>
                      ) : (
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/5 text-[var(--muted)]">-</span>
                      )}
                    </td>
                    <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${u.statusClass}`}>{u.status}</span></td>
                    <td className="px-5 py-3 text-sm text-[var(--muted)]">{u.joined}</td>
                    <td className="px-5 py-3 flex gap-2">
                      {u.role === "Teacher" && (
                        <button 
                          onClick={() => { setPlanError(null); setEditingUser(u); }}
                          className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500 cursor-pointer"
                        >
                          Edit
                        </button>
                      )}
                      {u.status === "Suspended" ? (
                        <button disabled={updatingUserId === u.id} onClick={() => handleToggleStatus(u.id, u.status)} className="text-xs font-semibold text-emerald-500 hover:text-emerald-600 cursor-pointer disabled:opacity-50">Restore</button>
                      ) : (
                        <button disabled={updatingUserId === u.id} onClick={() => handleToggleStatus(u.id, u.status)} className="text-xs font-semibold text-red-400 hover:text-red-500 cursor-pointer disabled:opacity-50">Suspend</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {/* Edit User Modal */}
      {editingUser && (
        <div className="app-modal-backdrop bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="app-modal-panel bg-[var(--surface)] border border-[var(--border)] p-4 rounded-2xl max-w-md shadow-2xl relative overflow-y-auto sm:p-6">
            <h2 className="text-lg font-bold text-[var(--ink)] mb-1">Edit Subscription</h2>
            <p className="text-xs text-[var(--muted)] mb-5">Change the subscription plan for {editingUser.name}</p>
            
            <form onSubmit={handleSavePlan}>
              <div className="mb-4">
                <label className="text-xs font-semibold text-[var(--muted)] block mb-1.5">Subscription Plan</label>
                <select 
                  className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--ink)] focus:outline-none focus:border-indigo-500/50"
                  value={editingUser.plan}
                  onChange={(e) => setEditingUser({ ...editingUser, plan: e.target.value })}
                >
                  <option value="Premium">💎 Premium</option>
                  <option value="Free Tier">Free Tier</option>
                </select>
              </div>
              {planError && <p role="alert" className="text-xs font-semibold text-rose-500">{planError}</p>}
              
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                <button 
                  type="button" 
                  onClick={() => setEditingUser(null)}
                  className="w-full px-4 py-2 rounded-xl text-sm font-semibold text-[var(--muted)] hover:bg-[var(--surface2)] transition-colors sm:w-auto"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isSaving}
                  className="w-full px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 sm:w-auto"
                >
                  {isSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
