"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, BarChart3 } from "lucide-react";
import ResultModal from "@/components/student/ResultModal";
import { averageExamScore } from "@/lib/student-result-summary";

export default function ResultsContent() {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedResult, setSelectedResult] = useState<any | null>(null);

  const fetchResults = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/dashboard/student/results", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load your results.");
      const data = await res.json();
      if (data.success !== true || !Array.isArray(data.results)) throw new Error("Could not load your results.");
      setResults(data.results);
      setHasLoaded(true);
      setLoadError("");
    } catch (error) {
      console.error("Failed to fetch results", error);
      setLoadError("Could not load your results.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResults();
  }, []);

  return (
    <div className="ps-student-page min-w-0 space-y-6">
      <div><h1 className="text-2xl sm:text-3xl font-bold font-[family-name:var(--ps-font-display)] text-[var(--ps-text)]">Results &amp; Performance</h1><p className="mt-2 text-sm text-[var(--ps-text-secondary)]">Review your completed attempts and academic results.</p></div>
      {loadError && (
        <div role="alert" className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-error-soft)] p-3 text-sm text-[var(--ps-error)] ">
          {loadError} <button type="button" onClick={() => void fetchResults()} className="font-bold underline">Retry</button>
        </div>
      )}
      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="ps-student-card bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5">
          <div className="w-10 h-10 rounded-xl bg-[var(--ps-success-soft)] text-[var(--ps-success)] flex items-center justify-center mb-3">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="text-2xl font-extrabold text-[var(--ink)]">{hasLoaded ? results.filter((result) => result.isCompleted).length : "—"}</div>
          <div className="text-xs text-[var(--muted)]">Completed Attempts</div>
        </div>
        <div className="ps-student-card bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5">
          <div className="w-10 h-10 rounded-xl bg-[var(--ps-accent-soft)] text-[var(--ps-accent)] flex items-center justify-center mb-3">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div className="text-2xl font-extrabold text-[var(--ink)]">{hasLoaded ? `${averageExamScore(results)}%` : "—"}</div>
          <div className="text-xs text-[var(--muted)]">Average Exam Score</div>
        </div>
      </div>

      {/* Results Table */}
      <div className="ps-student-card bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)] flex justify-between items-center">
          <h3 className="text-sm font-bold text-[var(--ink)]">📈 Quiz Attempt History</h3>
        </div>
        {hasLoaded && results.length === 0 && (
          <p role="status" className="px-5 py-8 text-center text-[var(--muted)] sm:hidden">
            No quiz history found.
          </p>
        )}
        <div role="region" aria-label="Quiz attempt history" tabIndex={0} className={`overflow-x-auto${hasLoaded && results.length === 0 ? " hidden sm:block" : ""}`}>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Quiz", "Mode", "Record Date", "Score", "Status / Verdict", "Details"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading && !hasLoaded ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-[var(--muted)]">Loading results...</td>
                </tr>
              ) : !hasLoaded ? null : results.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-[var(--muted)]">No quiz history found.</td>
                </tr>
              ) : (
                results.map((r) => {
                  const isArena = r.attemptMode === "arena" || r.effectiveMode === "arena";
                  const isCompleted = r.isCompleted === true;
                  const pendingStatus = r.quizStatus === "in_progress" ? "In Progress"
                    : r.quizStatus === "enrolled" ? "Waiting to Start"
                    : r.quizStatus === "pending_approval" ? "Approval Pending"
                    : r.quizStatus === "rejected" ? "Entry Rejected"
                    : r.quizStatus === "submitting" ? "Submitting"
                    : "Not Completed";
                  const verdict = String(r.aiVerdict || "").toLowerCase();
                  const isClean = verdict === "clean";
                  const isSuspicious = verdict === "suspicious";
                  const isInvalidated = r.integrityInvalidated === true;
                  const verdictClass = isClean
                    ? "bg-[var(--ps-success-soft)] text-[var(--ps-success)]"
                    : isSuspicious
                      ? "bg-[var(--ps-gold-soft)] text-[var(--ps-gold)]"
                      : "bg-[var(--ps-error-soft)] text-[var(--ps-error)]";
                  return (
                    <tr key={r.id} className="hover:bg-[var(--surface2)] transition-colors">
                      <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{r.quiz?.title || "Unknown Quiz"}</td>
                      <td className="px-5 py-3">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          isArena
                            ? "bg-[var(--ps-gold-soft)] text-[var(--ps-gold)]  border border-[var(--ps-border)]"
                            : "bg-[var(--ps-accent-soft)] text-[var(--ps-accent)]  border border-[var(--ps-border)]"
                        }`}>
                          {isArena ? "Power Arena" : "Live Exam"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--muted)]">{new Date(r.createdAt).toLocaleDateString()}</td>
                      <td className={`px-5 py-3 text-sm font-bold ${!isArena && isInvalidated ? "text-[var(--ps-error)]" : "text-[var(--ink)]"}`}>
                        {!isCompleted ? "Pending" : isArena
                          ? (r.score != null ? `${r.score} pts` : "Completed")
                          : (isInvalidated ? "Invalidated" : r.score != null ? `${r.score}%` : "Pending")}
                      </td>
                      <td className="px-5 py-3">
                        {!isCompleted ? (
                          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[var(--ps-surface-inset)] text-[var(--ps-text-muted)] ">
                            {pendingStatus}
                          </span>
                        ) : isArena ? (
                          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[var(--ps-success-soft)] text-[var(--ps-success)] ">
                            Match Completed
                          </span>
                        ) : (
                          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${verdictClass}`}>
                            {isInvalidated ? "CHEATED" : r.aiVerdict ? r.aiVerdict.toUpperCase() : "PENDING"}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {isCompleted ? <button
                          onClick={() => setSelectedResult(r)}
                          className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--ps-accent)] transition-colors"
                        >
                          Review
                        </button> : <span className="text-xs text-[var(--muted)]">Not available</span>}
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
