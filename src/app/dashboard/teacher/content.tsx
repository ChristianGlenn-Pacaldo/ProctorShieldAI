"use client";

import { FileText, Users, AlertTriangle, Brain } from "lucide-react";

const stats = [
  { label: "Total Exams", value: 8, change: "+1", icon: <FileText className="w-5 h-5" />, color: "bg-indigo-500/10 text-indigo-500" },
  { label: "Students Monitored", value: 142, icon: <Users className="w-5 h-5" />, color: "bg-emerald-500/10 text-emerald-500" },
  { label: "Total Violations", value: 23, change: "+5", icon: <AlertTriangle className="w-5 h-5" />, color: "bg-red-500/10 text-red-500", changeDanger: true },
  { label: "Flagged Students", value: 7, icon: <Brain className="w-5 h-5" />, color: "bg-amber-500/10 text-amber-500" },
];

const liveStudents = [
  { name: "Juan Dela Cruz", status: "✓ Monitoring", trust: 98, trustColor: "text-emerald-500", badge: "bg-emerald-500/15 text-emerald-600" },
  { name: "Ethan Reyes", status: "⚠ Tab Switch", trust: 64, trustColor: "text-red-500", badge: "bg-red-500/15 text-red-500", flagged: true },
  { name: "Maria Santos", status: "✓ Monitoring", trust: 95, trustColor: "text-emerald-500", badge: "bg-emerald-500/15 text-emerald-600" },
  { name: "Carlo Mendoza", status: "⚠ Multi-face", trust: 71, trustColor: "text-amber-500", badge: "bg-amber-500/15 text-amber-600", warning: true },
];

const violations = [
  { type: "Tab Switching", count: 18, pct: 72, color: "bg-red-500" },
  { type: "No Face Detected", count: 12, pct: 48, color: "bg-amber-500" },
  { type: "Multiple Faces", count: 8, pct: 32, color: "bg-violet-500" },
  { type: "Looking Away", count: 6, pct: 24, color: "bg-indigo-500" },
  { type: "Audio Anomaly", count: 3, pct: 12, color: "bg-cyan-500" },
];

const verdicts = [
  { name: "Ethan Reyes", exam: "CS101 Quiz 2", violations: ["Tab ×3", "Phone ×1"], verdict: "🚫 Cheated (92%)", verdictClass: "bg-red-500/15 text-red-500", score: "89%" },
  { name: "Carlo Mendoza", exam: "CS101 Quiz 2", violations: ["Multi-face ×2"], verdict: "⚠ Suspicious (67%)", verdictClass: "bg-amber-500/15 text-amber-500", score: "76%" },
  { name: "Juan Dela Cruz", exam: "CS101 Quiz 2", violations: [], verdict: "✓ Clean (3%)", verdictClass: "bg-emerald-500/15 text-emerald-600", score: "92%" },
];

export default function TeacherDashboardContent() {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center`}>
                {s.icon}
              </div>
              {s.change && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.changeDanger ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"}`}>
                  {s.change}
                </span>
              )}
            </div>
            <div className="text-2xl font-extrabold text-[var(--ink)]">{s.value}</div>
            <div className="text-xs text-[var(--muted)] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Live Monitor + Violations */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Live Monitor */}
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)]">🔴 Live Monitoring — CS101 Midterm</h3>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] font-bold text-red-500">LIVE</span>
            </div>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {liveStudents.map((s) => (
              <div
                key={s.name}
                className={`flex items-center justify-between px-5 py-3 ${s.flagged ? "bg-red-50 dark:bg-red-500/5" : s.warning ? "bg-amber-50 dark:bg-amber-500/5" : ""}`}
              >
                <span className="text-sm font-semibold text-[var(--ink)]">{s.name}</span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${s.badge}`}>
                  {s.status}
                </span>
                <strong className={`text-sm ${s.trustColor}`}>{s.trust}%</strong>
                <button className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${s.flagged || s.warning ? "bg-red-500 text-white hover:bg-red-600" : "text-[var(--muted)] hover:bg-[var(--surface2)]"}`}>
                  {s.flagged || s.warning ? "Review" : "View"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Violation Breakdown */}
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)]">📊 Violation Breakdown</h3>
          </div>
          <div className="p-5 space-y-4">
            {violations.map((v) => (
              <div key={v.type} className="flex items-center gap-3">
                <span className="text-xs text-[var(--muted)] w-28 shrink-0">{v.type}</span>
                <div className="flex-1 h-2 bg-[var(--surface2)] rounded-full overflow-hidden">
                  <div className={`h-full ${v.color} rounded-full transition-all`} style={{ width: `${v.pct}%` }} />
                </div>
                <span className="text-xs font-bold text-[var(--ink)] w-6 text-right">{v.count}</span>
              </div>
            ))}

            <div className="mt-5 pt-4 border-t border-[var(--border)]">
              <div className="text-xs font-bold text-[var(--ink)] mb-3">AI Alerts Today</div>
              <div className="space-y-2">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/10">
                  <span>🚨</span>
                  <div>
                    <div className="text-xs font-semibold text-[var(--ink)]">Ethan Reyes — Phone Detected</div>
                    <div className="text-[10px] text-[var(--muted)]">14:23:45 · CS101 Midterm · Confidence: 94%</div>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
                  <span>⚠️</span>
                  <div>
                    <div className="text-xs font-semibold text-[var(--ink)]">Carlo Mendoza — Multiple Faces</div>
                    <div className="text-[10px] text-[var(--muted)]">14:31:12 · CS101 Midterm · Confidence: 87%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI Verdict Summary */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">🧠 AI Verdict Summary — Recent Exams</h3>
          <input
            type="text"
            placeholder="Search students..."
            className="px-3 py-1.5 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-indigo-500/50 w-48"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Student", "Exam", "Violations", "AI Verdict", "Score", "Action"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {verdicts.map((v) => (
                <tr key={v.name} className="hover:bg-[var(--surface2)] transition-colors">
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
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${v.verdictClass}`}>
                      {v.verdict}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{v.score}</td>
                  <td className="px-5 py-3">
                    <button className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500 transition-colors">
                      ▶ Replay
                    </button>
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
