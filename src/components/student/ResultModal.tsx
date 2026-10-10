import React, { useState } from "react";
import { X, ShieldAlert, CheckCircle, Brain, Swords, Trophy, Clock } from "lucide-react";

interface ResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: any;
}

export default function ResultModal({ isOpen, onClose, result }: ResultModalProps) {
  if (!isOpen || !result) return null;
  return <OpenResultModal key={result.id} onClose={onClose} result={result} />;
}

function OpenResultModal({ onClose, result }: Pick<ResultModalProps, "onClose" | "result">) {
  const [retakeState, setRetakeState] = useState<"idle" | "requesting" | "requested">("idle");
  const [retakeError, setRetakeError] = useState("");

  const isArena = result.attemptMode === "arena" || result.effectiveMode === "arena";
  const verdict = String(result.aiVerdict || "").toLowerCase();
  const isClean = verdict === "clean";
  const isInvalidated = !isArena && result.integrityInvalidated === true;

  return (
    <div className="app-modal-backdrop bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="ps-student-card app-modal-panel bg-[var(--surface)] max-w-lg rounded-2xl shadow-2xl border border-[var(--border)] overflow-hidden animate-modal flex min-h-0 flex-col">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface2)] px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="min-w-0 text-base font-bold text-[var(--ink)] sm:text-lg flex items-center gap-2">
            {isArena ? (
              <>
                <Swords className="w-4 h-4 text-[var(--ps-gold)]" />
                <span>Power Arena Match Result</span>
              </>
            ) : (
              <span>Quiz Result Details</span>
            )}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close result details"
            className="p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--ink)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 custom-scrollbar sm:p-6">

          <div className="mb-6 text-center">
            <div className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold mb-2 uppercase tracking-wide border ${
              isArena
                ? "bg-[var(--ps-gold-soft)] text-[var(--ps-gold)]  border-[var(--ps-border)]"
                : "bg-[var(--ps-accent-soft)] text-[var(--ps-accent)]  border-[var(--ps-border)]"
            }`}>
              {isArena ? "Power Arena Match" : "Live Monitored Exam"}
            </div>
            <h3 className="text-xl font-bold text-[var(--ink)] mb-1">{result.quiz?.title || "Unknown Quiz"}</h3>
            <p className="text-sm text-[var(--muted)] flex items-center justify-center gap-1.5 mt-1">
              <Clock className="w-3.5 h-3.5" />
              Completed on {new Date(result.createdAt).toLocaleDateString()}
            </p>
          </div>

          {isArena ? (
            /* Arena Game Summary (NO AI Verdict, NO Cheating, NO Violations) */
            <div className="mb-6 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
              <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4 text-center">
                <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1">Arena Score</div>
                <div className="max-w-full break-words text-xl font-black leading-tight text-[var(--ps-gold)] sm:text-2xl">
                  {result.score != null ? `${result.score} pts` : "Completed"}
                </div>
              </div>
              <div className="min-w-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-success-soft)] p-4 text-center">
                <div className="text-xs font-semibold text-[var(--ps-success)] uppercase tracking-wider mb-1">Match Status</div>
                <div className="flex min-w-0 items-center justify-center gap-2 break-words text-lg font-black text-[var(--ps-success)] sm:text-xl">
                  <Trophy className="w-5 h-5 text-[var(--ps-success)]" />
                  Match Completed
                </div>
              </div>
            </div>
          ) : (
            /* Proctored Academic Summary (Preserve AI Verdict & Academic Invalidation) */
            <>
              <div className="mb-6 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4 text-center">
                  <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1">Final Score</div>
                  <div className="max-w-full break-words text-xl font-black leading-tight text-[var(--ps-accent)] sm:text-2xl">
                    {isInvalidated ? "INVALIDATED" : result.score != null ? `${result.score}%` : "Pending"}
                  </div>
                </div>
                <div className={`min-w-0 rounded-xl p-4 border text-center ${
                  isClean
                    ? "bg-[var(--ps-success-soft)] border-[var(--ps-border)]"
                    : "bg-[var(--ps-error-soft)] border-[var(--ps-border)]"
                }`}>
                  <div className={`text-xs font-semibold uppercase tracking-wider mb-1 ${
                    isClean ? "text-[var(--ps-success)]" : "text-[var(--ps-error)]"
                  }`}>
                    AI Verdict
                  </div>
                  <div className={`flex min-w-0 items-center justify-center gap-2 break-words text-lg font-black sm:text-xl ${
                    isClean ? "text-[var(--ps-success)]" : "text-[var(--ps-error)]"
                  }`}>
                    {isClean ? <CheckCircle className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
                    {isInvalidated ? "CHEATED" : result.aiVerdict || "Pending"}
                  </div>
                </div>
              </div>

              {isInvalidated && (
                <div className="mb-6 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-error-soft)] p-4 text-sm font-semibold text-[var(--ps-error)] ">
                  This result was invalidated and is not included in academic score averages because the three-strike integrity limit was reached.
                </div>
              )}

              {result.aiAnalysis && (
                <div className="bg-[var(--surface2)] rounded-xl p-5 border border-[var(--border)] space-y-4">
                  <h4 className="text-sm font-bold text-[var(--ink)] flex items-center gap-2">
                    <Brain className="w-4 h-4 text-[var(--ps-accent)]" />
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
            </>
          )}

        </div>

        {retakeError && <p role="alert" className="px-4 py-3 text-sm text-[var(--ps-error)]  sm:px-6">{retakeError}</p>}
        {/* Footer */}
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface2)] px-4 py-3 sm:flex-row sm:justify-end sm:gap-3 sm:px-6 sm:py-4">
          {!isArena && result.canRequestRetake === true ? (
            <button
              disabled={retakeState !== "idle"}
              onClick={async () => {
                setRetakeState("requesting");
                setRetakeError("");
                try {
                  const res = await fetch("/api/quizzes/retake", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ studentQuizId: result.id })
                  });
                  if (res.ok) {
                    setRetakeState("requested");
                    setTimeout(() => window.location.reload(), 1500);
                  } else {
                    const data = await res.json().catch(() => null);
                    setRetakeError(typeof data?.error === "string" && data.error.trim() ? data.error : "Could not request a retake. Please try again.");
                    setRetakeState("idle");
                  }
                } catch {
                  setRetakeError("Could not request a retake. Check your connection and try again.");
                  setRetakeState("idle");
                }
              }}
              className="ps-student-danger w-full px-4 py-2 bg-[var(--ps-error-soft)] hover:bg-[var(--ps-error-soft)] text-[var(--ps-on-primary)] text-sm font-semibold rounded-lg transition-colors sm:w-auto"
            >
              {retakeState === "requesting" ? "Requesting..." : retakeState === "requested" ? "Requested ✓" : "Request Retake"}
            </button>
          ) : !isArena && result.quizStatus === "pending_retake" ? (
            <button disabled className="w-full px-4 py-2 bg-[var(--ps-surface-inset)] text-[var(--ps-on-primary)] text-sm font-semibold rounded-lg opacity-80 cursor-not-allowed sm:w-auto">
              Retake Pending...
            </button>
          ) : null}

          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-[var(--ps-primary)] hover:bg-[var(--ps-primary-hover)] text-[var(--ps-on-primary)] text-sm font-semibold rounded-lg transition-colors sm:w-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
