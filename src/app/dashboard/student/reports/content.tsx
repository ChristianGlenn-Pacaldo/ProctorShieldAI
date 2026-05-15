"use client";

const reports = [
  {
    exam: "MATH201 Quiz 2 (May 2, 2025)",
    verdict: "⚠ Suspicious",
    verdictClass: "bg-amber-500/15 text-amber-600",
    desc: "The system flagged some unusual activities during this session. Your instructor has been notified for manual review.",
    chips: [
      { label: "Tab Switch ×2", color: "bg-amber-500/10 text-amber-600" },
      { label: "Looking Away ×1", color: "bg-indigo-500/10 text-indigo-600" },
    ],
  },
  {
    exam: "CS101 Quiz 2 (May 5, 2025)",
    verdict: "✓ Clean",
    verdictClass: "bg-emerald-500/15 text-emerald-600",
    desc: "No anomalies detected. Great job maintaining an optimal testing environment!",
    chips: [],
  },
];

export default function ReportsContent() {
  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">📄 My AI Integrity Reports</h3>
        </div>
        <div className="p-5 space-y-4">
          {/* Info Banner */}
          <div className="flex items-start gap-3 p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/15">
            <span>ℹ️</span>
            <div>
              <div className="text-sm font-semibold text-[var(--ink)]">How does this work?</div>
              <div className="text-xs text-[var(--muted)] mt-0.5">Our AI analyzes your webcam feed, audio, and browser activity to ensure academic integrity. These reports are only visible to you and your instructors.</div>
            </div>
          </div>

          {/* Report Cards */}
          {reports.map((r) => (
            <div key={r.exam} className="p-4 rounded-xl border border-[var(--border)]">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-[var(--ink)]">{r.exam}</div>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${r.verdictClass}`}>{r.verdict}</span>
              </div>
              <p className="text-xs text-[var(--muted)] mb-3 leading-relaxed">{r.desc}</p>
              {r.chips.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {r.chips.map((c) => (
                    <span key={c.label} className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${c.color}`}>{c.label}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
