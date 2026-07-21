import React from "react";
import { X, ShieldAlert, CheckCircle, Activity, Brain } from "lucide-react";

interface ResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: any;
}

export default function ResultModal({ isOpen, onClose, result }: ResultModalProps) {
  if (!isOpen || !result) return null;

  const isClean = result.aiVerdict?.includes("Clean");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
      <div className="bg-[var(--surface)] w-full max-w-lg rounded-2xl shadow-2xl border border-[var(--border)] overflow-hidden animate-modal flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--surface2)]">
          <h2 className="text-lg font-bold text-[var(--ink)]">Quiz Result Details</h2>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--ink)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto custom-scrollbar">
          
          <div className="mb-6 text-center">
            <h3 className="text-xl font-bold text-[var(--ink)] mb-1">{result.quiz?.title || "Unknown Quiz"}</h3>
            <p className="text-sm text-[var(--muted)]">
              Taken on {new Date(result.createdAt).toLocaleDateString()}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-[var(--surface2)] rounded-xl p-4 border border-[var(--border)] text-center">
              <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1">Final Score</div>
              <div className="text-2xl font-black text-indigo-500">
                {result.score ? `${result.score}%` : "N/A"}
              </div>
            </div>
            <div className={`rounded-xl p-4 border text-center ${
              isClean 
                ? "bg-emerald-500/10 border-emerald-500/20" 
                : "bg-rose-500/10 border-rose-500/20"
            }`}>
              <div className={`text-xs font-semibold uppercase tracking-wider mb-1 ${
                isClean ? "text-emerald-600/80" : "text-rose-600/80"
              }`}>
                AI Verdict
              </div>
              <div className={`text-xl font-black flex items-center justify-center gap-2 ${
                isClean ? "text-emerald-600" : "text-rose-600"
              }`}>
                {isClean ? <CheckCircle className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
                {result.aiVerdict || "Pending"}
              </div>
            </div>
          </div>

          {result.aiAnalysis && (
            <div className="bg-[var(--surface2)] rounded-xl p-5 border border-[var(--border)] space-y-4">
              <h4 className="text-sm font-bold text-[var(--ink)] flex items-center gap-2">
                <Brain className="w-4 h-4 text-indigo-500" />
                AI Analysis Report
              </h4>
              
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--muted)]">Cheating Probability</span>
                  <span className="font-semibold text-[var(--ink)]">{result.aiAnalysis.cheatingProbability}%</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--muted)]">Total Violations Flagged</span>
                  <span className="font-semibold text-[var(--ink)]">{result.aiAnalysis.totalViolations}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--muted)]">Risk Level</span>
                  <span className="font-semibold text-[var(--ink)]">{result.aiAnalysis.riskLevel}</span>
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
        <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--surface2)] flex justify-end gap-3">
          {result.quizStatus !== "pending_retake" ? (
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
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Request Retake
            </button>
          ) : (
            <button disabled className="px-4 py-2 bg-slate-600 text-white text-sm font-semibold rounded-lg opacity-80 cursor-not-allowed">
              Retake Pending...
            </button>
          )}

          <button 
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
