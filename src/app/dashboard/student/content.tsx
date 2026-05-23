"use client";

import { useState, useEffect } from "react";
import { FileText, CheckCircle2, BarChart3, Shield } from "lucide-react";
import Link from "next/link";

interface StudentExam {
  id: string;
  score: number | null;
  examStatus: string | null;
  cheatingProbability: number | null;
  aiVerdict: string | null;
  createdAt: string;
  exam: {
    id: number;
    title: string;
    duration: number | null;
    accessCode: string | null;
    subject: {
      subjectName: string;
    };
    teacher: {
      fullName: string;
    };
  };
}

export default function StudentDashboardContent() {
  const [joinCode, setJoinCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [studentExams, setStudentExams] = useState<StudentExam[]>([]);
  const [isFetching, setIsFetching] = useState(true);

  const fetchExams = async () => {
    try {
      const res = await fetch("/api/exams");
      if (res.ok) {
        const data = await res.json();
        setStudentExams(data.exams || []);
      }
    } catch (error) {
      console.error("Failed to fetch exams:", error);
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    fetchExams();
  }, []);

  const handleJoinExam = async () => {
    if (!joinCode.trim()) return;
    
    setIsLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/exams/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: joinCode }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(`✅ ${data.message || "Successfully joined exam"}`);
        setJoinCode("");
        fetchExams(); // Refresh lists
      } else {
        setMessage(`❌ ${data.error || "Failed to join exam"}`);
      }
    } catch (error) {
      setMessage("❌ Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Compute Dynamic Stats
  const completed = studentExams.filter((se) => se.examStatus === "completed");
  const upcoming = studentExams.filter((se) => se.examStatus !== "completed");

  const completedCount = completed.length;
  const upcomingCount = upcoming.length;

  let avgScore = 0;
  if (completedCount > 0) {
    const totalScore = completed.reduce((sum, se) => sum + (Number(se.score) || 0), 0);
    avgScore = Math.round(totalScore / completedCount);
  }

  let avgTrust = 100;
  if (completedCount > 0) {
    const totalCheatProb = completed.reduce((sum, se) => sum + (Number(se.cheatingProbability) || 0), 0);
    avgTrust = Math.max(0, 100 - Math.round(totalCheatProb / completedCount));
  }

  const stats = [
    { label: "Upcoming Exams", value: upcomingCount, icon: <FileText className="w-5 h-5" />, color: "bg-indigo-500/10 text-indigo-500" },
    { label: "Completed Exams", value: completedCount, icon: <CheckCircle2 className="w-5 h-5" />, color: "bg-emerald-500/10 text-emerald-500" },
    { label: "Average Score", value: completedCount > 0 ? `${avgScore}%` : "0%", icon: <BarChart3 className="w-5 h-5" />, color: "bg-amber-500/10 text-amber-500" },
    { label: "Trust Score", value: completedCount > 0 ? `${avgTrust}%` : "100%", icon: <Shield className="w-5 h-5" />, color: "bg-violet-500/10 text-violet-500" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Join Exam Box */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-indigo-600/10 to-violet-600/10 border border-indigo-500/30">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-indigo-600 mb-1">Join an Exam</h3>
            <p className="text-xs text-[var(--muted)]">
              Enter the code provided by your instructor to start your proctored session.
            </p>
          </div>
          <div className="flex gap-2.5">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="PS-8821"
              className="w-36 px-4 py-2.5 text-center font-bold tracking-widest text-sm rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30"
            />
            <button
              onClick={handleJoinExam}
              disabled={isLoading}
              className="px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50"
            >
              {isLoading ? "Joining..." : "Join Exam"}
            </button>
          </div>
        </div>
        {message && (
          <div className="mt-3 text-xs font-semibold animate-fade-in text-[var(--ink)]">
            {message}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center`}>
                {s.icon}
              </div>
            </div>
            <div className="text-2xl font-extrabold text-[var(--ink)]">{s.value}</div>
            <div className="text-xs text-[var(--muted)] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Upcoming Exams */}
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)]">📝 Upcoming Exams</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {isFetching ? (
              <p className="p-5 text-xs text-[var(--muted)] animate-pulse">Loading exams...</p>
            ) : upcoming.length === 0 ? (
              <p className="p-5 text-xs text-[var(--muted)] italic">No upcoming exams. Join one using the code box above.</p>
            ) : (
              upcoming.map((se) => (
                <div key={se.id} className="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <div className="text-sm font-semibold text-[var(--ink)]">{se.exam.title}</div>
                    <div className="text-xs text-[var(--muted)]">
                      {se.exam.duration ? `${se.exam.duration} mins` : "Standard Timer"} · {se.exam.subject.subjectName}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600">
                      Live Now
                    </span>
                    <Link
                      href={`/quiz/${se.exam.id}`}
                      className="text-xs font-bold text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-500 transition-all"
                    >
                      Take Exam
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Results */}
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)]">📊 Recent Results</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {isFetching ? (
              <p className="p-5 text-xs text-[var(--muted)] animate-pulse">Loading results...</p>
            ) : completed.length === 0 ? (
              <p className="p-5 text-xs text-[var(--muted)] italic">No completed exams yet.</p>
            ) : (
              completed.map((se) => {
                const isClean = se.aiVerdict === "clean";
                const isSuspicious = se.aiVerdict === "suspicious";
                const verdictLabel = isClean ? "✓ Clean" : isSuspicious ? "⚠ Suspicious" : "🚫 Cheated";
                const verdictClass = isClean 
                  ? "bg-emerald-500/10 text-emerald-600" 
                  : isSuspicious 
                  ? "bg-amber-500/10 text-amber-600" 
                  : "bg-red-500/10 text-red-500";

                return (
                  <div key={se.id} className="flex items-center justify-between px-5 py-3.5">
                    <div>
                      <div className="text-sm font-semibold text-[var(--ink)]">{se.exam.title}</div>
                      <div className="text-xs text-[var(--muted)]">{se.exam.subject.subjectName}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-[var(--ink)]">{se.score}%</span>
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
