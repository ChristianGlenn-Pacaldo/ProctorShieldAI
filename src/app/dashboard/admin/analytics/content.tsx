"use client";

export default function AnalyticsContent() {
  return (
    <div className="animate-fade-in grid lg:grid-cols-2 gap-4">
      {/* System Growth */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">📈 System Growth</h3>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--muted)] w-36 shrink-0">New Users (May)</span>
            <div className="flex-1 h-2.5 bg-[var(--surface2)] rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full" style={{ width: "85%" }} />
            </div>
            <span className="text-xs font-bold text-[var(--ink)] w-8 text-right">+42</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--muted)] w-36 shrink-0">Exams Created (May)</span>
            <div className="flex-1 h-2.5 bg-[var(--surface2)] rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: "65%" }} />
            </div>
            <span className="text-xs font-bold text-[var(--ink)] w-8 text-right">+15</span>
          </div>
        </div>
      </div>

      {/* AI Intervention Rate */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">🛡️ AI Intervention Rate</h3>
        </div>
        <div className="p-5">
          <div className="text-4xl font-extrabold text-[var(--ink)] mb-2">18.4%</div>
          <p className="text-sm text-[var(--muted)] mb-5">Percentage of total exams requiring AI flagging this month.</p>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--muted)] w-28 shrink-0">Clean Sessions</span>
              <div className="flex-1 h-2.5 bg-[var(--surface2)] rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: "81.6%" }} />
              </div>
              <span className="text-xs font-bold text-[var(--ink)] w-12 text-right">81.6%</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--muted)] w-28 shrink-0">Flagged Sessions</span>
              <div className="flex-1 h-2.5 bg-[var(--surface2)] rounded-full overflow-hidden">
                <div className="h-full bg-red-500 rounded-full" style={{ width: "18.4%" }} />
              </div>
              <span className="text-xs font-bold text-[var(--ink)] w-12 text-right">18.4%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
