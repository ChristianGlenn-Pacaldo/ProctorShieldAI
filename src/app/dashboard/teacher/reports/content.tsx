"use client";

import { useState, useEffect } from "react";

interface BarData {
  label: string;
  value: number;
  pct: number;
  color: string;
}

export default function ReportsContent() {
  const [bars, setBars] = useState<BarData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/dashboard/teacher/reports");
      if (!res.ok) throw new Error(`Reports request failed (${res.status})`);
      const json = await res.json();
      if (!json.success || !Array.isArray(json.data)) throw new Error("Invalid reports response");
      setBars(json.data);
      setLoadError(null);
    } catch (err) {
      console.error("Failed to load reports data:", err);
      setLoadError("Could not load Teacher Reports. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">🧠 Class Integrity Overview</h3>
        </div>
        <div className="p-5 space-y-4 min-h-[150px]">
          {loadError && (
            <div role="alert" className="flex items-center justify-between gap-4 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">
              <span>{loadError}</span>
              <button type="button" onClick={() => void fetchData()} className="font-bold underline">Retry</button>
            </div>
          )}
          {isLoading ? (
            <div className="flex justify-center items-center h-20">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : loadError && bars.length === 0 ? null : bars.length === 0 ? (
             <div className="text-center text-[var(--muted)] text-sm py-4">No quiz data available yet.</div>
          ) : (
            bars.map((b) => (
              <div key={b.label} className="flex items-center gap-3">
                <span className="text-xs text-[var(--muted)] w-44 shrink-0">{b.label}</span>
                <div className="flex-1 h-2.5 bg-[var(--surface2)] rounded-full overflow-hidden">
                  <div className={`h-full ${b.color} rounded-full transition-all duration-700`} style={{ width: `${b.pct}%` }} />
                </div>
                <span className="text-xs font-bold text-[var(--ink)] w-8 text-right">{b.value}</span>
              </div>
            ))
          )}
          <p className="mt-5 text-xs text-[var(--muted)] leading-relaxed border-t border-[var(--border)] pt-4">
            Completed proctored attempts are grouped by recorded violations: 0 clean, 1–2 suspicious, and 3 or more high risk. Review violations in Evidence Replay.
          </p>
        </div>
      </div>
    </div>
  );
}
