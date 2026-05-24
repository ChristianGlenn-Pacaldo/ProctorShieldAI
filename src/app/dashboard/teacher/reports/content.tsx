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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/dashboard/teacher/reports");
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            setBars(json.data);
          }
        }
      } catch (err) {
        console.error("Failed to load reports data:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">🧠 Class Integrity Overview</h3>
        </div>
        <div className="p-5 space-y-4 min-h-[150px]">
          {isLoading ? (
            <div className="flex justify-center items-center h-20">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : bars.length === 0 ? (
             <div className="text-center text-[var(--muted)] text-sm py-4">No exam data available yet.</div>
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
            The AI Proctoring system automatically tags students based on the frequency and severity of flagged incidents. Review High Risk students in the Evidence Replay tab.
          </p>
        </div>
      </div>
    </div>
  );
}
