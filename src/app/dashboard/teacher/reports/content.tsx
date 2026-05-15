"use client";

const bars = [
  { label: "✓ Clean (Trust > 90%)", value: 106, pct: 75, color: "bg-emerald-500" },
  { label: "⚠ Suspicious (70-90%)", value: 28, pct: 20, color: "bg-amber-500" },
  { label: "🚫 High Risk (< 70%)", value: 8, pct: 5, color: "bg-red-500" },
];

export default function ReportsContent() {
  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">🧠 Class Integrity Overview</h3>
        </div>
        <div className="p-5 space-y-4">
          {bars.map((b) => (
            <div key={b.label} className="flex items-center gap-3">
              <span className="text-xs text-[var(--muted)] w-44 shrink-0">{b.label}</span>
              <div className="flex-1 h-2.5 bg-[var(--surface2)] rounded-full overflow-hidden">
                <div className={`h-full ${b.color} rounded-full transition-all duration-700`} style={{ width: `${b.pct}%` }} />
              </div>
              <span className="text-xs font-bold text-[var(--ink)] w-8 text-right">{b.value}</span>
            </div>
          ))}
          <p className="mt-5 text-xs text-[var(--muted)] leading-relaxed">
            The AI Proctoring system automatically tags students based on the frequency and severity of flagged incidents. Review High Risk students in the Evidence Replay tab.
          </p>
        </div>
      </div>
    </div>
  );
}
