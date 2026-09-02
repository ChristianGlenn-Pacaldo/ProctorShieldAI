import Link from "next/link";
import {
  Shield,
  Camera,
  Brain,
  MonitorX,
  Mic,
  PlayCircle,
  Sparkles,
  ArrowRight,
} from "lucide-react";

const features = [
  {
    icon: <Camera className="w-6 h-6" />,
    title: "AI Face Detection",
    desc: "Real-time face tracking using face-api.js. Detects absence, multiple faces, and gaze deviation with 98%+ confidence.",
    color: "bg-indigo-500/15 text-indigo-400",
  },
  {
    icon: <Shield className="w-6 h-6" />,
    title: "Auto Evidence Capture",
    desc: "Automatic screenshots on every violation with millisecond timestamps. Evidence stored securely with full replay capability.",
    color: "bg-emerald-500/15 text-emerald-400",
  },
  {
    icon: <Brain className="w-6 h-6" />,
    title: "Gemini AI Verdict",
    desc: "After the quiz, Google Gemini AI analyzes all violations and returns a cheating probability score with a detailed explanation.",
    color: "bg-amber-500/15 text-amber-400",
  },
  {
    icon: <MonitorX className="w-6 h-6" />,
    title: "Tab Switch Detection",
    desc: "Instantly flags when students leave the quiz window. Recorded with exact timestamps and confidence scores.",
    color: "bg-red-500/15 text-red-400",
  },
  {
    icon: <Mic className="w-6 h-6" />,
    title: "Audio Monitoring",
    desc: "Microphone activity analysis detects suspicious background conversations or external assistance during quizzes.",
    color: "bg-sky-500/15 text-sky-400",
  },
  {
    icon: <PlayCircle className="w-6 h-6" />,
    title: "CCTV Evidence Replay",
    desc: "Timeline replay with millisecond tracking. Teachers can review any moment of suspicious activity with full context.",
    color: "bg-cyan-500/15 text-cyan-400",
  },
];

const steps = [
  { num: "01", title: "Create & Assign", desc: "Teachers create quizzes with multiple question types, set timer, and enable AI proctoring in seconds." },
  { num: "02", title: "Students Take Quiz", desc: "Students accept consent, camera access is verified, and AI monitoring begins automatically." },
  { num: "03", title: "AI Delivers Verdict", desc: "After submission, Gemini AI analyzes all violations and delivers a final cheating probability report." },
];

export default function LandingPage() {
  return (
    <div className="marketing-shell min-h-screen bg-slate-950 text-slate-100">
      {/* ── NAVBAR ──────────────────────────────────── */}
      <nav className="flex items-center justify-between px-4 sm:px-6 md:px-12 py-4 border-b border-blue-400/10 backdrop-blur-xl sticky top-0 z-50 bg-slate-950/75">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-lg shadow-sm">
            <Shield className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <span className="font-bold text-white text-lg font-[family-name:var(--font-display)] tracking-tight">
              Proctor Shield{" "}
              <span className="text-blue-400">AI</span>
            </span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-400">
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#how" className="hover:text-white transition-colors">How It Works</a>
          <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/join"
            className="hidden sm:flex px-4 py-2 text-sm font-semibold text-white/60 hover:text-white transition-all items-center gap-1.5"
          >
            Enter Code
          </Link>
          <Link
            href="/login"
            className="hidden md:inline-flex px-4 py-2 text-sm font-semibold text-slate-300 border border-slate-800 rounded-lg hover:bg-slate-900 hover:text-white transition-all"
          >
            Log In
          </Link>
          <Link
            href="/login"
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-all shadow-xs"
          >
            Get Started Free
          </Link>
        </div>
      </nav>

      {/* ── HERO ───────────────────────────────────── */}
      <section className="relative px-6 md:px-12 pt-24 pb-20 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-950/30 via-transparent to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-950/60 border border-blue-800/40 text-xs font-semibold text-blue-300 mb-8">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            AI-Powered · Real-time Detection · Evidence-based
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight tracking-tight font-[family-name:var(--font-display)] text-slate-100">
            The Smartest Way to
            <br />
            Run{" "}
            <span className="bg-gradient-to-r from-blue-400 via-indigo-300 to-sky-400 bg-clip-text text-transparent">
              Honest Quizzes
            </span>{" "}
            Online
          </h1>
          <p className="mt-6 text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
            AI proctoring that detects cheating in real-time, captures evidence automatically,
            and delivers an intelligent verdict — so educators can focus on teaching.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-10">
            <Link
              href="/login"
              className="px-8 py-4 text-base font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-md shadow-blue-600/25 flex items-center gap-2"
            >
              <Sparkles className="w-5 h-5" /> Start Free Trial
            </Link>
            <Link
              href="/login"
              className="px-6 py-4 text-base font-semibold text-slate-300 border border-slate-800 rounded-xl hover:bg-slate-900 hover:text-white transition-all flex items-center gap-2"
            >
              Learn More <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-16 max-w-2xl mx-auto">
            {[
              { val: "98.4%", lbl: "Detection accuracy" },
              { val: "50K+", lbl: "Quizzes proctored" },
              { val: "<1s", lbl: "Violation alert time" },
              { val: "200+", lbl: "Schools trust us" },
            ].map((s) => (
              <div key={s.lbl} className="text-center p-4 rounded-xl bg-slate-900/40 border border-slate-800/50">
                <div className="text-2xl md:text-3xl font-extrabold text-slate-100 font-[family-name:var(--font-display)]">
                  {s.val}
                </div>
                <div className="text-xs text-slate-400 mt-1 font-medium">{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────── */}
      <section id="features" className="px-6 md:px-12 py-20 max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-xs font-bold tracking-widest uppercase text-blue-400 mb-3">
            Core Features
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold font-[family-name:var(--font-display)] text-slate-100">
            Everything for secure
            <br />
            online quizinations
          </h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f) => (
            <div
              key={f.title}
              className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 transition-all group"
            >
              <div className={`w-12 h-12 rounded-xl ${f.color} flex items-center justify-center mb-4 group-hover:scale-105 transition-transform`}>
                {f.icon}
              </div>
              <h3 className="text-base font-bold text-slate-200 mb-2 font-[family-name:var(--font-display)]">{f.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────── */}
      <section id="how" className="px-6 md:px-12 py-20 max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-xs font-bold tracking-widest uppercase text-blue-400 mb-3">
            How It Works
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold font-[family-name:var(--font-display)] text-slate-100">
            Simple for teachers,
            <br />
            transparent for students
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((s) => (
            <div
              key={s.num}
              className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800/80 text-center"
            >
              <div className="text-4xl font-extrabold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent mb-4 font-[family-name:var(--font-display)]">
                {s.num}
              </div>
              <h3 className="text-lg font-bold text-slate-200 mb-2 font-[family-name:var(--font-display)]">{s.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRICING ────────────────────────────────── */}
      <section id="pricing" className="px-6 md:px-12 py-20 max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-xs font-bold tracking-widest uppercase text-blue-400 mb-3">
            Pricing
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold font-[family-name:var(--font-display)] text-slate-100">
            Simple, transparent pricing
          </h2>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800/80">
            <div className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-2">
              Free
            </div>
            <div className="text-4xl font-extrabold text-slate-100 font-[family-name:var(--font-display)]">
              ₱0
              <span className="text-sm font-normal text-slate-400"> / forever</span>
            </div>
            <p className="text-xs text-slate-400 mt-3 mb-6 leading-relaxed">
              For individual teachers trying out the platform.
            </p>
            <Link
              href="/login"
              className="block w-full py-3 text-center text-sm font-semibold text-slate-300 border border-slate-800 rounded-lg hover:bg-slate-800 hover:text-white transition-all"
            >
              Get Started Free
            </Link>
          </div>
          <div className="p-8 rounded-2xl bg-slate-900 border border-blue-500/40 relative">
            <div className="text-xs font-bold tracking-widest uppercase text-blue-400 mb-2">
              Premium Monthly
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-extrabold text-slate-100 font-[family-name:var(--font-display)]">
                ₱500
                <span className="text-sm font-normal text-slate-400"> / mo</span>
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-extrabold">
                Pro Plan
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-3 mb-6 leading-relaxed">
              Full AI analysis, evidence replay, unlimited quizzes.
            </p>
            <Link
              href="/login"
              className="block w-full py-3 text-center text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-all shadow-md shadow-blue-600/20"
            >
              Upgrade to Premium →
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────── */}
      <section className="px-6 md:px-12 py-20 text-center bg-slate-900/60 border-t border-slate-800/80">
        <h2 className="text-3xl md:text-4xl font-extrabold max-w-lg mx-auto font-[family-name:var(--font-display)] text-slate-100">
          Ready to make your quizzes cheat-proof?
        </h2>
        <p className="text-slate-400 text-base mt-4 mb-10">
          Join ProctorShield-AI now for reliable AI proctoring!
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/login/student"
            className="px-8 py-4 text-base font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-md shadow-blue-600/25"
          >
            🎓 Start as Student
          </Link>
          <Link
            href="/login/teacher"
            className="px-6 py-4 text-base font-semibold text-slate-300 border border-slate-800 rounded-xl hover:bg-slate-900 hover:text-white transition-all"
          >
            👩‍🏫 Start as Teacher
          </Link>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────── */}
      <footer className="px-6 md:px-12 py-8 border-t border-slate-800/60 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-400">
        <p>© 2025 Proctor Shield AI · Built for the modern classroom</p>
        <div className="flex gap-6">
          <a href="#" className="hover:text-slate-200 transition-colors">Privacy Policy</a>
          <a href="#" className="hover:text-slate-200 transition-colors">Terms of Service</a>
          <Link href="/admin/login" className="text-slate-500 hover:text-slate-300 transition-colors">
            System
          </Link>
        </div>
      </footer>
    </div>
  );
}
