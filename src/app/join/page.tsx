"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Volume2,
  VolumeX,
  Shield,
  Zap,
  CheckCircle,
  HelpCircle,
} from "lucide-react";
import Link from "next/link";
import { normalizeQuizAccessCode } from "@/lib/quiz-access-code";
import {
  playBloop,
  playSuccessFanfare,
  playErrorBuzz,
  isSoundEnabled,
  toggleSoundEnabled,
} from "@/lib/student-gamify";

type JoinLookupResponse = {
  quiz: {
    id: number;
    title: string;
    teacher: string;
    quizMode: "proctored" | "arena";
    isArena: boolean;
    quizStatus: string;
  };
  destination: string;
  join: {
    eligible: boolean;
    reviewOnly: boolean;
    state: "joinable" | "review" | "closed";
    message: string;
  };
  arenaSession: { exists: boolean; status: string | null; sessionId: string | null } | null;
};

function JoinContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCode = searchParams.get("code") || "";

  const [joinCode, setJoinCode] = useState(initialCode.toUpperCase());
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [soundActive, setSoundActive] = useState(true);
  const [activeQuizzes, setActiveQuizzes] = useState<Array<{ id: number; title: string; accessCode?: string; quizMode?: string }>>([]);
  const [codeLookup, setCodeLookup] = useState<JoinLookupResponse | null>(null);
  const [isResolvingCode, setIsResolvingCode] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSoundActive(isSoundEnabled());
  }, []);

  useEffect(() => {
    async function loadQuickQuizzes() {
      try {
        const res = await fetch("/api/quizzes");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.quizzes)) {
            const live = data.quizzes
              .filter((q: any) => q && q.quiz && q.quizStatus !== "completed" && q.quiz.accessCode)
              .map((q: any) => ({
                id: q.quiz.id,
                title: q.quiz.title,
                accessCode: q.quiz.accessCode,
                quizMode: q.quiz.quizMode,
              }));
            setActiveQuizzes(live);
          }
        }
      } catch {
        // Non-blocking
      }
    }
    loadQuickQuizzes();
  }, []);

  useEffect(() => {
    const normalizedCode = normalizeQuizAccessCode(joinCode);
    if (normalizedCode.length < 3) {
      setCodeLookup(null);
      setIsResolvingCode(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsResolvingCode(true);
      try {
        const response = await fetch(`/api/quizzes/join?accessCode=${encodeURIComponent(normalizedCode)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok || !data?.quiz?.id) {
          setCodeLookup(null);
          return;
        }
        const lookup = data as JoinLookupResponse;
        setCodeLookup(lookup);
        setMessage(lookup.join.eligible ? "" : lookup.join.message);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setCodeLookup(null);
        }
      } finally {
        if (!controller.signal.aborted) setIsResolvingCode(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [joinCode]);

  const handleToggleSound = () => {
    const next = toggleSoundEnabled();
    setSoundActive(next);
    if (next) playBloop(640, 0.1);
  };

  const handleJoinQuiz = async (codeToUse?: string) => {
    const code = normalizeQuizAccessCode(codeToUse || joinCode);
    if (!code) {
      playErrorBuzz();
      setMessage("Please enter an access code to join.");
      inputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/quizzes/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code }),
      });

      const data = await res.json();

      const targetRoute = typeof data.destination === "string" && /^\/(?:arena|quiz)\/\d+$/.test(data.destination)
        ? data.destination
        : null;

      if (res.ok && data.quiz?.id && targetRoute) {
        playSuccessFanfare();
        setTimeout(() => {
          router.push(targetRoute);
        }, 250);
      } else if (res.ok) {
        playErrorBuzz();
        setMessage("The server did not return a valid quiz destination. Please try again.");
      } else if (res.status === 401) {
        localStorage.setItem("pendingJoinCode", code);
        router.push("/login/student");
      } else {
        playErrorBuzz();
        setMessage(data.error || "Quiz not found. Please verify your code.");
      }
    } catch {
      playErrorBuzz();
      setMessage("Network connection error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (initialCode) {
      handleJoinQuiz(initialCode);
    }
  }, [initialCode]);

  const handleInputChange = (val: string) => {
    const clean = val.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16);
    setJoinCode(clean);
    setCodeLookup(null);
    setMessage("");
    if (clean.length > joinCode.length) {
      playBloop(350 + Math.min(clean.length * 40, 400), 0.05);
    }
  };

  const normalizedJoinCode = normalizeQuizAccessCode(joinCode);
  const matchedAssignment = activeQuizzes.find(
    (quiz) => quiz.accessCode && normalizeQuizAccessCode(quiz.accessCode) === normalizedJoinCode,
  );
  const destinationName = codeLookup?.quiz.isArena || matchedAssignment?.quizMode === "arena" ? "Arena" : "Quiz";
  const isClosedCode = codeLookup?.join.state === "closed";

  return (
    <div
      className="min-h-screen flex flex-col relative overflow-x-hidden select-none"
      style={{
        backgroundColor: "#070b14",
        backgroundImage: "radial-gradient(circle at 50% 10%, #1e1548 0%, #0e1224 45%, #070b14 85%)",
        color: "#ffffff",
      }}
    >
      {/* Ambient Lighting Orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-[-5%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[120px] opacity-25"
          style={{ backgroundColor: "#4f46e5" }}
        />
        <div
          className="absolute bottom-[-10%] right-[-10%] w-[550px] h-[550px] rounded-full blur-[140px] opacity-20"
          style={{ backgroundColor: "#7c3aed" }}
        />
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, #6366f1 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
      </div>

      {/* Top Header */}
      <header
        className="relative z-20 w-full px-5 sm:px-8 py-4 flex items-center justify-between border-b backdrop-blur-md"
        style={{
          backgroundColor: "rgba(10, 15, 30, 0.85)",
          borderColor: "rgba(99, 102, 241, 0.2)",
        }}
      >
        <Link href="/dashboard/student" className="flex items-center gap-3 group">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-105"
            style={{
              background: "linear-gradient(135deg, #3b82f6 0%, #4f46e5 50%, #7c3aed 100%)",
              boxShadow: "0 8px 20px rgba(79, 70, 229, 0.3)",
            }}
          >
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl tracking-tight font-[family-name:var(--font-display)] text-white">
                ProctorShield<span style={{ color: "#818cf8" }}>AI</span>
              </span>
              <span
                className="text-[10px] uppercase font-black px-2 py-0.5 rounded-md"
                style={{
                  backgroundColor: "rgba(99, 102, 241, 0.2)",
                  color: "#a5b4fc",
                  border: "1px solid rgba(99, 102, 241, 0.35)",
                }}
              >
                Quiz Portal
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium -mt-0.5">
              Student Join Portal
            </p>
          </div>
        </Link>

        {/* Controls */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleToggleSound}
            aria-label={soundActive ? "Mute SFX" : "Enable SFX"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer"
            style={{
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "#e2e8f0",
            }}
          >
            {soundActive ? (
              <>
                <Volume2 className="w-4 h-4 text-emerald-400" />
                <span className="hidden sm:inline">SFX On</span>
              </>
            ) : (
              <>
                <VolumeX className="w-4 h-4 text-slate-400" />
                <span className="hidden sm:inline text-slate-400">SFX Off</span>
              </>
            )}
          </button>

          <Link
            href="/dashboard/student"
            aria-label="Back to Student Dashboard"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 text-white"
            style={{
              backgroundColor: "rgba(99, 102, 241, 0.25)",
              border: "1px solid rgba(99, 102, 241, 0.4)",
            }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 relative z-10 max-w-xl mx-auto w-full">
        {/* Join Guidance */}
        <div className="flex flex-col items-center mb-5 text-center">
          <div className="relative mb-3">
            <div
              className="w-20 h-20 sm:w-22 sm:h-22 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 p-1 shadow-2xl flex items-center justify-center"
              style={{
                boxShadow: "0 10px 30px rgba(79, 70, 229, 0.45)",
              }}
            >
              <Shield className="w-10 h-10 text-white drop-shadow-md" aria-hidden="true" />
            </div>
            <div
              className="absolute -bottom-1 -right-1 text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 text-white"
              style={{
                backgroundColor: "#10b981",
                border: "2px solid #070b14",
              }}
            >
              <Zap className="w-3 h-3 fill-white" /> Ready
            </div>
          </div>

          <div
            className="px-4 py-2 rounded-2xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 max-w-md shadow-lg"
            style={{
              backgroundColor: "rgba(18, 24, 46, 0.9)",
              border: "1px solid rgba(99, 102, 241, 0.3)",
              color: "#e2e8f0",
            }}
          >
            <span>
              <strong>{destinationName === "Arena" ? "Ready to enter the Power Arena?" : "Ready to test your knowledge?"}</strong> Enter your code below.
            </span>
          </div>
        </div>

        {/* Modal Card */}
        <div
          className="w-full rounded-3xl p-6 sm:p-8 relative"
          style={{
            backgroundColor: "#11182c",
            border: "2px solid rgba(99, 102, 241, 0.4)",
            boxShadow: "0 25px 60px rgba(0, 0, 0, 0.7), 0 0 50px rgba(99, 102, 241, 0.15)",
          }}
        >
          <div className="text-center mb-6">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white font-[family-name:var(--font-display)]">
              Enter {destinationName} Code
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 font-medium">
              Enter the room access code provided by your instructor
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleJoinQuiz();
            }}
            className="flex flex-col items-center gap-5 w-full"
          >
            {/* Centered Arcade-Style Input Pill */}
            <div className="w-full relative">
              <input
                ref={inputRef}
                type="text"
                value={joinCode}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder={`ENTER ${destinationName.toUpperCase()} CODE (e.g. PS-123)`}
                autoFocus
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={16}
                className="w-full py-4 px-6 text-center text-xl sm:text-2xl font-mono font-black tracking-[0.15em] sm:tracking-[0.2em] rounded-2xl text-white placeholder:text-slate-500 placeholder:tracking-normal placeholder:font-sans placeholder:text-base sm:placeholder:text-lg focus:outline-none transition-all uppercase"
                style={{
                  backgroundColor: "#090d1a",
                  border: "2px solid #4f46e5",
                  boxShadow: "inset 0 2px 6px rgba(0, 0, 0, 0.6), 0 0 20px rgba(99, 102, 241, 0.2)",
                }}
              />
              {joinCode.length > 0 && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-mono font-bold text-indigo-400 bg-indigo-950/80 px-2 py-0.5 rounded-md border border-indigo-500/30">
                  {joinCode.length} chars
                </div>
              )}
            </div>

            {codeLookup && (
              <div className="w-full rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-left">
                <div className="text-xs font-black uppercase tracking-wider text-indigo-300">
                  {codeLookup.quiz.isArena ? "Power Arena" : "Proctored Quiz"}
                </div>
                <div className="mt-1 text-sm font-bold text-white">{codeLookup.quiz.title}</div>
                <div className="mt-0.5 text-xs text-slate-300">
                  Instructor: {codeLookup.quiz.teacher}
                  {codeLookup.join.reviewOnly ? " · Results review only" : ""}
                </div>
              </div>
            )}

            {/* Error / Alert Message */}
            {message && (
              <div
                className="w-full text-center text-xs sm:text-sm font-bold py-2.5 px-4 rounded-xl"
                style={{
                  backgroundColor: "rgba(225, 29, 72, 0.15)",
                  border: "1px solid rgba(225, 29, 72, 0.4)",
                  color: "#fecdd3",
                }}
              >
                {message}
              </div>
            )}

            {/* Tactile 3D Action Button */}
            <button
              type="submit"
              disabled={isLoading || isResolvingCode || isClosedCode || joinCode.trim().length === 0}
              className="w-full py-4 rounded-2xl font-black text-base sm:text-lg uppercase tracking-wider flex items-center justify-center gap-3 transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #7c3aed 100%)",
                color: "#ffffff",
                boxShadow: "0 6px 0 #312e81, 0 12px 25px rgba(79, 70, 229, 0.4)",
              }}
              onMouseDown={(e) => {
                if (!isLoading && joinCode.trim().length > 0) {
                  e.currentTarget.style.transform = "translateY(3px)";
                  e.currentTarget.style.boxShadow = "0 2px 0 #312e81, 0 6px 15px rgba(79, 70, 229, 0.3)";
                }
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 6px 0 #312e81, 0 12px 25px rgba(79, 70, 229, 0.4)";
              }}
            >
              {isLoading || isResolvingCode ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-white" />
                  <span>{isResolvingCode ? "Checking Code..." : `Entering ${destinationName}...`}</span>
                </>
              ) : (
                <>
                  <span>{codeLookup?.join.reviewOnly ? "Review Arena" : `Join ${destinationName}`}</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          {/* Active Assigned Quizzes (Quick Chips) */}
          {activeQuizzes.length > 0 && (
            <div
              className="mt-5 pt-4"
              style={{ borderTop: "1px solid rgba(255, 255, 255, 0.1)" }}
            >
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Active Assignments For You</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {activeQuizzes.slice(0, 3).map((quiz) => (
                  <button
                    key={quiz.id}
                    type="button"
                    onClick={() => {
                      if (quiz.accessCode) {
                        setJoinCode(quiz.accessCode);
                        handleJoinQuiz(quiz.accessCode);
                      } else {
                        const target = quiz.quizMode === "arena" ? `/arena/${quiz.id}` : `/quiz/${quiz.id}`;
                        router.push(target);
                      }
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    style={{
                      backgroundColor: "rgba(99, 102, 241, 0.2)",
                      border: "1px solid rgba(99, 102, 241, 0.35)",
                      color: "#c7d2fe",
                    }}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="truncate max-w-[140px]">{quiz.title}</span>
                    <span
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded font-bold"
                      style={{ backgroundColor: "rgba(0, 0, 0, 0.4)", color: "#a5b4fc" }}
                    >
                      {quiz.accessCode || "JOIN"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Security & Features Badges */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-slate-400 text-xs font-semibold">
          {destinationName === "Arena" ? (
            <>
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span className="text-slate-300">Live Multiplayer Arena</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-amber-400" />
                <span className="text-slate-300">Score-Based Powers</span>
              </div>
              <div className="flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-blue-400" />
                <span className="text-slate-300">No Exam Proctoring</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span className="text-slate-300">AI Verified Proctoring</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-amber-400" />
                <span className="text-slate-300">Instant Results</span>
              </div>
              <div className="flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-blue-400" />
                <span className="text-slate-300">Anti-Cheating Guard</span>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center text-white font-bold"
          style={{ backgroundColor: "#070b14" }}
        >
          <div className="flex items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            <span>Loading ProctorShield Arena...</span>
          </div>
        </div>
      }
    >
      <JoinContent />
    </Suspense>
  );
}
