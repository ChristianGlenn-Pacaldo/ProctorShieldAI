"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";

function JoinContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCode = searchParams.get("code") || "";
  
  const [joinCode, setJoinCode] = useState(initialCode);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleJoinQuiz = async (codeToUse?: string) => {
    const code = codeToUse || joinCode;
    if (!code.trim()) {
      setMessage("Please enter an access code.");
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/quizzes/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code.toUpperCase() }),
      });

      const data = await res.json();

      if (res.ok && data.quiz?.id) {
        // Redirect directly into the quiz lobby!
        router.push(`/quiz/${data.quiz.id}`);
      } else if (res.status === 401) {
        // Not logged in. Save code and redirect to student login.
        localStorage.setItem("pendingJoinCode", code.toUpperCase());
        router.push("/login/student");
      } else {
        setMessage(data.error || "Failed to join quiz");
      }
    } catch (error) {
      setMessage("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Automatically attempt join if code is provided in the URL.
  useEffect(() => {
    if (initialCode) {
      handleJoinQuiz(initialCode);
    }
  }, [initialCode]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--dark-bg)] bg-gradient-to-br from-indigo-950/20 via-[var(--dark-bg)] to-violet-950/20 relative overflow-hidden">
      
      {/* Background Decor */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-indigo-500/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Header (Minimal) */}
      <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-sm">
            🛡️
          </div>
          <span className="font-bold text-white font-[var(--font-display)]">Proctor Shield AI</span>
        </Link>
        <Link href="/login/student" className="text-sm font-semibold text-white/60 hover:text-white transition-colors">
          Log in
        </Link>
      </div>

      <div className="w-full max-w-md p-8 relative z-10 animate-fade-in-up">
        
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-white mb-2 font-[family-name:var(--font-display)]">
            Join a Quiz
          </h1>
          <p className="text-sm text-white/50">
            Enter the 7-character access code provided by your instructor.
          </p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-xl shadow-2xl">
          <form 
            onSubmit={(e) => { e.preventDefault(); handleJoinQuiz(); }}
            className="flex flex-col gap-4"
          >
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter join code"
              className="w-full px-6 py-5 text-center text-2xl font-bold tracking-[0.2em] rounded-2xl bg-black/20 border border-white/10 text-white placeholder:text-white/20 placeholder:tracking-normal focus:outline-none focus:border-indigo-500/50 focus:bg-black/40 transition-all uppercase"
              maxLength={10}
              autoFocus
            />

            {message && (
              <div className="text-center text-sm font-semibold text-red-400 bg-red-500/10 py-2 rounded-xl border border-red-500/20">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-4 text-white font-bold rounded-2xl transition-all shadow-lg flex items-center justify-center gap-2 group ${isLoading ? 'bg-indigo-400 cursor-not-allowed shadow-none' : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/25'}`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Joining...
                </>
              ) : (
                <>
                  Join Now
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--dark-bg)]" />}>
      <JoinContent />
    </Suspense>
  );
}
