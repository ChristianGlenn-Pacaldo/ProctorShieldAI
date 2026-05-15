"use client";

import { Users, FileText, AlertTriangle, Brain } from "lucide-react";

const stats = [
  { label: "Total Users", value: 248, change: "+12", icon: <Users className="w-5 h-5" />, color: "bg-indigo-500/10 text-indigo-500" },
  { label: "Total Exams", value: 89, icon: <FileText className="w-5 h-5" />, color: "bg-emerald-500/10 text-emerald-500" },
  { label: "Violations Logged", value: 156, change: "+18", icon: <AlertTriangle className="w-5 h-5" />, color: "bg-red-500/10 text-red-500", changeDanger: true },
  { label: "AI Verdicts Today", value: 42, icon: <Brain className="w-5 h-5" />, color: "bg-violet-500/10 text-violet-500" },
];

const platformBars = [
  { label: "Students", value: 194, pct: 78, color: "bg-indigo-500" },
  { label: "Teachers", value: 51, pct: 20, color: "bg-violet-500" },
  { label: "Admins", value: 3, pct: 2, color: "bg-rose-500" },
];

const activityBars = [
  { label: "Exams This Week", value: 34, pct: 45, color: "bg-emerald-500" },
  { label: "AI Flags", value: 14, pct: 18, color: "bg-red-500" },
];

const activities = [
  { icon: "🚨", title: "High-risk violation detected", sub: "Ethan Reyes · Phone detected · 2 min ago", type: "danger" },
  { icon: "👤", title: "New teacher registered", sub: "Prof. Ana Lim · ana@demo.com · 15 min ago", type: "info" },
  { icon: "✅", title: "Exam completed", sub: "CS101 Midterm · 45 students · 1 hour ago", type: "success" },
  { icon: "⚠️", title: "System storage at 78%", sub: "Consider archiving old evidence files", type: "warning" },
];

const users = [
  { name: "Juan Dela Cruz", email: "student@demo.com", role: "Student", roleClass: "bg-indigo-500/10 text-indigo-600", status: "Active", statusClass: "bg-emerald-500/10 text-emerald-600", joined: "Mar 15, 2025" },
  { name: "Sir Ramos", email: "teacher@demo.com", role: "Teacher", roleClass: "bg-violet-500/10 text-violet-600", status: "Active", statusClass: "bg-emerald-500/10 text-emerald-600", joined: "Feb 8, 2025" },
  { name: "Maria Santos", email: "maria@demo.com", role: "Student", roleClass: "bg-indigo-500/10 text-indigo-600", status: "Active", statusClass: "bg-emerald-500/10 text-emerald-600", joined: "Apr 2, 2025" },
  { name: "Ethan Reyes", email: "ethan@demo.com", role: "Student", roleClass: "bg-indigo-500/10 text-indigo-600", status: "Suspended", statusClass: "bg-red-500/10 text-red-500", joined: "Jan 20, 2025" },
];

const activityColors: Record<string, string> = {
  danger: "bg-red-50 dark:bg-red-500/5 border-red-500/15",
  info: "bg-indigo-50 dark:bg-indigo-500/5 border-indigo-500/15",
  success: "bg-emerald-50 dark:bg-emerald-500/5 border-emerald-500/15",
  warning: "bg-amber-50 dark:bg-amber-500/5 border-amber-500/15",
};

export default function AdminDashboardContent() {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center`}>{s.icon}</div>
              {s.change && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.changeDanger ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"}`}>{s.change}</span>
              )}
            </div>
            <div className="text-2xl font-extrabold text-[var(--ink)]">{s.value}</div>
            <div className="text-xs text-[var(--muted)] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Platform Analytics + Recent Activity */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)]">📈 Platform Analytics</h3>
          </div>
          <div className="p-5 space-y-4">
            {platformBars.map((b) => (
              <div key={b.label} className="flex items-center gap-3">
                <span className="text-xs text-[var(--muted)] w-20 shrink-0">{b.label}</span>
                <div className="flex-1 h-2.5 bg-[var(--surface2)] rounded-full overflow-hidden">
                  <div className={`h-full ${b.color} rounded-full`} style={{ width: `${b.pct}%` }} />
                </div>
                <span className="text-xs font-bold text-[var(--ink)] w-8 text-right">{b.value}</span>
              </div>
            ))}
            <div className="pt-4 mt-4 border-t border-[var(--border)] space-y-4">
              {activityBars.map((b) => (
                <div key={b.label} className="flex items-center gap-3">
                  <span className="text-xs text-[var(--muted)] w-28 shrink-0">{b.label}</span>
                  <div className="flex-1 h-2.5 bg-[var(--surface2)] rounded-full overflow-hidden">
                    <div className={`h-full ${b.color} rounded-full`} style={{ width: `${b.pct}%` }} />
                  </div>
                  <span className="text-xs font-bold text-[var(--ink)] w-8 text-right">{b.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)]">🕐 Recent Activity</h3>
          </div>
          <div className="p-5 space-y-2">
            {activities.map((a) => (
              <div key={a.title} className={`flex items-start gap-3 p-3 rounded-xl border ${activityColors[a.type]}`}>
                <span>{a.icon}</span>
                <div>
                  <div className="text-xs font-semibold text-[var(--ink)]">{a.title}</div>
                  <div className="text-[10px] text-[var(--muted)]">{a.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* User Management */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">👥 User Management</h3>
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-600">248 total</span>
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
              {users.map((u) => (
                <tr key={u.email} className="hover:bg-[var(--surface2)] transition-colors">
                  <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{u.name}</td>
                  <td className="px-5 py-3 text-sm text-[var(--muted)]">{u.email}</td>
                  <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${u.roleClass}`}>{u.role}</span></td>
                  <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${u.statusClass}`}>{u.status}</span></td>
                  <td className="px-5 py-3 text-sm text-[var(--muted)]">{u.joined}</td>
                  <td className="px-5 py-3 flex gap-2">
                    <button className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500">Edit</button>
                    {u.status === "Suspended" ? (
                      <button className="text-xs font-semibold text-emerald-500 hover:text-emerald-600">Restore</button>
                    ) : (
                      <button className="text-xs font-semibold text-red-400 hover:text-red-500">Suspend</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
