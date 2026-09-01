"use client";

import { useState, useEffect } from "react";
import PusherClient from "pusher-js";

interface QuizItem {
  id: number;
  title: string;
  instructor: string;
  date: string;
  status: string;
  statusClass: string;
}

export default function QuizzesContent() {
  const [search, setSearch] = useState("");
  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch all quizzes from backend API
  const fetchQuizzes = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch("/api/quizzes");
      if (res.ok) {
        const data = await res.json();
        const formatted = (data.quizzes || []).map((e: any) => {
          let status = "Draft";
          let statusClass = "bg-white/5 text-white/50";
          
          if (e.quizStatus === "active") {
            status = "Live";
            statusClass = "bg-amber-500/15 text-amber-600";
          } else if (e.quizStatus === "completed") {
            status = "Completed";
            statusClass = "bg-emerald-500/15 text-emerald-600";
          }

          return {
            id: e.id,
            title: e.title,
            instructor: e.teacher?.fullName || "System",
            date: new Date(e.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            }),
            status,
            statusClass,
          };
        });
        setQuizzes(formatted);
      }
    } catch (err) {
      console.error("Failed to load quizzes:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchQuizzes();

    // Set up Pusher subscription for real-time quiz creation/submission updates
    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774";
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1";

    const pusher = new PusherClient(pusherKey, {
      cluster: pusherCluster,
      authEndpoint: "/api/pusher/auth",
    });

    const channel = pusher.subscribe("private-admin-dashboard");

    // Re-fetch quizzes when new quizzes are created or completed
    channel.bind("activity", (data: any) => {
      if (data.type === "quiz-created" || data.type === "quiz-submit" || data.type === "quiz-join") {
        fetchQuizzes(true);
      }
    });

    return () => {
      pusher.unsubscribe("private-admin-dashboard");
      pusher.disconnect();
    };
  }, []);

  const filtered = quizzes.filter(
    (e) =>
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.instructor.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-sm font-bold text-[var(--ink)]">📝 All System Quizzes</h3>
            <p className="text-[10px] text-[var(--muted)] mt-0.5">List of all scheduled and active proctored assessments</p>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quizzes..."
            className="w-48 px-3 py-1.5 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Quiz Title", "Instructor", "Date", "Status", "Actions"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading && quizzes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12">
                    <div className="inline-block w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-xs text-[var(--muted)]">
                    No quizzes found in the system.
                  </td>
                </tr>
              ) : (
                filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-[var(--surface2)] transition-colors animate-fade-in">
                    <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{e.title}</td>
                    <td className="px-5 py-3 text-sm text-[var(--muted)]">{e.instructor}</td>
                    <td className="px-5 py-3 text-sm text-[var(--muted)]">{e.date}</td>
                    <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${e.statusClass}`}>{e.status}</span></td>
                    <td className="px-5 py-3"><button className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500 cursor-pointer">View Details</button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
