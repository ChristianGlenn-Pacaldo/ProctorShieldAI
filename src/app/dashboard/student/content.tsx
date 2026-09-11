"use client";

import { useState, useEffect } from "react";
import { FileText, CheckCircle2, BarChart3, Shield } from "lucide-react";
import Link from "next/link";

interface StudentQuiz {
  id: string;
  score: number | null;
  quizStatus: string | null;
  cheatingProbability: number | null;
  aiVerdict: string | null;
  createdAt: string;
  quiz?: {
    id: number;
    title: string;
    duration: number | null;
    accessCode: string | null;
    subject?: {
      subjectName: string;
    } | null;
    teacher?: {
      fullName: string;
    } | null;
  } | null;
}

export default function StudentDashboardContent() {
  const [studentQuizzes, setStudentQuizzes] = useState<StudentQuiz[]>([]);
  const [isFetching, setIsFetching] = useState(true);

  const fetchQuizzes = async () => {
    try {
      const res = await fetch("/api/quizzes");
      if (res.ok) {
        const data = await res.json();
        setStudentQuizzes(data.quizzes || []);
      }
    } catch (error) {
      console.error("Failed to fetch quizzes:", error);
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    fetchQuizzes();
  }, []);



  // Filter only valid student quiz records with non-null quiz
  const validQuizzes = studentQuizzes.filter((se) => se && se.quiz);
  const completed = validQuizzes.filter((se) => se.quizStatus === "completed");
  const upcoming = validQuizzes.filter((se) => se.quizStatus !== "completed");

  const completedCount = completed.length;
  const upcomingCount = upcoming.length;

  let avgScore = 0;
  const recordedResults = completed.filter((se) => se.score !== null && se.aiVerdict !== "cheated");
  if (recordedResults.length > 0) {
    const totalScore = recordedResults.reduce((sum, se) => sum + Number(se.score), 0);
    avgScore = Math.round(totalScore / recordedResults.length);
  }

  let avgTrust = 100;
  if (completedCount > 0) {
    const totalCheatProb = completed.reduce((sum, se) => sum + (Number(se.cheatingProbability) || 0), 0);
    avgTrust = Math.max(0, 100 - Math.round(totalCheatProb / completedCount));
  }

  const stats = [
    { label: "Upcoming Quizzes", value: upcomingCount, icon: <FileText className="w-5 h-5" />, color: "bg-blue-600/10 text-blue-600 dark:text-blue-400" },
    { label: "Completed Quizzes", value: completedCount, icon: <CheckCircle2 className="w-5 h-5" />, color: "bg-emerald-600/10 text-emerald-600 dark:text-emerald-400" },
    { label: "Average Score", value: completedCount > 0 ? `${avgScore}%` : "0%", icon: <BarChart3 className="w-5 h-5" />, color: "bg-amber-600/10 text-amber-600 dark:text-amber-400" },
    { label: "Trust Score", value: completedCount > 0 ? `${avgTrust}%` : "100%", icon: <Shield className="w-5 h-5" />, color: "bg-violet-600/10 text-violet-600 dark:text-violet-400" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Join Quiz Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-blue-600/12 to-sky-500/10 border border-blue-500/30 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg shadow-blue-900/5">
        <div>
          <h3 className="font-bold text-blue-600 mb-1 text-lg">Got a join code?</h3>
          <p className="text-sm text-[var(--muted)]">
            Head to the dedicated join page to enter your instructor's code and start your proctored session instantly.
          </p>
        </div>
        <Link
          href="/join"
          className="ui-primary px-6 py-3 text-sm font-bold text-white rounded-xl transition-all whitespace-nowrap"
        >
          Join a Quiz ➔
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg ${s.color} flex items-center justify-center`}>
                {s.icon}
              </div>
            </div>
            <div className="text-2xl font-extrabold text-[var(--ink)] tracking-tight font-[family-name:var(--font-display)]">{s.value}</div>
            <div className="text-xs font-medium text-[var(--muted)] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Upcoming Quizzes */}
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-xs">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">📝 Upcoming Quizzes</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {isFetching ? (
              <p className="p-5 text-xs text-[var(--muted)] animate-pulse">Loading quizzes...</p>
            ) : upcoming.length === 0 ? (
              <p className="p-5 text-xs text-[var(--muted)] italic">No upcoming quizzes. Join one using the code box above.</p>
            ) : (
              upcoming.map((se) => {
                if (!se.quiz) return null;
                return (
                  <div key={se.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-[var(--surface2)]/50 transition-colors">
                    <div>
                      <div className="text-sm font-semibold text-[var(--ink)]">{se.quiz.title || "Untitled Quiz"}</div>
                      <div className="text-xs text-[var(--muted)]">
                        {se.quiz.duration ? `${se.quiz.duration} mins` : "Standard Timer"} · {se.quiz.subject?.subjectName || "General Subject"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                        Live Now
                      </span>
                      <Link
                        href={`/quiz/${se.quiz.id}`}
                        className="text-xs font-bold text-white bg-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-all shadow-xs"
                      >
                        Take Quiz
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Recent Results */}
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-xs">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">📊 Recent Results</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {isFetching ? (
              <p className="p-5 text-xs text-[var(--muted)] animate-pulse">Loading results...</p>
            ) : completed.length === 0 ? (
              <p className="p-5 text-xs text-[var(--muted)] italic">No completed quizzes yet.</p>
            ) : (
              completed.map((se) => {
                if (!se.quiz) return null;
                const isClean = se.aiVerdict === "clean";
                const isSuspicious = se.aiVerdict === "suspicious";
                const verdictLabel = isClean ? "✓ Clean" : isSuspicious ? "⚠ Suspicious" : "🚫 Cheated";
                const verdictClass = isClean 
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" 
                  : isSuspicious 
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" 
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400";

                return (
                  <div key={se.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-[var(--surface2)]/50 transition-colors">
                    <div>
                      <div className="text-sm font-semibold text-[var(--ink)]">{se.quiz.title || "Untitled Quiz"}</div>
                      <div className="text-xs text-[var(--muted)]">{se.quiz.subject?.subjectName || "General Subject"}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-xs font-bold text-[var(--ink)]">
                          Score: {se.aiVerdict === "cheated" ? "Invalidated" : se.score !== null ? `${se.score}%` : "—"}
                        </div>
                        {se.cheatingProbability !== undefined && se.cheatingProbability !== null && (
                          <div className="text-[10px] font-semibold text-rose-500/80 dark:text-rose-400/80">
                            {se.cheatingProbability}% Cheating Risk
                          </div>
                        )}
                      </div>
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${verdictClass}`}>
                        {verdictLabel}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
