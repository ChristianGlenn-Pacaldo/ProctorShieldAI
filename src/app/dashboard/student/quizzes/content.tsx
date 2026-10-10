"use client";

import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import Link from "next/link";
import ResultModal from "@/components/student/ResultModal";

export default function QuizzesContent() {
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedResult, setSelectedResult] = useState<any | null>(null);

  const fetchQuizzes = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/quizzes", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load My Quizzes.");
      const data = await res.json();
      if (data.success !== true || !Array.isArray(data.quizzes)) throw new Error("Could not load My Quizzes.");
      setQuizzes(data.quizzes);
      setHasLoaded(true);
      setLoadError("");
    } catch (error) {
      console.error("Failed to fetch quizzes", error);
      setLoadError("Could not load My Quizzes.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchQuizzes();
  }, []);

  const filtered = (quizzes || []).filter((e) =>
    (e?.quiz?.title || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="ps-student-page min-w-0 space-y-6">
      <div className="ps-student-card bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex flex-col items-stretch justify-between gap-4 px-5 py-4 sm:flex-row sm:items-center border-b border-[var(--border)]">
          <div className="flex items-center gap-4">
            <h3 className="text-sm font-bold text-[var(--ink)]">📝 My Enrolled Quizzes</h3>
          </div>
          <div className="relative w-full sm:w-auto">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search enrolled quizzes"
              placeholder="Search quizzes..."
              className="w-full sm:w-56 pl-8 pr-3 py-2.5 text-sm rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-[var(--ps-border)]"
            />
          </div>
        </div>

        {loadError && (
          <div role="alert" className="mx-5 mt-4 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-error-soft)] p-3 text-sm text-[var(--ps-error)] ">
            {loadError} <button type="button" onClick={() => void fetchQuizzes()} className="font-bold underline">Retry</button>
          </div>
        )}

        <div role="region" aria-label="Enrolled quizzes" tabIndex={0} className="overflow-x-auto min-h-[300px]">
          {isLoading && !hasLoaded ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-[var(--ps-accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !hasLoaded ? null : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-[var(--muted)]">
              <span className="text-2xl mb-2">📄</span>
              <p className="text-sm font-semibold">No enrolled quizzes found</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Quiz Title", "Mode", "Subject", "Duration", "Status", "AI Verdict", "Action"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((enrollment) => {
                  const e = enrollment?.quiz;
                  if (!e) return null;
                  const isCompleted = ["completed", "ended", "rejected", "pending_retake"].includes(enrollment.quizStatus);
                  const isArena = e.quizMode === "arena";
                  const targetUrl = isArena ? `/arena/${e.id}` : `/quiz/${e.id}`;
                  return (
                    <tr key={enrollment.id} className="hover:bg-[var(--surface2)] transition-colors">
                      <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{e.title || "Untitled Quiz"}</td>
                      <td className="px-5 py-3">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          isArena
                            ? "bg-[var(--ps-gold-soft)] text-[var(--ps-gold)]  border border-[var(--ps-border)]"
                            : "bg-[var(--ps-accent-soft)] text-[var(--ps-accent)]  border border-[var(--ps-border)]"
                        }`}>
                          {isArena ? "Power Arena" : "Live Monitored Exam"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--muted)]">{e.subject?.subjectName || "N/A"}</td>
                      <td className="px-5 py-3 text-sm text-[var(--ink)]">{e.duration} min</td>
                      <td className="px-5 py-3">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${isCompleted ? 'bg-[var(--ps-success-soft)] text-[var(--ps-success)]' : 'bg-[var(--ps-accent-soft)] text-[var(--ps-accent)]'}`}>
                          {enrollment.quizStatus?.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[var(--ps-surface-inset)] text-[var(--ps-text-muted)]">
                          {enrollment.aiVerdict ? enrollment.aiVerdict.toUpperCase() : "PENDING"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {!isCompleted ? (
                          <Link href={targetUrl}>
                            <button className="text-xs font-bold text-[var(--ps-on-primary)] bg-[var(--ps-primary)] px-3 py-1.5 rounded-lg hover:bg-[var(--ps-primary-hover)] transition-all shadow-md">
                              {isArena ? "Enter Arena" : "Take Quiz"}
                            </button>
                          </Link>
                        ) : (
                          <button
                            onClick={() => setSelectedResult(enrollment)}
                            className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--ps-accent)] transition-colors"
                          >
                            View Result
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
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
