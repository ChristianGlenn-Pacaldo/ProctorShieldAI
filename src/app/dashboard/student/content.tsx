"use client";

import { useState, useEffect, useTransition, useRef, useCallback } from "react";
import {
  FileText,
  CheckCircle2,
  BarChart3,
  Zap,
  ArrowRight,
  Clock,
  Volume2,
  VolumeX,
  Compass,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  playBloop,
  playSuccessFanfare,
  playErrorBuzz,
  isSoundEnabled,
  toggleSoundEnabled,
} from "@/lib/student-gamify";
import { normalizeQuizAccessCode, QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH } from "@/lib/quiz-access-code";
import { useUserSessionWork, UserSessionReauthentication } from "@/components/user-session-lifecycle";
import { averageExamScore, studentResultState } from "@/lib/student-result-summary";

interface StudentQuiz {
  id: string;
  score: number | null;
  quizStatus: string | null;
  cheatingProbability: number | null;
  aiVerdict: string | null;
  createdAt: string;
  attemptMode?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  attemptNumber?: number;
  _count?: { violations: number };
  quiz?: {
    id: number;
    title: string;
    quizStatus: string;
    duration: number | null;
    accessCode: string | null;
    quizMode?: string | null;
    subject?: {
      subjectName: string;
    } | null;
    teacher?: {
      fullName: string;
    } | null;
  } | null;
}

function getMissionState(enrollment: StudentQuiz) {
  const status = enrollment.quizStatus;
  const quizStatus = enrollment.quiz?.quizStatus;
  const isArena = enrollment.quiz?.quizMode === "arena";

  if (status === "pending_approval") return { label: "Awaiting Approval", actionable: false };
  if (status === "rejected") return { label: "Entry Rejected", actionable: false };
  if (status === "pending_retake") return { label: "Retake Pending", actionable: false };
  if (status === "submitting") return { label: "Submitting", actionable: false };
  if (status === "ended" || quizStatus === "ended" && status !== "in_progress" && !(status === "enrolled" && !isArena && (enrollment.attemptNumber ?? 1) > 1)) {
    return { label: "Quiz Ended", actionable: false };
  }
  if (status === "enrolled" && !enrollment.endTime) {
    if (quizStatus === "active" || quizStatus === "waiting") {
      return { label: "Waiting for Teacher", actionable: true, actionLabel: isArena ? "Enter Arena" : "Open Lobby" };
    }
    if (quizStatus === "in_progress" || quizStatus === "ended" && !isArena && (enrollment.attemptNumber ?? 1) > 1) {
      return { label: "Room Open", actionable: true, actionLabel: isArena ? "Enter Arena" : "Take Quiz" };
    }
  }
  if (status === "in_progress" && enrollment.startTime && !enrollment.endTime && (quizStatus === "in_progress" || quizStatus === "ended")) {
    return { label: "In Progress", actionable: true, actionLabel: isArena ? "Resume Arena" : "Resume Quiz" };
  }
  return { label: "Unavailable", actionable: false };
}

export default function StudentDashboardContent() {
  const router = useRouter();
  const [studentQuizzes, setStudentQuizzes] = useState<StudentQuiz[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [hasLoadedQuizzes, setHasLoadedQuizzes] = useState(false);
  const [quizLoadError, setQuizLoadError] = useState("");
  const [quickCode, setQuickCode] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [soundActive, setSoundActive] = useState(true);
  const [, startTransition] = useTransition();
  const { work, loss } = useUserSessionWork(() => {
    setStudentQuizzes([]); setQuickCode("");
    setHasLoadedQuizzes(false); setQuizLoadError(""); setJoinError("");
    setIsFetching(false); setJoinLoading(false);
  });

  const quizRequestSequence = useRef(0);
  const fetchQuizzes = useCallback(async () => {
    const request = work.beginRequest();
    if (!request) return;
    const sequence = ++quizRequestSequence.current;
    const isCurrent = () => work.isCurrent(request.generation) && !request.controller.signal.aborted
      && sequence === quizRequestSequence.current;
    setIsFetching(true);
    try {
      const res = await fetch("/api/quizzes", { cache: "no-store", signal: request.controller.signal });
      if (!await work.acceptResponse(res, request)) return;
      if (!isCurrent()) return;
      if (!res.ok) throw new Error("Could not load your quizzes.");
      const data = await res.json();
      if (!isCurrent()) return;
      if (data.success !== true || !Array.isArray(data.quizzes)) throw new Error("Could not load your quizzes.");
      setStudentQuizzes(data.quizzes);
      setHasLoadedQuizzes(true);
      setQuizLoadError("");
    } catch (error) {
      if (!isCurrent()) return;
      console.error("Failed to fetch quizzes:", error);
      setQuizLoadError("Could not load your quizzes.");
    } finally {
      if (isCurrent()) setIsFetching(false);
      work.finishRequest(request.controller);
    }
  }, [work]);

  useEffect(() => {
    setSoundActive(isSoundEnabled());
    void fetchQuizzes();
  }, [fetchQuizzes]);

  const handleQuickJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!work.isCurrent(work.capture())) return;
    const code = normalizeQuizAccessCode(quickCode);
    if (!code) {
      playErrorBuzz();
      setJoinError("Please enter an access code");
      return;
    }

    setJoinLoading(true);
    setJoinError("");
    const request = work.beginRequest();
    if (!request) return;

    try {
      const res = await fetch("/api/quizzes/join", {
        method: "POST",
        signal: request.controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code }),
      });

      if (!await work.acceptResponse(res, request)) return;
      const data = await res.json();
      if (!work.isCurrent(request.generation) || request.controller.signal.aborted) return;
      if (res.ok && data.quiz?.id) {
        playSuccessFanfare();
        const target = data.quiz.quizMode === "arena" ? `/arena/${data.quiz.id}` : `/quiz/${data.quiz.id}`;
        startTransition(() => {
          if (!work.isCurrent(request.generation)) return;
          router.push(target);
        });
      } else {
        playErrorBuzz();
        setJoinError(data.error || "Quiz room not found.");
      }
    } catch {
      if (!work.isCurrent(request.generation) || request.controller.signal.aborted) return;
      playErrorBuzz();
      setJoinError("Network error. Try again.");
    } finally {
      if (work.isCurrent(request.generation)) setJoinLoading(false);
      work.finishRequest(request.controller);
    }
  };

  const handleToggleSound = () => {
    const next = toggleSoundEnabled();
    setSoundActive(next);
    if (next) playBloop(600, 0.08);
  };

  // Filter valid student quiz records
  if (loss) return <UserSessionReauthentication status={loss} />;
  const validQuizzes = studentQuizzes.filter((se) => se && se.quiz);
  const completed = validQuizzes.filter((se) => studentResultState(se).isCompleted);
  const upcoming = validQuizzes.filter((se) => se.quizStatus !== "completed");

  const completedCount = completed.length;

  const avgScore = averageExamScore(validQuizzes);

  return (
    <div className="ps-student-page ps-glass-overview min-w-0 space-y-6 animate-fade-in pb-12">
      {/* Class-based overrides follow the shell's selected theme, not the OS theme. */}
      <div className="ps-student-hero ps-glass-card relative overflow-hidden rounded-3xl border p-6 sm:p-8 text-[var(--ink)]">

        <div className="relative z-10 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6">
          {/* Student Status */}
          <div className="flex min-w-0 items-center gap-4 sm:gap-5">
            <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-2xl bg-gradient-to-br from-[var(--ps-primary)] to-[var(--ps-primary)] p-1 shadow-lg flex items-center justify-center">
              <UserRound className="w-8 h-8 sm:w-10 sm:h-10 text-[var(--ps-on-primary)]" aria-hidden="true" />
            </div>

            <div className="min-w-0">
              <h1 className="break-words text-2xl sm:text-3xl font-extrabold tracking-tight mt-1.5 font-[family-name:var(--font-display)]">
                Student Dashboard
              </h1>

            </div>
          </div>

          {/* Quick-Join Game Box */}
          <div className="ps-student-card ps-glass-frame w-full min-w-0 xl:w-auto xl:max-w-md bg-[var(--surface)] border border-[var(--border2)] rounded-2xl p-4 sm:p-5 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[var(--ink2)] flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-[var(--ps-gold)] " />
                Quick-Join Room
              </span>
              <button
                type="button"
                onClick={handleToggleSound}
                className="text-[11px] text-[var(--ink3)] hover:text-[var(--ink)] flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-[var(--surface2)] transition-all focus-visible:outline-2 focus-visible:outline-[var(--ps-focus)] focus-visible:outline-offset-2"
              >
                {soundActive ? (
                  <>
                    <Volume2 className="w-3.5 h-3.5 text-[var(--ps-success)] " /> SFX On
                  </>
                ) : (
                  <>
                    <VolumeX className="w-3.5 h-3.5 text-[var(--ink3)]" /> SFX Off
                  </>
                )}
              </button>
            </div>

            <form onSubmit={handleQuickJoin} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                aria-label="Quiz access code"
                value={quickCode}
                onChange={(e) => {
                  setQuickCode(e.target.value.toUpperCase());
                  setJoinError("");
                  playBloop(450, 0.05);
                }}
                maxLength={QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH}
                placeholder="Access code"
                className="ps-glass-dense w-full min-w-0 sm:w-auto sm:flex-1 px-4 py-2.5 text-center font-mono font-bold tracking-widest text-sm rounded-xl bg-[var(--surface2)] border border-[var(--border2)] text-[var(--ink)] placeholder:text-[var(--ink3)] placeholder:tracking-normal focus-visible:outline-2 focus-visible:outline-[var(--ps-focus)] focus-visible:outline-offset-2 uppercase"
              />
              <button
                type="submit"
                disabled={joinLoading || quickCode.length < 3}
                className="px-5 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-[var(--ps-primary)] to-[var(--ps-primary)] hover:from-[var(--ps-primary)] hover:to-[var(--ps-primary)] text-[var(--ps-on-primary)] shadow-sm active:translate-y-0.5 active:shadow-none transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline-2 focus-visible:outline-[var(--ps-focus)] focus-visible:outline-offset-2"
              >
                {joinLoading ? "Joining..." : "Enter Room"}
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            {joinError && (
              <p role="alert" className="break-words text-[11px] text-[var(--ps-error)]  font-semibold mt-1.5">{joinError}</p>
            )}
          </div>
        </div>
      </div>

      {quizLoadError && (
        <div role="alert" className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-error-soft)] px-4 py-3 text-sm text-[var(--ps-error)] ">
          {quizLoadError} <button type="button" onClick={() => void fetchQuizzes()} className="font-bold underline">Retry</button>
        </div>
      )}

      {/* ── VIBRANT GAMIFIED METRIC TILES ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="ps-student-card ps-glass-card min-w-0 bg-[var(--surface)] rounded-2xl border-2 border-[var(--ps-border)] p-3 sm:p-5 shadow-xs hover:border-[var(--ps-border)] transition-all group">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="w-11 h-11 rounded-xl bg-[var(--ps-success-soft)] text-[var(--ps-success)]  flex items-center justify-center group-hover:scale-110 transition-transform">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-[var(--ps-success-soft)] text-[var(--ps-success)] ">
              Completed
            </span>
          </div>
          <div className="text-3xl font-black text-[var(--ink)] tracking-tight font-[family-name:var(--font-display)]">
            {hasLoadedQuizzes ? completedCount : "—"}
          </div>
          <div className="text-xs font-semibold text-[var(--muted)] mt-1">
            Quizzes Conquered
          </div>
        </div>

        <div className="ps-student-card ps-glass-card min-w-0 bg-[var(--surface)] rounded-2xl border-2 border-[var(--ps-border)] p-3 sm:p-5 shadow-xs hover:border-[var(--ps-border)] transition-all group">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="w-11 h-11 rounded-xl bg-[var(--ps-gold-soft)] text-[var(--ps-gold)]  flex items-center justify-center group-hover:scale-110 transition-transform">
              <BarChart3 className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-[var(--ps-gold-soft)] text-[var(--ps-gold)] ">
              Accuracy
            </span>
          </div>
          <div className="text-3xl font-black text-[var(--ink)] tracking-tight font-[family-name:var(--font-display)]">
            {hasLoadedQuizzes ? (completedCount > 0 ? `${avgScore}%` : "0%") : "—"}
          </div>
          <div className="text-xs font-semibold text-[var(--muted)] mt-1">
            Average Exam Score
          </div>
        </div>

      </div>

      {/* ── ACTIVE MISSIONS (UPCOMING QUIZZES) ────────────────────── */}
      <div className="ps-student-card ps-glass-card bg-[var(--surface)] rounded-3xl border border-[var(--border)] shadow-xs p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--border)] mb-4">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-[var(--ps-accent)]" />
            <h2 className="text-base font-extrabold text-[var(--ink)] font-[family-name:var(--font-display)]">
              Available & Live Quizzes
            </h2>
          </div>
          <Link
            href="/join"
            className="text-xs font-bold text-[var(--ps-accent)]  hover:underline flex items-center gap-1"
          >
            Enter Code Manually <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {isFetching && !hasLoadedQuizzes ? (
          <div className="py-8 text-center text-sm text-[var(--muted)] animate-pulse">
            Scanning for active missions...
          </div>
        ) : !hasLoadedQuizzes ? null : upcoming.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-3xl mb-2">🎉</div>
            <p className="text-sm font-bold text-[var(--ink)]">All caught up!</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              No pending quizzes right now. Ask your instructor for an access code or join one above.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {upcoming.map((se) => {
              if (!se.quiz) return null;
              const missionState = getMissionState(se);
              return (
                <div
                  key={se.id}
                  className="ps-glass-dense rounded-2xl border-2 border-[var(--ps-border)] hover:border-[var(--ps-border)] bg-gradient-to-b from-[var(--surface)] to-[var(--surface2)]/40 p-5 transition-all duration-200 flex flex-col justify-between group shadow-sm hover:shadow-md"
                >
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${
                          se.quiz.quizMode === "arena"
                            ? "bg-[var(--ps-gold-soft)] text-[var(--ps-gold)]  border-[var(--ps-border)]"
                            : "bg-[var(--ps-accent-soft)] text-[var(--ps-accent)]  border-[var(--ps-border)]"
                        }`}>
                          {se.quiz.quizMode === "arena" ? "Power Arena" : "Live Monitored Exam"}
                        </span>
                        <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-full bg-[var(--ps-surface-inset)] text-[var(--ink3)] border border-[var(--ps-border)]">
                          {se.quiz.subject?.subjectName || "General Exam"}
                        </span>
                      </div>
                      <span className={`text-[10px] font-black px-2.5 py-1 rounded-full flex items-center gap-1 ${missionState.actionable ? "bg-[var(--ps-success-soft)] text-[var(--ps-success)] " : "bg-[var(--ps-surface-inset)] text-[var(--ps-text-muted)] "}`}>
                        {missionState.actionable && <span className="w-1.5 h-1.5 rounded-full bg-[var(--ps-primary)]" />}
                        {missionState.label}
                      </span>
                    </div>

                    <h3 className="break-words text-base font-extrabold text-[var(--ink)] group-hover:text-[var(--ps-accent)]  transition-colors">
                      {se.quiz.title || "Untitled Quiz Arena"}
                    </h3>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)] mt-2">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-[var(--ps-accent)] " />
                        {se.quiz.duration ? `${se.quiz.duration} mins` : "Standard Timer"}
                      </span>
                      {se.quiz.teacher?.fullName && (
                        <span>• By {se.quiz.teacher.fullName}</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-wrap gap-2 items-center justify-between">
                    {se.quiz.accessCode && (
                      <span className="text-xs font-mono font-bold text-[var(--muted)] bg-[var(--surface2)] px-2.5 py-1 rounded-lg">
                        CODE: {se.quiz.accessCode}
                      </span>
                    )}

                    {missionState.actionable && (
                      <Link
                        href={se.quiz.quizMode === "arena" ? `/arena/${se.quiz.id}` : `/quiz/${se.quiz.id}`}
                        onClick={() => playSuccessFanfare()}
                        className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-[var(--ps-on-primary)] bg-gradient-to-r from-[var(--ps-primary)] to-[var(--ps-primary)] hover:from-[var(--ps-primary)] hover:to-[var(--ps-primary)] shadow-sm active:translate-y-0.5 active:shadow-none transition-all"
                      >
                        <span>{missionState.actionLabel}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── GAMIFIED PROGRESSION JOURNEY & RECENT TRIUMPHS ────────── */}
      <div className="grid gap-6">
        {/* Recent Triumphs (Quiz Results) */}
        <div className="ps-student-card ps-glass-card bg-[var(--surface)] rounded-3xl border border-[var(--border)] p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-[var(--ps-success)]" />
                <h2 className="text-base font-extrabold text-[var(--ink)] font-[family-name:var(--font-display)]">
                  Recent Results
                </h2>
              </div>
              <Link
                href="/dashboard/student/results"
                className="text-xs font-bold text-[var(--ps-accent)]  hover:underline"
              >
                View Full Log
              </Link>
            </div>

            {isFetching && !hasLoadedQuizzes ? (
              <p className="py-6 text-xs text-[var(--muted)] animate-pulse text-center">
                Loading exam results...
              </p>
            ) : !hasLoadedQuizzes ? null : completed.length === 0 ? (
              <p className="py-6 text-xs text-[var(--muted)] italic text-center">
                No completed exams yet. Take your first quiz or enter an arena match!
              </p>
            ) : (
              <div className="space-y-3">
                {completed.slice(0, 4).map((se) => {
                  if (!se.quiz) return null;
                  const resultState = studentResultState(se);
                  const isClean = se.aiVerdict === "clean";
                  const isSuspicious = se.aiVerdict === "suspicious";
                  const verdictLabel = resultState.isArena
                    ? "Match Completed"
                    : resultState.integrityInvalidated
                    ? "Invalidated"
                    : isClean
                    ? "✓ Verified Clean"
                    : isSuspicious
                    ? "⚠ Under Review"
                    : se.aiVerdict === "cheated" ? "🚫 Cheated" : "Pending Review";
                  const verdictClass = resultState.isArena || (isClean && !resultState.integrityInvalidated)
                    ? "bg-[var(--ps-success-soft)] text-[var(--ps-success)]  border-[var(--ps-border)]"
                    : isSuspicious && !resultState.integrityInvalidated
                    ? "bg-[var(--ps-gold-soft)] text-[var(--ps-gold)]  border-[var(--ps-border)]"
                    : "bg-[var(--ps-error-soft)] text-[var(--ps-error)]  border-[var(--ps-border)]";

                  return (
                    <div
                      key={se.id}
                      className="ps-glass-dense flex flex-wrap gap-3 items-center justify-between p-3.5 rounded-2xl bg-[var(--surface2)]/40 border border-[var(--border)] hover:bg-[var(--surface2)] transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-xs sm:text-sm font-bold text-[var(--ink)]">
                          {se.quiz.title || "Untitled Quiz"}
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {se.quiz.subject?.subjectName || "General Exam"}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        <div className="text-right">
                          <div className="text-xs sm:text-sm font-black text-[var(--ink)]">
                            {resultState.integrityInvalidated
                              ? "Voided"
                              : se.score !== null
                              ? `${se.score}${resultState.isArena ? " pts" : "%"}`
                              : "—"}
                          </div>
                          <span
                            className={`text-[9px] font-extrabold px-2 py-0.5 rounded-md border ${verdictClass}`}
                          >
                            {verdictLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-[var(--border)] text-center">
            <Link
              href="/dashboard/student/results"
              className="text-xs font-bold text-[var(--ps-accent)]  hover:underline"
            >
              See detailed question breakdown & certificates →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
