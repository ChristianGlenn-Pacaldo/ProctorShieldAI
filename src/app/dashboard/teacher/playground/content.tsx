"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Swords,
  Crown,
  Sparkles,
  Zap,
  Play,
  ArrowRight,
  Lock,
  CheckCircle2,
  Users,
  X,
  Search,
  Tv,
} from "lucide-react";

interface QuizSummary {
  id: number;
  title: string;
  description: string;
  accessCode: string;
  quizType: string;
  quizStatus: string;
  duration: number;
  passingScore: number;
  subjectName: string;
  subjectCode: string;
  questionsCount: number;
  attemptsCount: number;
  createdAt: string;
}

interface PlaygroundContentProps {
  isSubscribed: boolean;
  planName: string;
  teacherId: string;
  teacherName: string;
  quizzes: QuizSummary[];
}

export default function PlaygroundContent({
  isSubscribed,
  planName,
  quizzes,
}: PlaygroundContentProps) {
  const router = useRouter();

  // Launch Arena Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedQuizId, setSelectedQuizId] = useState<number | null>(
    quizzes.length > 0 ? quizzes[0].id : null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [matchDuration, setMatchDuration] = useState<1800 | 3600>(1800);
  const [powers, setPowers] = useState({
    meteor: true,
    earthquake: true,
    blizzard: true,
    shield: true,
  });

  const filteredQuizzes = quizzes.filter(
    (q) =>
      q.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.subjectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.accessCode.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedQuiz = quizzes.find((q) => q.id === selectedQuizId);

  const handleLaunchArena = async () => {
    if (!selectedQuizId) return;
    try {
      // Explicitly create a fresh Arena session authoritatively via POST
      await fetch(`/api/arena/${selectedQuizId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_session",
          payload: {
            mode: "score_arena",
            matchDuration,
            enabledPowers: Object.entries(powers)
              .filter(([, v]) => v)
              .map(([k]) => k),
          },
        }),
      });
    } catch (err) {
      console.error("Failed to create fresh arena session:", err);
    }

    const query = new URLSearchParams({
      mode: "score_arena",
      duration: matchDuration.toString(),
      powers: Object.entries(powers)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(","),
    });
    router.push(`/dashboard/teacher/playground/arena/${selectedQuizId}?${query.toString()}`);
  };

  // ─────────────────────────────────────────────────────────────
  // 1. FREE / UNSUBSCRIBED TEACHER: PRO LOCK SCREEN
  // ─────────────────────────────────────────────────────────────
  if (!isSubscribed) {
    return (
      <div className="min-h-full p-4 sm:p-8 space-y-8 max-w-6xl mx-auto">
        {/* Top Lock Banner */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950/90 to-purple-950 border-2 border-amber-400/40 p-8 sm:p-12 shadow-2xl text-white">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="space-y-4 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-amber-400/20 to-yellow-500/20 border border-amber-400/40 text-amber-300 text-xs font-black tracking-wider uppercase">
                <Crown className="w-4 h-4 text-amber-400" />
                PRO EXCLUSIVE FEATURE
              </div>
              <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white font-[family-name:var(--font-display)]">
                ProctorShield <span className="bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 bg-clip-text text-transparent">Playground</span> & ProctorShield Arena
              </h1>
              <p className="text-base sm:text-lg text-indigo-200/80 leading-relaxed">
                Transform ordinary tests into high-energy live multiplayer battlegrounds. Students duel in real time using elemental attacks (Meteors, Earthquakes, Blizzards) and defense shields while racing to answer your quiz questions.
              </p>
            </div>

            <div className="flex flex-col gap-3 w-full sm:w-auto shrink-0">
              <Link
                href="/dashboard/teacher/billing"
                className="inline-flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-slate-950 font-black text-base shadow-xl shadow-amber-400/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                <Zap className="w-5 h-5 fill-slate-950" />
                Upgrade to Pro to Unlock
                <ArrowRight className="w-5 h-5" />
              </Link>
              <div className="text-center text-xs text-indigo-300/60 font-medium">
                Current Plan: <span className="text-amber-300 font-bold">{planName}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 hover:border-amber-400/40 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-500/20 to-amber-500/20 border border-amber-400/30 flex items-center justify-center text-2xl">
              ⚔️
            </div>
            <h3 className="text-lg font-bold text-white">Live ProctorShield Arena Battle</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Students answer questions continuously to charge powers, then target classmates with ☄️ Meteors (-100 PTS), 🌋 Earthquakes (-60 PTS), and ❄️ Blizzards (-40 PTS), or defend with 🛡️ Guardian Shields.
            </p>
            <div className="inline-flex items-center gap-1.5 text-xs text-amber-400 font-semibold">
              <Lock className="w-3.5 h-3.5" /> Requires Pro Subscription
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 hover:border-amber-400/40 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-cyan-400/30 flex items-center justify-center text-2xl">
              📺
            </div>
            <h3 className="text-lg font-bold text-white">Projector Command Center</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Designed for live projection in classroom whiteboards or screen shares. Broadcast real-time student scores, combat telemetry, live rankings, and dynamic podiums.
            </p>
            <div className="inline-flex items-center gap-1.5 text-xs text-amber-400 font-semibold">
              <Lock className="w-3.5 h-3.5" /> Requires Pro Subscription
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 hover:border-indigo-400/40 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-400/30 flex items-center justify-center text-2xl">
              ⚡
            </div>
            <h3 className="text-lg font-bold text-white">Classroom EXP Progression</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Top Arena podium winners and all participants earn authoritative EXP to level up their student rank.
            </p>
            <div className="inline-flex items-center gap-1.5 text-xs text-amber-400 font-semibold">
              <Lock className="w-3.5 h-3.5" /> Requires Pro Subscription
            </div>
          </div>
        </div>

        {/* Preview Teaser Banner */}
        <div className="p-6 sm:p-8 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="space-y-1 text-center sm:text-left">
            <div className="text-base font-bold text-white">Ready to elevate your classroom engagement?</div>
            <div className="text-sm text-slate-400">Upgrade today and host unlimited live arena sessions with up to 100 students per match.</div>
          </div>
          <Link
            href="/dashboard/teacher/billing"
            className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-md transition-all shrink-0"
          >
            View Pro Plans
          </Link>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // 2. SUBSCRIBED TEACHER: FULL PLAYGROUND STUDIO
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full p-4 sm:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-2">
            <Crown className="w-3.5 h-3.5 text-amber-400" />
            PRO ACTIVE • {planName}
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight font-[family-name:var(--font-display)]">
            Playground & Live Game Studio
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Host live interactive game modes to engage students and boost active participation with real-time progression.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 text-slate-950 font-black text-sm shadow-lg shadow-amber-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
        >
          <Swords className="w-4 h-4 text-slate-950" />
          Launch Arena Game
        </button>
      </div>

      {/* Featured Arena Game Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 border-2 border-indigo-500/30 p-6 sm:p-10 shadow-xl text-white">
        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-40 w-64 h-64 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
          <div className="space-y-4 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-extrabold uppercase tracking-wide">
                🔥 POPULAR MODE
              </span>
              <span className="px-3 py-1 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300 text-xs font-bold">
                Real-Time Live Multiplayer
              </span>
            </div>

            <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight font-[family-name:var(--font-display)] flex items-center gap-3">
              <Swords className="w-8 h-8 text-amber-400" />
              ProctorShield Arena
            </h2>

            <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
              The ultimate classroom Power Arena. Students answer quiz questions continuously, earning power-ups like <span className="text-amber-300 font-bold">☄️ Meteors (-100 PTS)</span>, <span className="text-orange-300 font-bold">🌋 Earthquakes (-60 PTS)</span>, <span className="text-cyan-300 font-bold">❄️ Blizzards (-40 PTS)</span>, and <span className="text-blue-300 font-bold">🛡️ Guardian Shields</span> to duel their classmates and claim the championship prize pool.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
                <Users className="w-3.5 h-3.5 text-blue-400" />
                Up to 100 Players + AI Bots
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
                <Tv className="w-3.5 h-3.5 text-purple-400" />
                Projector & Smartboard Ready
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                EXP & Level Progression
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 w-full sm:w-auto shrink-0">
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-400 text-slate-950 font-black text-base shadow-xl shadow-amber-400/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
            >
              <Play className="w-5 h-5 fill-slate-950" />
              Host ProctorShield Arena Now
            </button>
            <div className="text-xs text-center text-slate-400">
              Pick any quiz from your library to start
            </div>
          </div>
        </div>
      </div>

      {/* Teacher Quizzes Quick Play Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            Quick Launch From Your Library
          </h3>
          <span className="text-xs text-slate-400 font-medium">{quizzes.length} Quizzes Available</span>
        </div>

        {quizzes.length === 0 ? (
          <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-3">
            <div className="text-3xl">📚</div>
            <div className="text-base font-bold text-white">No Quizzes Created Yet</div>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Create a quiz first in your teacher dashboard before launching a ProctorShield Arena match.
            </p>
            <Link
              href="/dashboard/teacher/quizzes"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs"
            >
              Create New Quiz
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {quizzes.map((quiz) => (
              <div
                key={quiz.id}
                className="group p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-amber-400/40 hover:bg-slate-900 transition-all flex flex-col justify-between gap-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px] font-bold">
                      {quiz.subjectName} ({quiz.subjectCode})
                    </span>
                    <span className="text-xs text-slate-400 font-mono font-semibold">
                      PIN: {quiz.accessCode || "N/A"}
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-white group-hover:text-amber-300 transition-colors line-clamp-1">
                    {quiz.title}
                  </h4>
                  <p className="text-xs text-slate-400 line-clamp-2">
                    {quiz.description || "No description provided."}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <div className="text-xs text-slate-400">
                    <span className="font-bold text-white">{quiz.questionsCount}</span> Questions
                  </div>
                  <button
                    onClick={() => {
                      setSelectedQuizId(quiz.id);
                      setIsModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 text-amber-300 text-xs font-bold transition-all cursor-pointer"
                  >
                    <Swords className="w-3.5 h-3.5" />
                    Launch Arena
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          3. LAUNCH ARENA CONFIGURATION MODAL
      ───────────────────────────────────────────────────────────── */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsModalOpen(false);
          }}
        >
          <div
            className="relative w-full max-w-2xl max-h-[calc(100dvh-2rem)] rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl p-5 sm:p-6 space-y-5 overflow-y-auto my-auto flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex shrink-0 items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center text-slate-950 font-black shadow-md">
                  <Swords className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white font-[family-name:var(--font-display)]">
                    Setup ProctorShield Arena
                  </h3>
                  <div className="text-xs text-slate-400">Configure your live battle rules and rewards</div>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quiz Selector */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                1. Select Quiz For Match
              </label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search your quizzes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-hidden focus:border-amber-400/60"
                />
              </div>

              <div className="max-h-40 overflow-y-auto space-y-1.5 pt-1 pr-1">
                {filteredQuizzes.length === 0 ? (
                  <div className="text-xs text-slate-500 py-4 text-center">No matching quizzes found.</div>
                ) : (
                  filteredQuizzes.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setSelectedQuizId(q.id)}
                      className={`w-full text-left p-3 rounded-xl border text-xs flex items-center justify-between transition-all cursor-pointer ${
                        selectedQuizId === q.id
                          ? "bg-amber-400/15 border-amber-400/50 text-white"
                          : "bg-slate-950/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/50"
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-bold truncate text-sm">{q.title}</div>
                        <div className="text-slate-400 text-[11px]">
                          {q.subjectName} • {q.questionsCount} Questions • PIN: {q.accessCode}
                        </div>
                      </div>
                      {selectedQuizId === q.id && (
                        <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Game Rules Config */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Game Rules Informational Card */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  2. Power Arena Rules
                </label>
                <div className="p-3.5 rounded-xl border border-amber-400/40 bg-amber-400/10 text-white space-y-1">
                  <div className="font-black text-xs flex items-center gap-1.5 text-amber-300">
                    <span>⚡ Score-Based Power Arena</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Answer questions, earn points, and strategically reduce rival scores using battle powers.
                  </p>
                </div>
              </div>

              {/* Match Duration */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  2. Arena Match Duration
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMatchDuration(1800)}
                    className={`py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      matchDuration === 1800
                        ? "bg-amber-400 text-slate-950 border-amber-400 font-black"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    30 Minutes
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatchDuration(3600)}
                    className={`py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      matchDuration === 3600
                        ? "bg-amber-400 text-slate-950 border-amber-400 font-black"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    1 Hour
                  </button>
                </div>
              </div>
            </div>

            {/* Powers Toggle */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                5. Enabled Elemental Powers
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { key: "meteor", label: "Meteor", icon: "☄️", sub: "-100 PTS Strike" },
                  { key: "earthquake", label: "Earthquake", icon: "🌋", sub: "-60 PTS Tremor" },
                  { key: "blizzard", label: "Blizzard", icon: "❄️", sub: "-40 PTS Frost" },
                  { key: "shield", label: "Shield", icon: "🛡️", sub: "Deflect Attack" },
                ].map((p) => {
                  const active = powers[p.key as keyof typeof powers];
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() =>
                        setPowers((prev) => ({
                          ...prev,
                          [p.key]: !prev[p.key as keyof typeof prev],
                        }))
                      }
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        active
                          ? "bg-indigo-950/60 border-indigo-500/50 text-white"
                          : "bg-slate-950/40 border-slate-800 text-slate-500 opacity-60"
                      }`}
                    >
                      <div className="text-lg">{p.icon}</div>
                      <div className="font-bold text-xs mt-1">{p.label}</div>
                      <div className="text-[10px] text-slate-400">{p.sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
              <div className="text-xs text-slate-400 text-center sm:text-left">
                Ready to host {selectedQuiz ? `"${selectedQuiz.title}"` : "selected quiz"}
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer text-center"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selectedQuizId}
                  onClick={handleLaunchArena}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-black text-xs shadow-md shadow-amber-500/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-slate-950" />
                  Create Arena Lobby
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
