"use client";

const evidence = [
  { name: "Ethan Reyes", event: "Phone Detected · 14:23:45", bg: "bg-red-50 dark:bg-red-500/5", btnClass: "bg-red-500 text-white hover:bg-red-600" },
  { name: "Carlo Mendoza", event: "Multiple Faces · 14:31:12", bg: "bg-amber-50 dark:bg-amber-500/5", btnClass: "bg-amber-500 text-white hover:bg-amber-600" },
];

export default function EvidenceContent() {
  return (
    <div className="animate-fade-in grid lg:grid-cols-2 gap-4">
      {/* Evidence Log */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">📸 Evidence Log</h3>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {evidence.map((e) => (
            <div key={e.name} className={`flex items-center justify-between px-5 py-3.5 cursor-pointer ${e.bg}`}>
              <div>
                <div className="text-sm font-semibold text-[var(--ink)]">{e.name}</div>
                <div className="text-xs text-[var(--muted)]">{e.event}</div>
              </div>
              <button className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${e.btnClass}`}>
                Play
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Video Player */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">▶ Video Player</h3>
        </div>
        <div className="p-5 text-center">
          <div className="w-full h-52 bg-slate-800 rounded-xl flex items-center justify-center text-white text-sm mb-4">
            Video Feed Simulation
          </div>
          <button className="px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/20">
            Download Evidence
          </button>
        </div>
      </div>
    </div>
  );
}
