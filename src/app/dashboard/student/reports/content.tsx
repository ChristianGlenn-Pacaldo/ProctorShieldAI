"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Info, ShieldAlert } from "lucide-react";

type IntegrityResult = {
  id: string;
  createdAt: string;
  score: number | string | null;
  aiVerdict: string | null;
  cheatingProbability: number | string | null;
  remarks: string | null;
  integrityInvalidated?: boolean;
  quiz?: { title?: string | null } | null;
  aiAnalysis?: {
    totalViolations?: number | null;
    riskLevel?: string | null;
    aiExplanation?: string | null;
  } | null;
};

function verdictDetails(result: IntegrityResult) {
  const verdict = String(result.aiVerdict || "pending").toLowerCase();
  if (result.integrityInvalidated) {
    return {
      label: "Cheated",
      description: result.remarks || result.aiAnalysis?.aiExplanation || "The three-strike integrity limit was reached and this result was invalidated.",
      classes: "bg-rose-500/15 text-rose-600",
      Icon: ShieldAlert,
    };
  }
  if (verdict === "suspicious" || verdict === "cheated") {
    return {
      label: "Review",
      description: result.aiAnalysis?.aiExplanation || result.remarks || "Integrity signals were recorded for instructor review.",
      classes: "bg-amber-500/15 text-amber-600",
      Icon: AlertTriangle,
    };
  }
  if (verdict === "clean") {
    return {
      label: "Clean",
      description: result.aiAnalysis?.aiExplanation || "No integrity violations were recorded for this attempt.",
      classes: "bg-emerald-500/15 text-emerald-600",
      Icon: CheckCircle2,
    };
  }
  return {
    label: "Pending",
    description: "The integrity report is still being prepared.",
    classes: "bg-slate-500/15 text-slate-500",
    Icon: FileText,
  };
}

export default function ReportsContent() {
  const [reports, setReports] = useState<IntegrityResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const loadReports = async () => {
      try {
        const response = await fetch("/api/dashboard/student/results", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || "Unable to load integrity reports");
        if (!cancelled) setReports(Array.isArray(data.results) ? data.results : []);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load integrity reports");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadReports();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="animate-fade-in">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-4">
          <FileText className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-bold text-[var(--ink)]">My AI Integrity Reports</h3>
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex items-start gap-3 rounded-xl border border-indigo-500/15 bg-indigo-500/5 p-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">How does this work?</div>
              <div className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
                Reports summarize the webcam, audio, and browser-integrity signals recorded during your real quiz attempts.
              </div>
            </div>
          </div>

          {loading ? (
            <div className="py-10 text-center text-sm text-[var(--muted)]">Loading integrity reports...</div>
          ) : error ? (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-500">{error}</div>
          ) : reports.length === 0 ? (
            <div className="py-10 text-center text-sm text-[var(--muted)]">No completed quiz reports yet.</div>
          ) : reports.map((report) => {
            const verdict = verdictDetails(report);
            const probability = Number(report.cheatingProbability);
            const violations = Number(report.aiAnalysis?.totalViolations || 0);
            return (
              <article key={report.id} className="min-w-0 rounded-xl border border-[var(--border)] p-4">
                <div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h4 className="break-words text-sm font-semibold text-[var(--ink)]">{report.quiz?.title || "Quiz"}</h4>
                    <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                      {new Date(report.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${verdict.classes}`}>
                    <verdict.Icon className="h-3 w-3" /> {verdict.label}
                  </span>
                </div>
                <p className="mb-3 break-words text-xs leading-relaxed text-[var(--muted)]">{verdict.description}</p>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-indigo-500/10 px-2.5 py-1 text-[10px] font-bold text-indigo-600">
                    Violations: {violations}
                  </span>
                  {Number.isFinite(probability) && (
                    <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold text-violet-600">
                      Cheating risk: {Math.max(0, Math.min(100, probability))}%
                    </span>
                  )}
                  <span className="rounded-full bg-slate-500/10 px-2.5 py-1 text-[10px] font-bold text-[var(--muted)]">
                    Score: {report.integrityInvalidated || verdict.label === "Cheated" ? "Invalidated" : report.score == null ? "Pending" : `${report.score}%`}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
