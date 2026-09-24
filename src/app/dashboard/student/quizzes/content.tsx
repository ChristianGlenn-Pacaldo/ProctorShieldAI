"use client";

import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PusherClient from "pusher-js";
import ResultModal from "@/components/student/ResultModal";

export default function QuizzesContent({ userId }: { userId: string }) {
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedResult, setSelectedResult] = useState<any | null>(null);

  useEffect(() => {
    const fetchQuizzes = async () => {
      try {
        const res = await fetch("/api/quizzes", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          // The API returns studentQuizzes which wraps the actual quiz
          setQuizzes(data.quizzes);
        }
      } catch (error) {
        console.error("Failed to fetch quizzes", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchQuizzes();
  }, []);

  useEffect(() => {
    if (!userId) return;
    
    const pusher = new PusherClient(
      process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
      { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1", authEndpoint: "/api/pusher/auth" }
    );
    const channel = pusher.subscribe(`private-student-${userId}`);
    
    channel.bind("retake-decision", (data: any) => {
      if (data.action === "accept") {
        // Teacher accepted! Instantly redirect into the quiz or arena according to mode.
        const target = data.quizMode === "arena" ? `/arena/${data.quizId}` : `/quiz/${data.quizId}`;
        router.push(target);
      } else {
        // Teacher rejected. Refresh the page to show updated status.
        window.location.reload();
      }
    });

    return () => {
      channel.unbind("retake-decision");
      pusher.unsubscribe(`private-student-${userId}`);
      pusher.disconnect();
    };
  }, [userId, router]);

  const filtered = (quizzes || []).filter((e) => 
    (e?.quiz?.title || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-4">
            <h3 className="text-sm font-bold text-[var(--ink)]">📝 My Enrolled Quizzes</h3>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
            <input 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search quizzes..." 
              className="w-48 pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-indigo-500/50" 
            />
          </div>
        </div>
        
        <div className="overflow-x-auto min-h-[300px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
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
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25"
                            : "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
                        }`}>
                          {isArena ? "Power Arena" : "Live Monitored Exam"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--muted)]">{e.subject?.subjectName || "N/A"}</td>
                      <td className="px-5 py-3 text-sm text-[var(--ink)]">{e.duration} min</td>
                      <td className="px-5 py-3">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${isCompleted ? 'bg-emerald-500/15 text-emerald-600' : 'bg-indigo-500/15 text-indigo-600'}`}>
                          {enrollment.quizStatus?.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-500/15 text-slate-400">
                          {enrollment.aiVerdict ? enrollment.aiVerdict.toUpperCase() : "PENDING"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {!isCompleted ? (
                          <Link href={targetUrl}>
                            <button className="text-xs font-bold text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/20">
                              {isArena ? "Enter Arena" : "Take Quiz"}
                            </button>
                          </Link>
                        ) : (
                          <button 
                            onClick={() => setSelectedResult(enrollment)}
                            className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500 transition-colors"
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
