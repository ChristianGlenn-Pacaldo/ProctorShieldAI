import React from "react";
import { X, ShieldAlert, CheckCircle, Activity, Brain } from "lucide-react";

interface ResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: any;
}

export default function ResultModal({ isOpen, onClose, result }: ResultModalProps) {
  if (!isOpen || !result) return null;

  const verdict = String(result.aiVerdict || "").toLowerCase();
  const isClean = verdict === "clean";
  const isInvalidated = verdict === "cheated";

  return (
    <div className="app-modal-backdrop bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="app-modal-panel bg-[var(--surface)] max-w-lg rounded-2xl shadow-2xl border border-[var(--border)] overflow-hidden animate-modal flex min-h-0 flex-col">
        
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface2)] px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="min-w-0 text-base font-bold text-[var(--ink)] sm:text-lg">Quiz Result Details</h2>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--ink)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 custom-scrollbar sm:p-6">
          
          <div className="mb-6 text-center">
            <h3 className="text-xl font-bold text-[var(--ink)] mb-1">{result.quiz?.title || "Unknown Quiz"}</h3>
            <p className="text-sm text-[var(--muted)]">
              Taken on {new Date(result.createdAt).toLocaleDateString()}
            </p>
          </div>

          <div className="mb-6 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4 text-center">
              <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1">Final Score</div>
              <div className="max-w-full break-words text-xl font-black leading-tight text-indigo-500 sm:text-2xl">
                {isInvalidated ? "INVALIDATED" : result.score != null ? `${result.score}%` : "Pending"}
              </div>
            </div>
            <div className={`min-w-0 rounded-xl p-4 border text-center ${
              isClean 
                ? "bg-emerald-500/10 border-emerald-500/20" 
                : "bg-rose-500/10 border-rose-500/20"
            }`}>
              <div className={`text-xs font-semibold uppercase tracking-wider mb-1 ${
                isClean ? "text-emerald-600/80" : "text-rose-600/80"
              }`}>
                AI Verdict
              </div>
              <div className={`flex min-w-0 items-center justify-center gap-2 break-words text-lg font-black sm:text-xl ${
                isClean ? "text-emerald-600" : "text-rose-600"
              }`}>
                {isClean ? <CheckCircle className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
                {isInvalidated ? "CHEATED" : result.aiVerdict || "Pending"}
              </div>
            </div>
          </div>

          {isInvalidated && (
            <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm font-semibold text-rose-600 dark:text-rose-400">
              This result was invalidated and is not included in academic score averages because the three-strike integrity limit was reached.
            </div>
          )}

          {result.aiAnalysis && (
            <div className="bg-[var(--surface2)] rounded-xl p-5 border border-[var(--border)] space-y-4">
              <h4 className="text-sm font-bold text-[var(--ink)] flex items-center gap-2">
                <Brain className="w-4 h-4 text-indigo-500" />
                AI Analysis Report
              </h4>
              
              <div className="space-y-3">
                <div className="flex min-w-0 justify-between gap-3 text-sm">
                  <span className="min-w-0 text-[var(--muted)]">Cheating Probability</span>
                  <span className="shrink-0 font-semibold text-[var(--ink)]">{result.aiAnalysis.cheatingProbability}%</span>
                </div>
                <div className="flex min-w-0 justify-between gap-3 text-sm">
                  <span className="min-w-0 text-[var(--muted)]">Total Violations Flagged</span>
                  <span className="shrink-0 font-semibold text-[var(--ink)]">{result.aiAnalysis.totalViolations}</span>
                </div>
                <div className="flex min-w-0 justify-between gap-3 text-sm">
                  <span className="min-w-0 text-[var(--muted)]">Risk Level</span>
                  <span className="shrink-0 font-semibold text-[var(--ink)]">{result.aiAnalysis.riskLevel}</span>
                </div>
                
                {result.aiAnalysis.aiExplanation && (
                  <div className="pt-3 border-t border-[var(--border)]">
                    <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider block mb-1">AI Explanation</span>
                    <p className="text-sm text-[var(--ink2)] leading-relaxed">
                      {result.aiAnalysis.aiExplanation}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
        
        {/* Footer */}
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface2)] px-4 py-3 sm:flex-row sm:justify-end sm:gap-3 sm:px-6 sm:py-4">
          {result.quiz?.allowRetake && result.quizStatus !== "pending_retake" ? (
            <button 
              onClick={async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                btn.innerText = "Requesting...";
                try {
                  const res = await fetch("/api/quizzes/retake", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ studentQuizId: result.id })
                  });
                  if (res.ok) {
                    btn.innerText = "Requested ✓";
                    setTimeout(() => window.location.reload(), 1500);
                  } else {
                    btn.innerText = "Failed";
                    setTimeout(() => {
                      btn.disabled = false;
                      btn.innerText = "Request Retake";
                    }, 2000);
                  }
                } catch {
                  btn.disabled = false;
                  btn.innerText = "Request Retake";
                }
              }}
              className="w-full px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-lg transition-colors sm:w-auto"
            >
              Request Retake
            </button>
          ) : result.quizStatus === "pending_retake" ? (
            <button disabled className="w-full px-4 py-2 bg-slate-600 text-white text-sm font-semibold rounded-lg opacity-80 cursor-not-allowed sm:w-auto">
              Retake Pending...
            </button>
          ) : null}

          <button 
            onClick={onClose}
            className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors sm:w-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
