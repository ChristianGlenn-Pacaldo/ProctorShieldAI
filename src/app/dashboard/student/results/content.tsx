"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, BarChart3, Trash2 } from "lucide-react";
import ResultModal from "@/components/student/ResultModal";

export default function ResultsContent() {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedResult, setSelectedResult] = useState<any | null>(null);

  useEffect(() => {
    fetchResults();
  }, []);

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

  const handleClearHistory = async () => {
    if (!confirm("Are you sure you want to completely delete your quiz history? This action cannot be undone.")) return;
    
    try {
      const res = await fetch("/api/dashboard/student/results", {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        setResults([]);
      }
    } catch (error) {
      console.error("Failed to clear history", error);
    }
  };

  const calculateAverage = () => {
    if (results.length === 0) return 0;
    const total = results.reduce((sum, r) => sum + (Number(r.score) || 0), 0);
    return Math.round(total / results.length);
  };

  return (
    <div className="animate-fade-in space-y-4">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="text-2xl font-extrabold text-[var(--ink)]">{results.length}</div>
          <div className="text-xs text-[var(--muted)]">Quizzes Taken</div>
        </div>
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center mb-3">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div className="text-2xl font-extrabold text-[var(--ink)]">{calculateAverage()}%</div>
          <div className="text-xs text-[var(--muted)]">Average Score</div>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)] flex justify-between items-center">
          <h3 className="text-sm font-bold text-[var(--ink)]">📈 Complete Results History</h3>
          <button 
            onClick={handleClearHistory}
            className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Clear All History
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Quiz", "Date Taken", "Score", "AI Verdict", "Details"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-[var(--muted)]">Loading results...</td>
                </tr>
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-[var(--muted)]">No quiz history found.</td>
                </tr>
              ) : (
                results.map((r) => {
                  const isClean = r.aiVerdict?.includes("Clean");
                  const verdictClass = isClean ? "bg-emerald-500/15 text-emerald-600" : "bg-rose-500/15 text-rose-600";
                  return (
                    <tr key={r.id} className="hover:bg-[var(--surface2)] transition-colors">
                      <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{r.quiz?.title || "Unknown Quiz"}</td>
                      <td className="px-5 py-3 text-sm text-[var(--muted)]">{new Date(r.createdAt).toLocaleDateString()}</td>
                      <td className="px-5 py-3 text-sm font-bold text-[var(--ink)]">{r.score ? `${r.score}%` : "N/A"}</td>
                      <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${verdictClass}`}>{r.aiVerdict || "Pending"}</span></td>
                      <td className="px-5 py-3">
                        <button 
                          onClick={() => setSelectedResult(r)}
                          className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500 transition-colors"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  )
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
