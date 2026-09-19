"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, BarChart3 } from "lucide-react";
import ResultModal from "@/components/student/ResultModal";

export default function ResultsContent() {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedResult, setSelectedResult] = useState<any | null>(null);

  const fetchResults = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/dashboard/student/results");
      const data = await res.json();
      if (data.success) {
        setResults(data.results);
      }
    } catch (error) {
      console.error("Failed to fetch results", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResults();
  }, []);

  const calculateAverage = () => {
    const recordedResults = results.filter((result) => {
      const isArena = result.attemptMode === "arena" || result.effectiveMode === "arena";
      return !isArena && result.score != null && !result.integrityInvalidated;
    });
    if (recordedResults.length === 0) return 0;
    const total = recordedResults.reduce((sum, result) => sum + Number(result.score), 0);
    return Math.round(total / recordedResults.length);
  };

  return (
    <div className="space-y-4">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="text-2xl font-extrabold text-[var(--ink)]">{results.length}</div>
          <div className="text-xs text-[var(--muted)]">Completed Attempts</div>
        </div>
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center mb-3">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div className="text-2xl font-extrabold text-[var(--ink)]">{calculateAverage()}%</div>
          <div className="text-xs text-[var(--muted)]">Average Exam Score</div>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)] flex justify-between items-center">
          <h3 className="text-sm font-bold text-[var(--ink)]">📈 Complete Results History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Quiz", "Mode", "Date Taken", "Score", "Status / Verdict", "Details"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-[var(--muted)]">Loading results...</td>
                </tr>
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-[var(--muted)]">No quiz history found.</td>
                </tr>
              ) : (
                results.map((r) => {
                  const isArena = r.attemptMode === "arena" || r.effectiveMode === "arena";
                  const verdict = String(r.aiVerdict || "").toLowerCase();
                  const isClean = verdict === "clean";
                  const isSuspicious = verdict === "suspicious";
                  const isInvalidated = r.integrityInvalidated === true;
                  const verdictClass = isClean
                    ? "bg-emerald-500/15 text-emerald-600"
                    : isSuspicious
                      ? "bg-amber-500/15 text-amber-600"
                      : "bg-rose-500/15 text-rose-600";
                  return (
                    <tr key={r.id} className="hover:bg-[var(--surface2)] transition-colors">
                      <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{r.quiz?.title || "Unknown Quiz"}</td>
                      <td className="px-5 py-3">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          isArena
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25"
                            : "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
                        }`}>
                          {isArena ? "Power Arena" : "Live Exam"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--muted)]">{new Date(r.createdAt).toLocaleDateString()}</td>
                      <td className={`px-5 py-3 text-sm font-bold ${!isArena && isInvalidated ? "text-rose-500" : "text-[var(--ink)]"}`}>
                        {isArena
                          ? (r.score != null ? `${r.score} pts` : "Completed")
                          : (isInvalidated ? "Invalidated" : r.score != null ? `${r.score}%` : "Pending")}
                      </td>
                      <td className="px-5 py-3">
                        {isArena ? (
                          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                            Match Completed
                          </span>
                        ) : (
                          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${verdictClass}`}>
                            {isInvalidated ? "CHEATED" : r.aiVerdict ? r.aiVerdict.toUpperCase() : "PENDING"}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <button 
                          onClick={() => setSelectedResult(r)}
                          className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500 transition-colors"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ResultModal 
        isOpen={!!selectedResult} 
        onClose={() => setSelectedResult(null)} 
        result={selectedResult} 
      />
    </div>
  );
}
