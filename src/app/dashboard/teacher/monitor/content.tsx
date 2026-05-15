"use client";

const feeds = [
  { name: "Juan Dela Cruz", status: "✓", statusColor: "text-emerald-500", border: "border-[var(--border)]" },
  { name: "Ethan Reyes", status: "⚠ Tab", statusColor: "text-red-500", border: "border-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.2)]" },
  { name: "Maria Santos", status: "✓", statusColor: "text-emerald-500", border: "border-[var(--border)]" },
  { name: "Carlo Mendoza", status: "⚠ Multi", statusColor: "text-amber-500", border: "border-amber-500 shadow-[0_0_0_2px_rgba(245,158,11,0.2)]" },
];

export default function LiveMonitorContent() {
  return (
    <div className="animate-fade-in">
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
            {feeds.map((f) => (
              <div key={f.name} className={`rounded-xl overflow-hidden border ${f.border} transition-transform hover:scale-[1.02] cursor-pointer`}>
                <div className="bg-slate-800 h-32 flex items-center justify-center text-white text-sm">
                  Cam Feed
                </div>
                <div className="px-3 py-2 flex items-center justify-between text-xs font-semibold text-[var(--ink)]">
                  <span>{f.name}</span>
                  <span className={f.statusColor}>{f.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
