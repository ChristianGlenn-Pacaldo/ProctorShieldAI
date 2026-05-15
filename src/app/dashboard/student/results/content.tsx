"use client";

import { CheckCircle2, BarChart3 } from "lucide-react";

const results = [
  { exam: "CS101 Quiz 2", date: "May 5, 2025", score: "92% (46/50)", avg: "81%", verdict: "✓ Clean", verdictClass: "bg-emerald-500/15 text-emerald-600" },
  { exam: "MATH201 Quiz 2", date: "May 2, 2025", score: "78% (39/50)", avg: "74%", verdict: "⚠ Suspicious", verdictClass: "bg-amber-500/15 text-amber-600" },
  { exam: "ENG102 Midterm", date: "Apr 28, 2025", score: "88% (88/100)", avg: "85%", verdict: "✓ Clean", verdictClass: "bg-emerald-500/15 text-emerald-600" },
];

export default function ResultsContent() {
  return (
    <div className="animate-fade-in space-y-4">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="text-2xl font-extrabold text-[var(--ink)]">12</div>
          <div className="text-xs text-[var(--muted)]">Exams Taken</div>
        </div>
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center mb-3">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div className="text-2xl font-extrabold text-[var(--ink)]">87%</div>
          <div className="text-xs text-[var(--muted)]">Average Score</div>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">📈 Complete Results History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Exam", "Date Taken", "Score", "Class Average", "AI Verdict", "Details"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {results.map((r) => (
                <tr key={r.exam} className="hover:bg-[var(--surface2)] transition-colors">
                  <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{r.exam}</td>
                  <td className="px-5 py-3 text-sm text-[var(--muted)]">{r.date}</td>
                  <td className="px-5 py-3 text-sm font-bold text-[var(--ink)]">{r.score}</td>
                  <td className="px-5 py-3 text-sm text-[var(--muted)]">{r.avg}</td>
                  <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${r.verdictClass}`}>{r.verdict}</span></td>
                  <td className="px-5 py-3"><button className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500">Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
