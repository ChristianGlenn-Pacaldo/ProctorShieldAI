"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Volume2,
  VolumeX,
  Zap,
  CheckCircle,
  HelpCircle,
} from "lucide-react";
import Link from "next/link";
import BrandImage from "@/components/brand-image";
import styles from "./join.module.css";
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

  const [authState, setAuthState] = useState<"checking" | "student" | "guest" | "wrong-role" | "unavailable">("checking");
  const [authRetry, setAuthRetry] = useState(0);
  const joining = useRef(false);
  const autoJoined = useRef("");
  const joinRequest = useRef<AbortController | null>(null);
  const [joinCode, setJoinCode] = useState(initialCode.toUpperCase());
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [soundActive, setSoundActive] = useState(true);
  const [activeQuizzes, setActiveQuizzes] = useState<Array<{ id: number; title: string; accessCode?: string; quizMode?: string }>>([]);
  const [codeLookup, setCodeLookup] = useState<JoinLookupResponse | null>(null);
  const [isResolvingCode, setIsResolvingCode] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    setAuthState("checking");
    fetch("/api/auth/session?scope=user", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setAuthState("guest");
          if (initialCode) router.replace("/login?joinCode=" + encodeURIComponent(initialCode));
        } else if (!response.ok || !data.authenticated) setAuthState("unavailable");
        else setAuthState(data.user?.role === "student" ? "student" : "wrong-role");
      }).catch(() => { if (active) setAuthState("unavailable"); }).finally(() => window.clearTimeout(timer));
    return () => { active = false; window.clearTimeout(timer); controller.abort(); joinRequest.current?.abort(); };
  }, [initialCode, authRetry, router]);

  useEffect(() => {
    setSoundActive(isSoundEnabled());
  }, []);

  useEffect(() => {
    if (authState !== "student") return;
    const controller = new AbortController();
    async function loadQuickQuizzes() {
      try {
        const res = await fetch("/api/quizzes", { signal: controller.signal, cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (!controller.signal.aborted && Array.isArray(data.quizzes)) {
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
    void loadQuickQuizzes();
    return () => controller.abort();
  }, [authState]);

  useEffect(() => {
    if (authState !== "student") return;
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
        if (controller.signal.aborted) return;
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
  }, [joinCode, authState]);

  const handleToggleSound = () => {
    const next = toggleSoundEnabled();
    setSoundActive(next);
    if (next) playBloop(640, 0.1);
  };

  const handleJoinQuiz = useCallback(async (codeToUse?: string) => {
    if (joining.current) return;
    const code = normalizeQuizAccessCode(codeToUse || joinCode);
    if (!code) {
      playErrorBuzz();
      setMessage("Please enter an access code to join.");
      inputRef.current?.focus();
      return;
    }

    if (authState !== "student") {
      if (authState === "guest") router.replace("/login?joinCode=" + encodeURIComponent(code));
      else setMessage("Sign in with a Student account before joining.");
      return;
    }
    joining.current = true;
    const controller = new AbortController(); joinRequest.current = controller;
    setIsLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/quizzes/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code }),
        signal: controller.signal,
      });

      const data = await res.json();
      if (controller.signal.aborted) return;

      const targetRoute = typeof data.destination === "string" && /^\/(?:arena|quiz)\/\d+$/.test(data.destination)
        ? data.destination
        : null;

      if (res.ok && data.quiz?.id && targetRoute) {
        playSuccessFanfare();
        router.push(targetRoute);
      } else if (res.ok) {
        playErrorBuzz();
        setMessage("The server did not return a valid quiz destination. Please try again.");
      } else if (res.status === 401) {
        router.replace("/login?joinCode=" + encodeURIComponent(code));
      } else {
        playErrorBuzz();
        setMessage(data.error || "Quiz not found. Please verify your code.");
      }
    } catch {
      if (!controller.signal.aborted) { playErrorBuzz(); setMessage("Network connection error. Please try again."); }
    } finally {
      joining.current = false;
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [authState, joinCode, router]);

  useEffect(() => {
    if (initialCode && authState === "student" && autoJoined.current !== initialCode) {
      autoJoined.current = initialCode;
      void handleJoinQuiz(initialCode);
    }
  }, [initialCode, authState, handleJoinQuiz]);

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

  if (authState === "checking" || authState === "unavailable" || authState === "wrong-role") {
    return <main className="auth-shell min-h-svh flex items-center justify-center p-4 text-[var(--ps-text)]">
      <section className="w-full max-w-md rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4" aria-labelledby="join-account-heading">
        <h1 id="join-account-heading" className="text-xl font-bold">{authState === "checking" ? "Checking Student sign-in..." : authState === "wrong-role" ? "Student account required" : "Sign-in check unavailable"}</h1>
        <p role="status">{authState === "wrong-role" ? "Your current account cannot join as a Student. Your code is preserved." : authState === "unavailable" ? "Retry the sign-in check. No quiz details have been loaded." : "Please wait while we check your account."}</p>
        {authState === "unavailable" && <button type="button" className="min-h-11 px-4 rounded-lg border" onClick={() => setAuthRetry(value => value + 1)}>Retry sign-in check</button>}
        {authState === "wrong-role" && <Link className="inline-flex min-h-11 items-center underline" href={"/login?joinCode=" + encodeURIComponent(initialCode || joinCode)}>Sign in with a Student account</Link>}
        <Link className="inline-flex min-h-11 items-center underline" href="/">Return home</Link>
      </section>
    </main>;
  }
  return (
    <div
      className={`${styles.screen} min-h-screen flex flex-col relative select-none`}
      style={{
        backgroundColor: "var(--ps-canvas)",
        backgroundImage: "radial-gradient(ellipse at 50% 10%, var(--ps-accent-soft), transparent 70%)",
        color: "var(--ps-text)",
      }}
    >
      {/* Ambient Lighting Orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-[-5%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[120px] opacity-25"
          style={{ backgroundColor: "var(--ps-primary)" }}
        />
        <div
          className="absolute bottom-[-10%] right-[-10%] w-[550px] h-[550px] rounded-full blur-[140px] opacity-20"
          style={{ backgroundColor: "var(--ps-gold)" }}
        />
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, var(--ps-accent) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
      </div>

      {/* Top Header */}
      <header
        className={`${styles.header} relative z-20 w-full px-5 sm:px-8 py-4 flex items-center justify-between border-b backdrop-blur-md`}
        style={{
          backgroundColor: "var(--ps-glass)",
          borderColor: "var(--ps-accent-soft)",
        }}
      >
        <Link href="/dashboard/student" className={`${styles.brand} flex items-center gap-3 group`}>
          <BrandImage width={35} decorative />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl tracking-tight font-[family-name:var(--font-display)] text-white">
                ProctorShield<span style={{ color: "var(--ps-gold)" }}>AI</span>
              </span>
              <span
                className="text-[10px] uppercase font-black px-2 py-0.5 rounded-md"
                style={{
                  backgroundColor: "var(--ps-accent-soft)",
                  color: "var(--ps-accent)",
                  border: "1px solid var(--ps-border)",
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
        <div className={`${styles.controls} flex items-center gap-2.5`}>
          <button
            type="button"
            onClick={handleToggleSound}
            aria-label={soundActive ? "Mute SFX" : "Enable SFX"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer"
            style={{
              backgroundColor: "var(--ps-surface-inset)",
              border: "1px solid var(--ps-border-control)",
              color: "var(--ps-text-secondary)",
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
              backgroundColor: "var(--ps-accent-soft)",
              border: "1px solid var(--ps-border-control)",
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
            <BrandImage width={70} decorative />
            <div
              className="absolute -bottom-1 -right-1 text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 text-white"
              style={{
                backgroundColor: "var(--ps-success-soft)",
                border: "2px solid var(--ps-canvas)",
              }}
            >
              <Zap className="w-3 h-3 fill-white" /> Ready
            </div>
          </div>

          <div
            className="px-4 py-2 rounded-2xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 max-w-md shadow-lg"
            style={{
              backgroundColor: "var(--ps-glass)",
              border: "1px solid var(--ps-border)",
              color: "var(--ps-text-secondary)",
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
            backgroundColor: "var(--ps-glass)",
            border: "2px solid var(--ps-border)",
            boxShadow: "var(--ps-shadow-overlay)",
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
                aria-label={`Enter ${destinationName} Code`}
                placeholder="PS-123"
                autoFocus
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={16}
                className="w-full py-4 px-6 text-center text-xl sm:text-2xl font-mono font-black tracking-[0.15em] sm:tracking-[0.2em] rounded-2xl text-white placeholder:text-slate-500 placeholder:tracking-normal placeholder:font-sans placeholder:text-base sm:placeholder:text-lg focus:outline-none transition-all uppercase"
                style={{
                  backgroundColor: "var(--ps-surface-inset)",
                  border: "2px solid var(--ps-border-control)",
                  boxShadow: "var(--ps-shadow)",
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
                  backgroundColor: "var(--ps-error-soft)",
                  border: "1px solid var(--ps-error)",
                  color: "var(--ps-error)",
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
                background: "var(--ps-primary)",
                color: "var(--ps-on-primary)",
                boxShadow: "0 6px 0 var(--ps-primary-hover), var(--ps-shadow)",
              }}
              onMouseDown={(e) => {
                if (!isLoading && joinCode.trim().length > 0) {
                  e.currentTarget.style.transform = "translateY(3px)";
                  e.currentTarget.style.boxShadow = "0 2px 0 var(--ps-primary-hover), var(--ps-shadow)";
                }
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 6px 0 var(--ps-primary-hover), var(--ps-shadow)";
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
              style={{ borderTop: "1px solid var(--ps-border)" }}
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
                      backgroundColor: "var(--ps-accent-soft)",
                      border: "1px solid var(--ps-border)",
                      color: "var(--ps-text)",
                    }}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="truncate max-w-[140px]">{quiz.title}</span>
                    <span
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded font-bold"
                      style={{ backgroundColor: "var(--ps-surface-inset)", color: "var(--ps-accent)" }}
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
          className={`${styles.screen} min-h-screen flex items-center justify-center text-white font-bold`}
          style={{ backgroundColor: "var(--ps-canvas)" }}
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
