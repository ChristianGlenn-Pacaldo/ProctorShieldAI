"use client";

import { useState, useEffect, useTransition } from "react";
import {
  FileText,
  CheckCircle2,
  BarChart3,
  Shield,
  Zap,
  Flame,
  ArrowRight,
  Clock,
  Sparkles,
  Volume2,
  VolumeX,
  Compass,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MASCOTS,
  playBloop,
  playSuccessFanfare,
  playErrorBuzz,
  isSoundEnabled,
  toggleSoundEnabled,
} from "@/lib/student-gamify";
import { normalizeQuizAccessCode, QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH } from "@/lib/quiz-access-code";

interface StudentQuiz {
  id: string;
  score: number | null;
  quizStatus: string | null;
  cheatingProbability: number | null;
  aiVerdict: string | null;
  createdAt: string;
  attemptMode?: string | null;
  quiz?: {
    id: number;
    title: string;
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

export default function StudentDashboardContent() {
  const router = useRouter();
  const [studentQuizzes, setStudentQuizzes] = useState<StudentQuiz[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [quickCode, setQuickCode] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [soundActive, setSoundActive] = useState(true);
  const [activeMascotId, setActiveMascotId] = useState("shield");
  const [progression, setProgression] = useState<{
    totalExp: number;
    level: number;
    currentLevelExp: number;
    expToNextLevel: number;
    progressPercent: number;
    title: string;
  }>({
    totalExp: 0,
    level: 1,
    currentLevelExp: 0,
    expToNextLevel: 500,
    progressPercent: 0,
    title: "Novice Cadet",
  });
  const [, startTransition] = useTransition();

  useEffect(() => {
    setSoundActive(isSoundEnabled());
    const savedMascot = localStorage.getItem("proctor_chosen_mascot");
    if (savedMascot) setActiveMascotId(savedMascot);

    async function loadProgression() {
      try {
        const res = await fetch("/api/student/progression");
        if (res.ok) {
          const data = await res.json();
          if (typeof data.totalExp === "number") {
            setProgression({
              totalExp: data.totalExp,
              level: data.level,
              currentLevelExp: data.currentLevelExp,
              expToNextLevel: data.expToNextLevel,
              progressPercent: data.progressPercent,
              title: data.title,
            });
          }
          if (data.equippedAvatar) {
            setActiveMascotId(data.equippedAvatar);
            localStorage.setItem("proctor_chosen_mascot", data.equippedAvatar);
          }
        }
      } catch {}
    }
    loadProgression();
  }, []);

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

  const handleQuickJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = normalizeQuizAccessCode(quickCode);
    if (!code) {
      playErrorBuzz();
      setJoinError("Please enter an access code");
      return;
    }

    setJoinLoading(true);
    setJoinError("");

    try {
      const res = await fetch("/api/quizzes/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code }),
      });

      const data = await res.json();
      if (res.ok && data.quiz?.id) {
        playSuccessFanfare();
        const target = data.quiz.quizMode === "arena" ? `/arena/${data.quiz.id}` : `/quiz/${data.quiz.id}`;
        startTransition(() => {
          router.push(target);
        });
      } else {
        playErrorBuzz();
        setJoinError(data.error || "Quiz room not found.");
      }
    } catch {
      playErrorBuzz();
      setJoinError("Network error. Try again.");
    } finally {
      setJoinLoading(false);
    }
  };

  const handleToggleSound = () => {
    const next = toggleSoundEnabled();
    setSoundActive(next);
    if (next) playBloop(600, 0.08);
  };

  // Filter valid student quiz records
  const validQuizzes = studentQuizzes.filter((se) => se && se.quiz);
  const completed = validQuizzes.filter((se) => se.quizStatus === "completed");
  const upcoming = validQuizzes.filter((se) => se.quizStatus !== "completed");

  const completedCount = completed.length;
  const upcomingCount = upcoming.length;

  let avgScore = 0;
  const recordedResults = completed.filter(
    (se) => se.score !== null && se.aiVerdict !== "cheated"
  );
  if (recordedResults.length > 0) {
    const totalScore = recordedResults.reduce((sum, se) => sum + Number(se.score), 0);
    avgScore = Math.round(totalScore / recordedResults.length);
  }

  let avgTrust = 100;
  if (completedCount > 0) {
    const totalCheatProb = completed.reduce(
      (sum, se) => sum + (Number(se.cheatingProbability) || 0),
      0
    );
    avgTrust = Math.max(0, 100 - Math.round(totalCheatProb / completedCount));
  }

  const currentMascot = MASCOTS.find((m) => m.id === activeMascotId) || MASCOTS[0];

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* ── GAMIFIED HERO ARENA BANNER ────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950 via-[#0e1630] to-[#090e21] border-2 border-indigo-500/20 p-6 sm:p-8 text-white shadow-xl shadow-indigo-950/30">
        {/* Ambient Glows */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/15 blur-[90px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-64 h-64 bg-violet-600/10 blur-[80px] rounded-full pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          {/* Student Status & Mascot */}
          <div className="flex items-center gap-4 sm:gap-5">
            <div
              className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br ${currentMascot.color} p-1 shadow-lg shadow-indigo-500/25 flex items-center justify-center text-3xl sm:text-4xl transition-transform hover:scale-105 select-none`}
            >
              <span>{currentMascot.emoji}</span>
            </div>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs uppercase font-extrabold px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-yellow-300" />
                  Level {progression.level} • {progression.title}
                </span>

                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                  <Flame className="w-3 h-3 text-orange-400 animate-pulse" />
                  {progression.totalExp.toLocaleString()} Total EXP
                </span>

                <Link
                  href="/join/avatar-shop"
                  className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-white/10 hover:bg-white/20 text-slate-200 border border-white/20 flex items-center gap-1 hover:scale-105 transition-transform"
                  title="Customize 2D Avatar for Free"
                >
                  <span>Customize Avatar</span>
                </Link>
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-1.5 font-[family-name:var(--font-display)]">
                Student Arena Dashboard
              </h1>

              {/* XP Progress Bar */}
              <div className="w-60 sm:w-80 mt-2">
                <div className="flex justify-between text-[11px] font-bold text-white/70 mb-1">
                  <span>{progression.totalExp.toLocaleString()} EXP</span>
                  <span>
                    {progression.expToNextLevel} EXP to Level {progression.level + 1}
                  </span>
                </div>
                <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5 border border-white/10">
                  <div
                    className="h-full bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-400 rounded-full transition-all duration-500"
                    style={{ width: `${progression.progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Quick-Join Game Box */}
          <div className="w-full lg:w-auto bg-white/5 border border-white/15 rounded-2xl p-4 sm:p-5 backdrop-blur-md shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-200 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-yellow-400" />
                Quick-Join Room
              </span>
              <button
                type="button"
                onClick={handleToggleSound}
                className="text-[11px] text-white/60 hover:text-white flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-white/10 transition-all"
              >
                {soundActive ? (
                  <>
                    <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> SFX On
                  </>
                ) : (
                  <>
                    <VolumeX className="w-3.5 h-3.5 text-white/40" /> SFX Off
                  </>
                )}
              </button>
            </div>

            <form onSubmit={handleQuickJoin} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={quickCode}
                onChange={(e) => {
                  setQuickCode(e.target.value.toUpperCase());
                  setJoinError("");
                  playBloop(450, 0.05);
                }}
                maxLength={QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH}
                placeholder="Enter 6-Digit Code"
                className="px-4 py-2.5 text-center font-mono font-bold tracking-widest text-sm rounded-xl bg-black/30 border border-white/15 text-white placeholder:text-white/30 placeholder:tracking-normal focus:outline-none focus:border-indigo-400 focus:bg-black/50 uppercase"
              />
              <button
                type="submit"
                disabled={joinLoading || quickCode.length < 3}
                className="px-5 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white shadow-[0_3px_0_#312e81] active:translate-y-0.5 active:shadow-none transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5"
              >
                {joinLoading ? "Joining..." : "Enter Room"}
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            {joinError && (
              <p className="text-[11px] text-rose-300 font-semibold mt-1.5">{joinError}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── VIBRANT GAMIFIED METRIC TILES ─────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--surface)] rounded-2xl border-2 border-indigo-500/20 p-5 shadow-xs hover:border-indigo-500/40 transition-all group">
          <div className="flex items-center justify-between mb-3">
            <div className="w-11 h-11 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <FileText className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
              Assigned
            </span>
          </div>
          <div className="text-3xl font-black text-[var(--ink)] tracking-tight font-[family-name:var(--font-display)]">
            {upcomingCount}
          </div>
          <div className="text-xs font-semibold text-[var(--muted)] mt-1">
            Active Challenges
          </div>
        </div>

        <div className="bg-[var(--surface)] rounded-2xl border-2 border-emerald-500/20 p-5 shadow-xs hover:border-emerald-500/40 transition-all group">
          <div className="flex items-center justify-between mb-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              Completed
            </span>
          </div>
          <div className="text-3xl font-black text-[var(--ink)] tracking-tight font-[family-name:var(--font-display)]">
            {completedCount}
          </div>
          <div className="text-xs font-semibold text-[var(--muted)] mt-1">
            Quizzes Conquered
          </div>
        </div>

        <div className="bg-[var(--surface)] rounded-2xl border-2 border-amber-500/20 p-5 shadow-xs hover:border-amber-500/40 transition-all group">
          <div className="flex items-center justify-between mb-3">
            <div className="w-11 h-11 rounded-xl bg-amber-600/10 text-amber-600 dark:text-amber-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <BarChart3 className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
              Accuracy
            </span>
          </div>
          <div className="text-3xl font-black text-[var(--ink)] tracking-tight font-[family-name:var(--font-display)]">
            {completedCount > 0 ? `${avgScore}%` : "0%"}
          </div>
          <div className="text-xs font-semibold text-[var(--muted)] mt-1">
            Average Score
          </div>
        </div>

        <div className="bg-[var(--surface)] rounded-2xl border-2 border-violet-500/20 p-5 shadow-xs hover:border-violet-500/40 transition-all group">
          <div className="flex items-center justify-between mb-3">
            <div className="w-11 h-11 rounded-xl bg-violet-600/10 text-violet-600 dark:text-violet-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Shield className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400">
              AI Verified
            </span>
          </div>
          <div className="text-3xl font-black text-[var(--ink)] tracking-tight font-[family-name:var(--font-display)]">
            {completedCount > 0 ? `${avgTrust}%` : "100%"}
          </div>
          <div className="text-xs font-semibold text-[var(--muted)] mt-1">
            Proctor Trust Index
          </div>
        </div>
      </div>

      {/* ── ACTIVE MISSIONS (UPCOMING QUIZZES) ────────────────────── */}
      <div className="bg-[var(--surface)] rounded-3xl border border-[var(--border)] shadow-xs p-6">
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border)] mb-4">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-indigo-500" />
            <h2 className="text-base font-extrabold text-[var(--ink)] font-[family-name:var(--font-display)]">
              Live & Assigned Quiz Missions
            </h2>
          </div>
          <Link
            href="/join"
            className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
          >
            Enter Code Manually <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {isFetching ? (
          <div className="py-8 text-center text-sm text-[var(--muted)] animate-pulse">
            Scanning for active missions...
          </div>
        ) : upcoming.length === 0 ? (
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
              return (
                <div
                  key={se.id}
                  className="rounded-2xl border-2 border-indigo-500/20 hover:border-indigo-500/50 bg-gradient-to-b from-[var(--surface)] to-[var(--surface2)]/40 p-5 transition-all duration-200 flex flex-col justify-between group shadow-sm hover:shadow-md"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${
                          se.quiz.quizMode === "arena"
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25"
                            : "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/20"
                        }`}>
                          {se.quiz.quizMode === "arena" ? "Power Arena" : "Live Monitored Exam"}
                        </span>
                        <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
                          {se.quiz.subject?.subjectName || "General Exam"}
                        </span>
                      </div>
                      <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                        Room Open
                      </span>
                    </div>

                    <h3 className="text-base font-extrabold text-[var(--ink)] group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {se.quiz.title || "Untitled Quiz Arena"}
                    </h3>

                    <div className="flex items-center gap-3 text-xs text-[var(--muted)] mt-2">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-indigo-400" />
                        {se.quiz.duration ? `${se.quiz.duration} mins` : "Standard Timer"}
                      </span>
                      {se.quiz.teacher?.fullName && (
                        <span>• By {se.quiz.teacher.fullName}</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-[var(--border)] flex items-center justify-between">
                    {se.quiz.accessCode && (
                      <span className="text-xs font-mono font-bold text-[var(--muted)] bg-[var(--surface2)] px-2.5 py-1 rounded-lg">
                        CODE: {se.quiz.accessCode}
                      </span>
                    )}

                    <Link
                      href={se.quiz.quizMode === "arena" ? `/arena/${se.quiz.id}` : `/quiz/${se.quiz.id}`}
                      onClick={() => playSuccessFanfare()}
                      className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-[0_3px_0_#312e81] active:translate-y-0.5 active:shadow-none transition-all"
                    >
                      <span>{se.quiz.quizMode === "arena" ? "Enter Arena" : "Take Quiz"}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── GAMIFIED PROGRESSION JOURNEY & RECENT TRIUMPHS ────────── */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Progression & Level Journey */}
        <div className="bg-[var(--surface)] rounded-3xl border border-[var(--border)] p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-500" />
                <h2 className="text-base font-extrabold text-[var(--ink)] font-[family-name:var(--font-display)]">
                  Student Progression
                </h2>
              </div>
              <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                Level {progression.level} • {progression.title}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/10 via-violet-500/5 to-transparent border border-indigo-500/20 mb-4">
              <div className="flex items-center gap-4 mb-3">
                <div
                  className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${currentMascot.color} p-1 shadow-md flex items-center justify-center text-2xl select-none`}
                >
                  <span>{currentMascot.emoji}</span>
                </div>
                <div>
                  <div className="text-sm font-extrabold text-[var(--ink)]">
                    {currentMascot.name}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {progression.totalExp.toLocaleString()} Total EXP
                  </div>
                </div>
                <Link
                  href="/join/avatar-shop"
                  className="ml-auto text-xs font-bold px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-xs"
                >
                  Change Avatar
                </Link>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-[var(--ink)]">Level {progression.level}</span>
                  <span className="text-indigo-600 dark:text-indigo-400">
                    {progression.expToNextLevel} EXP to Level {progression.level + 1}
                  </span>
                </div>
                <div className="h-3 w-full bg-black/10 dark:bg-white/10 rounded-full overflow-hidden p-0.5 border border-indigo-500/20">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500 rounded-full transition-all duration-500"
                    style={{ width: `${progression.progressPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-[var(--muted)]">
                  <span>{progression.currentLevelExp} / 500 EXP in Current Tier</span>
                  <span>{progression.progressPercent}% Complete</span>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--surface2)]/40 border border-[var(--border)] text-xs text-[var(--muted)] flex items-center gap-2.5">
              <Flame className="w-4 h-4 text-amber-500 shrink-0" />
              <span>Earn EXP by participating in Power Arena matches and completing proctored exams.</span>
            </div>
          </div>
        </div>

        {/* Recent Triumphs (Quiz Results) */}
        <div className="bg-[var(--surface)] rounded-3xl border border-[var(--border)] p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-emerald-500" />
                <h2 className="text-base font-extrabold text-[var(--ink)] font-[family-name:var(--font-display)]">
                  Recent Exam Results
                </h2>
              </div>
              <Link
                href="/dashboard/student/results"
                className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                View Full Log
              </Link>
            </div>

            {isFetching ? (
              <p className="py-6 text-xs text-[var(--muted)] animate-pulse text-center">
                Loading exam results...
              </p>
            ) : completed.length === 0 ? (
              <p className="py-6 text-xs text-[var(--muted)] italic text-center">
                No completed exams yet. Take your first quiz or enter an arena match!
              </p>
            ) : (
              <div className="space-y-3">
                {completed.slice(0, 4).map((se) => {
                  if (!se.quiz) return null;
                  const isClean = se.aiVerdict === "clean";
                  const isSuspicious = se.aiVerdict === "suspicious";
                  const verdictLabel = isClean
                    ? "✓ Verified Clean"
                    : isSuspicious
                    ? "⚠ Under Review"
                    : "🚫 Cheated";
                  const verdictClass = isClean
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                    : isSuspicious
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";

                  return (
                    <div
                      key={se.id}
                      className="flex items-center justify-between p-3.5 rounded-2xl bg-[var(--surface2)]/40 border border-[var(--border)] hover:bg-[var(--surface2)] transition-colors"
                    >
                      <div>
                        <div className="text-xs sm:text-sm font-bold text-[var(--ink)]">
                          {se.quiz.title || "Untitled Quiz"}
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {se.quiz.subject?.subjectName || "General Exam"}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-xs sm:text-sm font-black text-[var(--ink)]">
                            {se.aiVerdict === "cheated"
                              ? "Voided"
                              : se.score !== null
                              ? `${se.score}%`
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
              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              See detailed question breakdown & certificates →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
