"use client";

import { useState } from "react";
import { FileText, CheckCircle2, BarChart3, Shield } from "lucide-react";

const stats = [
  { label: "Upcoming Exams", value: 5, change: "+2", icon: <FileText className="w-5 h-5" />, color: "bg-indigo-500/10 text-indigo-500" },
  { label: "Completed Exams", value: 12, change: "+3", icon: <CheckCircle2 className="w-5 h-5" />, color: "bg-emerald-500/10 text-emerald-500" },
  { label: "Average Score", value: "87%", icon: <BarChart3 className="w-5 h-5" />, color: "bg-amber-500/10 text-amber-500" },
  { label: "Trust Score", value: "94%", icon: <Shield className="w-5 h-5" />, color: "bg-violet-500/10 text-violet-500" },
];

const upcomingExams = [
  { title: "CS101 Midterm", date: "May 12, 2025 · 2:00 PM", status: "Live Now", statusClass: "bg-amber-500/15 text-amber-600", proctoring: "AI Enabled" },
  { title: "ENG102 Finals", date: "May 18, 2025 · 1:00 PM", status: "Scheduled", statusClass: "bg-indigo-500/15 text-indigo-600", proctoring: "AI Enabled" },
  { title: "MATH201 Quiz 3", date: "May 20, 2025 · 9:00 AM", status: "Scheduled", statusClass: "bg-indigo-500/15 text-indigo-600", proctoring: "Standard" },
];

const recentResults = [
  { exam: "CS101 Quiz 2", score: "89%", verdict: "✓ Clean", verdictClass: "bg-emerald-500/15 text-emerald-600", date: "May 5, 2025" },
  { exam: "ENG102 Midterm", score: "92%", verdict: "✓ Clean", verdictClass: "bg-emerald-500/15 text-emerald-600", date: "Apr 28, 2025" },
  { exam: "MATH201 Quiz 2", score: "76%", verdict: "⚠ Suspicious", verdictClass: "bg-amber-500/15 text-amber-600", date: "Apr 20, 2025" },
];

export default function StudentDashboardContent() {
  const [joinCode, setJoinCode] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

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
        setMessage(`✅ ${data.message}`);
        setJoinCode("");
        // In a real app, we might trigger a re-fetch of the exams list here
      } else {
        setMessage(`❌ ${data.error || "Failed to join exam"}`);
      }
    } catch (error) {
      setMessage("❌ Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

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
              {s.change && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500">
                  {s.change}
                </span>
              )}
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
            {upcomingExams.map((e) => (
              <div key={e.title} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <div className="text-sm font-semibold text-[var(--ink)]">{e.title}</div>
                  <div className="text-xs text-[var(--muted)]">{e.date}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${e.statusClass}`}>
                    {e.status}
                  </span>
                  {e.status === "Live Now" && (
                    <button className="text-xs font-bold text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-500 transition-all">
                      Take Exam
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Results */}
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)]">📊 Recent Results</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {recentResults.map((r) => (
              <div key={r.exam} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <div className="text-sm font-semibold text-[var(--ink)]">{r.exam}</div>
                  <div className="text-xs text-[var(--muted)]">{r.date}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-[var(--ink)]">{r.score}</span>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${r.verdictClass}`}>
                    {r.verdict}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
