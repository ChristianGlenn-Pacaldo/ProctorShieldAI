"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FREE_MANUAL_QUIZ_LIMIT,
  FREE_STUDENT_LIMIT_PER_QUIZ,
  PRO_MONTHLY_PRICE_PHP,
  PRO_STUDENT_LIMIT_PER_QUIZ,
} from "@/lib/subscription-rules";
import {
  Shield,
  ShieldCheck,
  Camera,
  Brain,
  MonitorX,
  Mic,
  PlayCircle,
  Sparkles,
  ArrowRight,
  Zap,
  CheckCircle2,
  Lock,
  Eye,
  Activity,
  Award,
  Users,
  Cpu,
  Layers,
} from "lucide-react";

const features = [
  {
    icon: <Camera className="w-6 h-6 text-sky-400" />,
    badge: "Vision AI 2.0",
    title: "Real-Time AI Face & Gaze Detection",
    desc: "Sub-millisecond biometric face tracking powered by neural vision. Instantly identifies absences, multiple people, and gaze shifts with 99.2%+ precision.",
    gradient: "from-sky-500/20 via-blue-600/10 to-transparent",
    border: "border-sky-500/30",
    badgeColor: "bg-sky-500/10 text-sky-300 border-sky-500/25",
  },
  {
    icon: <ShieldCheck className="w-6 h-6 text-emerald-400" />,
    badge: "Zero Latency",
    title: "Automated Evidence Capture & Timestamping",
    desc: "Every flagged event captures high-resolution photographic snapshots tied to UTC millisecond records, generating an indisputable cryptographic audit trail.",
    gradient: "from-emerald-500/20 via-teal-600/10 to-transparent",
    border: "border-emerald-500/30",
    badgeColor: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
  },
  {
    icon: <Brain className="w-6 h-6 text-violet-400" />,
    badge: "Google Gemini 2.0",
    title: "Gemini AI Forensic Verdict",
    desc: "Post-exam, Google Gemini AI synthesizes all infraction timelines, optical telemetry, and behavioral cues to produce an unbiased cheating probability verdict.",
    gradient: "from-violet-500/20 via-purple-600/10 to-transparent",
    border: "border-violet-500/30",
    badgeColor: "bg-violet-500/10 text-violet-300 border-violet-500/25",
  },
  {
    icon: <MonitorX className="w-6 h-6 text-rose-400" />,
    badge: "Kiosk Sandbox",
    title: "Tab-Switch & Multi-Window Guard",
    desc: "Comprehensive browser lockdown immediately detects screen minimization, secondary windows, split-screen cheats, and lost page focus.",
    gradient: "from-rose-500/20 via-red-600/10 to-transparent",
    border: "border-rose-500/30",
    badgeColor: "bg-rose-500/10 text-rose-300 border-rose-500/25",
  },
  {
    icon: <Mic className="w-6 h-6 text-amber-400" />,
    badge: "Acoustic AI",
    title: "Neural Audio & Whisper Radar",
    desc: "Real-time decibel analysis and acoustic pattern recognition flags suspicious background whisperings, external coaching, and unauthorized devices.",
    gradient: "from-amber-500/20 via-orange-600/10 to-transparent",
    border: "border-amber-500/30",
    badgeColor: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  },
  {
    icon: <PlayCircle className="w-6 h-6 text-cyan-400" />,
    badge: "Interactive CCTV",
    title: "Millisecond Evidence Video Replay",
    desc: "Full timeline scrubber lets teachers jump directly into high-risk moments with synced video snapshots, violation indicators, and confidence tags.",
    gradient: "from-cyan-500/20 via-blue-600/10 to-transparent",
    border: "border-cyan-500/30",
    badgeColor: "bg-cyan-500/10 text-cyan-300 border-cyan-500/25",
  },
];

const steps = [
  {
    num: "01",
    tag: "Teachers",
    title: "Create Quiz & Enable Sentinel",
    desc: "Draft questions manually or generate entire curriculums with Gemini AI. Set timer constraints and activate AI biometric proctoring in a single click.",
    icon: <Cpu className="w-6 h-6 text-blue-400" />,
  },
  {
    num: "02",
    tag: "Students",
    title: "Enter Pin & Join Gamified Arena",
    desc: "Students enter a 6-digit room PIN, choose their custom spirit mascot or 2D avatar, and enter a verified, distraction-free examination arena.",
    icon: <Zap className="w-6 h-6 text-amber-400" />,
  },
  {
    num: "03",
    tag: "Gemini AI",
    title: "Live Proctoring & Certified Verdict",
    desc: "AI monitors real-time integrity continuously. Upon submission, teachers receive instant forensic reports detailing risk score and evidence logs.",
    icon: <Brain className="w-6 h-6 text-emerald-400" />,
  },
];

export default function LandingPage() {
  const router = useRouter();
  const [quickCode, setQuickCode] = useState("");

  const handleQuickJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = quickCode.trim().toUpperCase();
    if (clean) {
      router.push(`/join?code=${encodeURIComponent(clean)}`);
    } else {
      router.push("/join");
    }
  };

  return (
    <div className="proctor-cyber-background min-h-screen text-slate-100 overflow-x-hidden selection:bg-blue-600 selection:text-white">
      {/* ── ATMOSPHERIC CYBER-SHIELD SYSTEM (INSPIRED BY WAYGROUND, ELEVATED FOR PROCTORSHIELD) ── */}
      <div className="proctor-cyber-grid" />
      <div className="proctor-cyber-dots" />

      {/* Dynamic Ambient Glowing Nebula Spheres */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-0">
        <div
          className="absolute -top-[15%] left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full blur-[160px] animate-pulse-glow"
          style={{ background: "radial-gradient(circle, rgba(37, 99, 235, 0.32) 0%, rgba(99, 102, 241, 0.18) 50%, transparent 80%)" }}
        />
        <div
          className="absolute top-[35%] -left-[12%] w-[650px] h-[650px] rounded-full blur-[150px] animate-pulse-glow"
          style={{ background: "radial-gradient(circle, rgba(14, 165, 233, 0.22) 0%, rgba(37, 99, 235, 0.08) 60%, transparent 80%)", animationDelay: "2s" }}
        />
        <div
          className="absolute top-[55%] -right-[10%] w-[600px] h-[600px] rounded-full blur-[150px] animate-pulse-glow"
          style={{ background: "radial-gradient(circle, rgba(124, 58, 237, 0.22) 0%, rgba(56, 189, 248, 0.1) 60%, transparent 80%)", animationDelay: "4s" }}
        />
        <div
          className="absolute bottom-0 left-1/3 w-[800px] h-[500px] rounded-full blur-[160px]"
          style={{ background: "radial-gradient(circle, rgba(16, 185, 129, 0.12) 0%, rgba(37, 99, 235, 0.08) 60%, transparent 80%)" }}
        />
      </div>

      {/* ── FLOATING BIOMETRIC HUD CHIPS (BACKGROUND DEPTH LAYER) ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-10 hidden xl:block">
        {/* Floating Chip 1: Top Left */}
        <div
          className="absolute top-36 left-8 2xl:left-24 animate-float-slow proctor-hud-badge px-4 py-2.5 rounded-2xl flex items-center gap-3"
          style={{ transform: "rotate(-2deg)" }}
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-sm">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-white font-mono uppercase tracking-wider">AI Sentinel</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <p className="text-[10px] text-emerald-300/90 font-medium">Biometric Lock: 99.4% Verified</p>
          </div>
        </div>

        {/* Floating Chip 2: Top Right */}
        <div
          className="absolute top-44 right-8 2xl:right-28 animate-float-medium proctor-hud-badge px-4 py-2.5 rounded-2xl flex items-center gap-3"
          style={{ transform: "rotate(3deg)" }}
        >
          <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-sm">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-white font-mono uppercase tracking-wider">Gemini Forensic</span>
            </div>
            <p className="text-[10px] text-indigo-300/90 font-medium">Integrity Score: 100/100 Clean</p>
          </div>
        </div>

        {/* Floating Chip 3: Mid Left */}
        <div
          className="absolute top-[680px] left-10 2xl:left-20 animate-float-reverse proctor-hud-badge px-3.5 py-2 rounded-2xl flex items-center gap-2.5"
          style={{ transform: "rotate(2deg)" }}
        >
          <div className="w-7 h-7 rounded-lg bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
            <Eye className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-white font-mono">Gaze Deviation: 0.0°</span>
            <p className="text-[9px] text-sky-300/80">Optical Center Calibrated</p>
          </div>
        </div>

        {/* Floating Chip 4: Mid Right */}
        <div
          className="absolute top-[750px] right-12 2xl:right-24 animate-float-slow proctor-hud-badge px-3.5 py-2 rounded-2xl flex items-center gap-2.5"
          style={{ transform: "rotate(-3deg)" }}
        >
          <div className="w-7 h-7 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
            <Lock className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-white font-mono">Sandbox Enforcer</span>
            <p className="text-[9px] text-rose-300/80">Window Focus: Active (0 Blurs)</p>
          </div>
        </div>
      </div>

      {/* ── STICKY GLASS NAVBAR ──────────────────────────────────── */}
      <nav className="relative z-50 flex items-center justify-between px-5 sm:px-8 md:px-14 py-4 border-b border-blue-500/20 backdrop-blur-2xl bg-slate-950/70 sticky top-0 transition-all">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/25 group-hover:scale-105 transition-transform">
            <Shield className="w-5 h-5" aria-hidden="true" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-slate-950" />
          </div>
          <div>
            <span className="font-extrabold text-white text-lg tracking-tight font-[family-name:var(--font-display)] flex items-center gap-1.5">
              ProctorShield
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-300 to-indigo-400">
                AI
              </span>
            </span>
          </div>
        </Link>

        {/* Desktop Navigation Links */}
        <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-300/90">
          <a href="#features" className="hover:text-cyan-300 transition-colors flex items-center gap-1">
            Features
          </a>
          <a href="#how" className="hover:text-cyan-300 transition-colors">
            How It Works
          </a>
          <a href="#pricing" className="hover:text-cyan-300 transition-colors">
            Pricing
          </a>
          <Link
            href="/join"
            className="text-amber-300 hover:text-amber-200 transition-colors flex items-center gap-1 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/30 text-xs font-bold"
          >
            <Zap className="w-3 h-3 text-amber-400" /> Student Arena
          </Link>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden sm:inline-flex px-4 py-2 text-xs md:text-sm font-bold text-slate-300 hover:text-white border border-slate-800/80 bg-slate-900/50 rounded-xl hover:bg-slate-800/70 transition-all backdrop-blur-md"
          >
            Log In
          </Link>
          <Link
            href="/login/teacher"
            className="px-4 py-2 md:px-5 md:py-2.5 text-xs md:text-sm font-extrabold text-white rounded-xl transition-all flex items-center gap-1.5 shadow-lg shadow-blue-600/30"
            style={{
              background: "linear-gradient(110deg, #1d4ed8 0%, #2563eb 50%, #0ea5e9 100%)",
            }}
          >
            <Sparkles className="w-4 h-4 text-cyan-200" />
            <span>Get Started</span>
          </Link>
        </div>
      </nav>

      {/* ── HERO SECTION ───────────────────────────────────── */}
      <section className="relative z-20 px-5 sm:px-8 md:px-14 pt-16 md:pt-24 pb-20 text-center max-w-6xl mx-auto">
        {/* Release Pill Badge */}
        <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-blue-950/80 border border-blue-500/40 text-xs font-bold text-blue-200 mb-8 backdrop-blur-md shadow-lg shadow-blue-950/50 animate-fade-in">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="font-mono text-cyan-300 font-black tracking-wide">PROCTORSHIELD</span>
          <span className="text-slate-500">|</span>
          <span>Next-Gen Real-Time AI Proctoring</span>
        </div>

        {/* Main Headline */}
        <h1 className="text-4xl sm:text-5xl md:text-7xl font-black leading-[1.1] tracking-tight font-[family-name:var(--font-display)] text-white">
          The Smartest Way to Run{" "}
          <br className="hidden sm:inline" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-300 to-indigo-300 drop-shadow-[0_0_35px_rgba(56,189,248,0.35)]">
            Honest Quizzes
          </span>{" "}
          Online
        </h1>

        {/* Subtitle */}
        <p className="mt-6 text-base sm:text-lg md:text-xl text-slate-300/90 max-w-3xl mx-auto leading-relaxed font-medium">
          Automated biometric face tracking, millisecond CCTV evidence replay, and instant Google Gemini AI verdicts
          empower educators with total quiz integrity — while students enjoy a lightning-fast, gamified arena.
        </p>

        {/* ── FAST PIN QUICK-JOIN CONSOLE (WAYGROUND INSPIRED DIRECT HERO ACCESS) ── */}
        <div className="mt-10 max-w-xl mx-auto">
          <form
            onSubmit={handleQuickJoin}
            className="p-2 sm:p-2.5 rounded-2xl sm:rounded-3xl border border-blue-500/40 bg-slate-950/80 backdrop-blur-xl shadow-2xl shadow-blue-950/80 flex flex-col sm:flex-row items-center gap-2 transition-all hover:border-blue-400/60"
          >
            <div className="relative w-full flex-1">
              <input
                type="text"
                value={quickCode}
                onChange={(e) => setQuickCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16))}
                placeholder="ENTER QUIZ PIN (e.g. PS-4821)"
                className="w-full py-3 sm:py-3.5 px-4 text-center sm:text-left text-base sm:text-lg font-mono font-black tracking-widest text-white placeholder:text-slate-500 placeholder:font-sans placeholder:tracking-normal placeholder:text-sm focus:outline-none bg-transparent uppercase"
              />
              {quickCode.length > 0 && (
                <span className="hidden sm:inline-block absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-2 py-0.5 rounded">
                  {quickCode.length} chars
                </span>
              )}
            </div>

            <button
              type="submit"
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl sm:rounded-2xl font-black text-sm uppercase tracking-wider text-white transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/25 shrink-0 active:scale-95"
              style={{
                background: "linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4f46e5 100%)",
              }}
            >
              <span>Join Arena</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-3 flex items-center justify-center gap-4 text-xs text-slate-400 font-medium">
            <span className="flex items-center gap-1 text-slate-400">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Free for all students
            </span>
            <span>•</span>
            <span className="flex items-center gap-1 text-slate-400">
              <Lock className="w-3.5 h-3.5 text-emerald-400" /> No install needed
            </span>
            <span>•</span>
            <span className="flex items-center gap-1 text-slate-400">
              <Zap className="w-3.5 h-3.5 text-cyan-400" /> Instant sync
            </span>
          </div>
        </div>

        {/* Dual Primary CTA for Educators */}
        <div className="flex flex-wrap items-center justify-center gap-4 mt-8">
          <Link
            href="/login/teacher"
            className="px-7 py-3.5 text-sm md:text-base font-extrabold text-white rounded-2xl transition-all shadow-xl shadow-blue-600/30 flex items-center gap-2 hover:scale-[1.02] active:scale-95"
            style={{
              background: "linear-gradient(110deg, #1d4ed8 0%, #2563eb 50%, #0ea5e9 100%)",
            }}
          >
            <Sparkles className="w-4 h-4 text-cyan-200" />
            <span>Create Quiz Free</span>
          </Link>
          <a
            href="#features"
            className="px-6 py-3.5 text-sm md:text-base font-bold text-slate-300 border border-slate-700/80 bg-slate-900/60 rounded-2xl hover:bg-slate-800/80 hover:text-white transition-all backdrop-blur-md flex items-center gap-2"
          >
            <span>Explore Features</span>
            <ArrowRight className="w-4 h-4 text-slate-400" />
          </a>
        </div>

        {/* Live Performance Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mt-16 max-w-4xl mx-auto">
          {[
            { val: "99.2%", lbl: "Detection Accuracy", icon: <ShieldCheck className="w-4 h-4 text-emerald-400" /> },
            { val: "<1s", lbl: "Instant Alert Latency", icon: <Zap className="w-4 h-4 text-cyan-400" /> },
            { val: "50K+", lbl: "Quizzes Proctored", icon: <Award className="w-4 h-4 text-amber-400" /> },
            { val: "200+", lbl: "Educational Partners", icon: <Users className="w-4 h-4 text-indigo-400" /> },
          ].map((s) => (
            <div
              key={s.lbl}
              className="text-center p-5 rounded-2xl bg-slate-900/60 border border-blue-500/20 backdrop-blur-md shadow-lg shadow-blue-950/40 hover:border-blue-400/50 transition-all"
            >
              <div className="flex items-center justify-center gap-1.5 mb-1">
                {s.icon}
                <div className="text-2xl sm:text-3xl font-black text-white font-[family-name:var(--font-display)]">
                  {s.val}
                </div>
              </div>
              <div className="text-xs text-slate-400 font-medium">{s.lbl}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES SECTION ───────────────────────────────── */}
      <section id="features" className="relative z-20 px-5 sm:px-8 md:px-14 py-24 max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 text-xs font-black tracking-widest uppercase text-cyan-400 bg-cyan-950/50 border border-cyan-500/30 px-3.5 py-1 rounded-full mb-3">
            <Layers className="w-3.5 h-3.5" /> High-Tech Security Suite
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black font-[family-name:var(--font-display)] text-white tracking-tight">
            Engineered for bulletproof
            <br />
            academic integrity
          </h2>
          <p className="text-slate-400 text-sm sm:text-base max-w-2xl mx-auto mt-4 leading-relaxed">
            Every layer of ProctorShield is calibrated to stop evasion tactics without introducing intrusive or stressful hurdles for honest students.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className={`p-7 rounded-3xl bg-slate-900/70 border ${f.border} backdrop-blur-xl hover:scale-[1.02] transition-all group relative overflow-hidden shadow-xl shadow-slate-950/60`}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${f.gradient} pointer-events-none opacity-40 group-hover:opacity-80 transition-opacity`} />

              <div className="relative z-10">
                <div className="flex items-center justify-between mb-5">
                  <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center group-hover:scale-110 transition-transform shadow-md">
                    {f.icon}
                  </div>
                  <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${f.badgeColor}`}>
                    {f.badge}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-white mb-2.5 font-[family-name:var(--font-display)] group-hover:text-cyan-300 transition-colors">
                  {f.title}
                </h3>
                <p className="text-sm text-slate-300/85 leading-relaxed font-normal">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS SECTION ───────────────────────────── */}
      <section id="how" className="relative z-20 px-5 sm:px-8 md:px-14 py-24 max-w-6xl mx-auto border-t border-slate-800/80">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 text-xs font-black tracking-widest uppercase text-indigo-400 bg-indigo-950/50 border border-indigo-500/30 px-3.5 py-1 rounded-full mb-3">
            <Activity className="w-3.5 h-3.5" /> 3-Step Lifecycle
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black font-[family-name:var(--font-display)] text-white tracking-tight">
            Effortless for teachers,
            <br />
            transparent for students
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6 relative">
          {steps.map((s) => (
            <div
              key={s.num}
              className="p-8 rounded-3xl bg-slate-900/70 border border-blue-500/20 backdrop-blur-xl relative group hover:border-blue-400/50 transition-all shadow-xl"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="text-5xl font-black font-mono text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
                  {s.num}
                </div>
                <div className="w-10 h-10 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center">
                  {s.icon}
                </div>
              </div>

              <div className="text-[10px] font-mono uppercase tracking-widest font-bold text-cyan-400 mb-1.5">
                Target: {s.tag}
              </div>
              <h3 className="text-xl font-bold text-white mb-2.5 font-[family-name:var(--font-display)]">
                {s.title}
              </h3>
              <p className="text-sm text-slate-300/85 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRICING SECTION ────────────────────────────────── */}
      <section id="pricing" className="relative z-20 px-5 sm:px-8 md:px-14 py-24 max-w-4xl mx-auto border-t border-slate-800/80">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 text-xs font-black tracking-widest uppercase text-emerald-400 bg-emerald-950/50 border border-emerald-500/30 px-3.5 py-1 rounded-full mb-3">
            <Sparkles className="w-3.5 h-3.5" /> Fair Institutional Pricing
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black font-[family-name:var(--font-display)] text-white tracking-tight">
            Simple, transparent plans
          </h2>
          <p className="text-slate-400 text-sm mt-3">Start free, upgrade as your classroom scales</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 items-stretch">
          {/* Free Tier */}
          <div className="p-8 rounded-3xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl flex flex-col justify-between hover:border-slate-700 transition-all">
            <div>
              <div className="text-xs font-mono uppercase tracking-widest text-slate-400 font-bold mb-2">
                Educator Starter
              </div>
              <div className="text-4xl sm:text-5xl font-black text-white font-[family-name:var(--font-display)]">
                ₱0
                <span className="text-sm font-normal text-slate-400"> / forever</span>
              </div>
              <p className="text-xs text-slate-400 mt-3 mb-6 leading-relaxed">
                Ideal for individual teachers trying out AI proctoring in small classrooms.
              </p>

              <ul className="space-y-3 text-xs text-slate-300 font-medium border-t border-slate-800/80 pt-6">
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Up to <strong>{FREE_MANUAL_QUIZ_LIMIT} lifetime manual quizzes</strong></span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Up to <strong>{FREE_STUDENT_LIMIT_PER_QUIZ} students</strong> per quiz</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Real-time AI Face Detection & Logs</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Student Gamified Arena Access</span>
                </li>
              </ul>
            </div>

            <Link
              href="/login/teacher"
              className="mt-8 block w-full py-3.5 text-center text-sm font-bold text-slate-200 border border-slate-700/80 bg-slate-800/50 rounded-xl hover:bg-slate-700 hover:text-white transition-all cursor-pointer"
            >
              Start Free Account
            </Link>
          </div>

          {/* Pro Tier */}
          <div className="p-8 rounded-3xl bg-slate-900/90 border-2 border-blue-500 backdrop-blur-2xl flex flex-col justify-between relative shadow-2xl shadow-blue-600/25">
            <div className="absolute -top-3.5 right-6 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-mono text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider shadow-md">
              Recommended
            </div>

            <div>
              <div className="text-xs font-mono uppercase tracking-widest text-cyan-400 font-bold mb-2">
                Pro Institutional
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl font-black text-white font-[family-name:var(--font-display)]">
                  ₱{PRO_MONTHLY_PRICE_PHP}
                </span>
                <span className="text-sm font-normal text-slate-400"> / month</span>
              </div>
              <p className="text-xs text-slate-300 mt-3 mb-6 leading-relaxed">
                Full AI power: automatic quiz generation, Gemini reports, and live CCTV replay.
              </p>

              <ul className="space-y-3 text-xs text-slate-200 font-medium border-t border-slate-800/80 pt-6">
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span><strong>Unlimited Quizzes</strong> (AI & Manual)</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Up to <strong>{PRO_STUDENT_LIMIT_PER_QUIZ} students</strong> per quiz</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span><strong>Gemini AI Forensics</strong> & Cheating Probability Verdicts</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Live Multi-Camera CCTV Timeline Replay</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span><strong>Power Arena</strong> Battle Mode & Power-ups (Meteors, Blizzards, Shields)</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Neural Audio & Tab-Switch Sandboxing</span>
                </li>
              </ul>
            </div>

            <Link
              href="/login/teacher"
              className="mt-8 block w-full py-3.5 text-center text-sm font-extrabold text-white rounded-xl transition-all shadow-lg shadow-blue-600/30 cursor-pointer active:scale-95"
              style={{
                background: "linear-gradient(110deg, #1d4ed8 0%, #2563eb 50%, #0ea5e9 100%)",
              }}
            >
              Upgrade to Pro Now →
            </Link>
          </div>
        </div>
      </section>

      {/* ── HIGH-CONVERSION BOTTOM CTA ───────────────────────────── */}
      <section className="relative z-20 px-5 sm:px-8 md:px-14 py-24 text-center border-t border-slate-800/80 bg-slate-950/60 backdrop-blur-md">
        <div className="max-w-2xl mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-cyan-300 mx-auto mb-6 shadow-xl shadow-blue-500/20">
            <Shield className="w-7 h-7" />
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black font-[family-name:var(--font-display)] text-white tracking-tight">
            Ready to secure your next examination?
          </h2>
          <p className="text-slate-300/90 text-sm sm:text-base mt-4 mb-10 leading-relaxed">
            Join thousands of educators maintaining total fairness with ProctorShield AI.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/join"
              className="px-7 py-3.5 text-sm md:text-base font-extrabold text-white rounded-2xl transition-all shadow-xl shadow-amber-500/25 flex items-center gap-2"
              style={{
                background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
              }}
            >
              <span>🎓 Enter Room as Student</span>
            </Link>
            <Link
              href="/login/teacher"
              className="px-7 py-3.5 text-sm md:text-base font-extrabold text-white rounded-2xl transition-all shadow-xl shadow-blue-600/30 flex items-center gap-2"
              style={{
                background: "linear-gradient(110deg, #1d4ed8 0%, #2563eb 50%, #0ea5e9 100%)",
              }}
            >
              <span>👩‍🏫 Launch Quiz as Teacher</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── POLISHED FOOTER ─────────────────────────────────── */}
      <footer className="relative z-20 px-5 sm:px-8 md:px-14 py-10 border-t border-slate-900 bg-slate-950 flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-slate-500">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-black">
            P
          </div>
          <p>© 2025 ProctorShield AI · Next-Generation Academic Integrity Platform</p>
        </div>

        <div className="flex items-center gap-6">
          <span className="inline-flex items-center gap-1.5 text-emerald-400 font-mono text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            All Sentinel Nodes Operational
          </span>
          <a href="#" className="hover:text-slate-300 transition-colors">Privacy Policy</a>
          <a href="#" className="hover:text-slate-300 transition-colors">Security Audit</a>
          <Link href="/admin/login" className="text-slate-600 hover:text-slate-400 transition-colors">
            SysAdmin
          </Link>
        </div>
      </footer>
    </div>
  );
}
