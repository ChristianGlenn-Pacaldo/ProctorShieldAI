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
  Star,
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
    desc: "After the exam, Google Gemini AI analyzes all violations and returns a cheating probability score with a detailed explanation.",
    color: "bg-amber-500/15 text-amber-400",
  },
  {
    icon: <MonitorX className="w-6 h-6" />,
    title: "Tab Switch Detection",
    desc: "Instantly flags when students leave the exam window. Recorded with exact timestamps and confidence scores.",
    color: "bg-red-500/15 text-red-400",
  },
  {
    icon: <Mic className="w-6 h-6" />,
    title: "Audio Monitoring",
    desc: "Microphone activity analysis detects suspicious background conversations or external assistance during exams.",
    color: "bg-violet-500/15 text-violet-400",
  },
  {
    icon: <PlayCircle className="w-6 h-6" />,
    title: "CCTV Evidence Replay",
    desc: "Timeline replay with millisecond tracking. Teachers can review any moment of suspicious activity with full context.",
    color: "bg-cyan-500/15 text-cyan-400",
  },
];

const steps = [
  { num: "01", title: "Create & Assign", desc: "Teachers create exams with multiple question types, set timer, and enable AI proctoring in seconds." },
  { num: "02", title: "Students Take Exam", desc: "Students accept consent, camera access is verified, and AI monitoring begins automatically." },
  { num: "03", title: "AI Delivers Verdict", desc: "After submission, Gemini AI analyzes all violations and delivers a final cheating probability report." },
];

const testimonials = [
  {
    quote: "Proctor Shield completely changed how we run online exams. The AI verdict system saved our department hours of manual review.",
    name: "Dr. Maria Reyes",
    role: "Dean, University of Cebu",
    initials: "MR",
    color: "bg-indigo-600",
    stars: 5,
  },
  {
    quote: "The evidence replay system is incredible. When students dispute their grades, we can show them exactly what happened, second by second.",
    name: "Prof. James Torres",
    role: "IT Department, PLM",
    initials: "JT",
    color: "bg-violet-600",
    stars: 5,
  },
  {
    quote: "Setup was smooth, students adapted quickly, and the violation breakdown gives me confidence that our exams are fair and credible.",
    name: "Ana Lim",
    role: "CS Instructor, DLSU",
    initials: "AL",
    color: "bg-cyan-600",
    stars: 4,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--dark-bg)] text-white">
      {/* ── NAVBAR ──────────────────────────────────── */}
      <nav className="flex items-center justify-between px-6 md:px-12 py-4 border-b border-white/5 backdrop-blur-md sticky top-0 z-50 bg-[var(--dark-bg)]/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-lg">
            🛡️
          </div>
          <div>
            <span className="font-bold text-white text-lg font-[var(--font-display)]">
              Proctor Shield{" "}
              <span className="text-indigo-400">AI</span>
            </span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm text-white/50">
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#how" className="hover:text-white transition-colors">How It Works</a>
          <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
          <a href="#testimonials" className="hover:text-white transition-colors">Testimonials</a>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-4 py-2 text-sm font-semibold text-white/60 border border-white/10 rounded-lg hover:bg-white/5 transition-all"
          >
            Log In
          </Link>
          <Link
            href="/login"
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/25"
          >
            Get Started Free
          </Link>
        </div>
      </nav>

      {/* ── HERO ───────────────────────────────────── */}
      <section className="relative px-6 md:px-12 pt-24 pb-20 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-600/8 via-transparent to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs text-white/50 mb-8">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            AI-Powered · Real-time Detection · Evidence-based
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight tracking-tight font-[family-name:var(--font-display)]">
            The Smartest Way to
            <br />
            Run{" "}
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent">
              Honest Exams
            </span>{" "}
            Online
          </h1>
          <p className="mt-6 text-lg text-white/40 max-w-2xl mx-auto leading-relaxed">
            AI proctoring that detects cheating in real-time, captures evidence automatically,
            and delivers an intelligent verdict — so educators can focus on teaching.
          </p>
          <div className="flex items-center justify-center gap-4 mt-10">
            <Link
              href="/login"
              className="px-8 py-4 text-base font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-600/30 flex items-center gap-2"
            >
              <Sparkles className="w-5 h-5" /> Start Free Trial
            </Link>
            <Link
              href="/login"
              className="px-6 py-4 text-base font-semibold text-white/50 border border-white/10 rounded-xl hover:bg-white/5 transition-all flex items-center gap-2"
            >
              Learn More <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-16 max-w-2xl mx-auto">
            {[
              { val: "98.4%", lbl: "Detection accuracy" },
              { val: "50K+", lbl: "Exams proctored" },
              { val: "<1s", lbl: "Violation alert time" },
              { val: "200+", lbl: "Schools trust us" },
            ].map((s) => (
              <div key={s.lbl} className="text-center">
                <div className="text-2xl md:text-3xl font-extrabold text-white font-[family-name:var(--font-display)]">
                  {s.val}
                </div>
                <div className="text-xs text-white/30 mt-1">{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────── */}
      <section id="features" className="px-6 md:px-12 py-20 max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-xs font-bold tracking-widest uppercase text-indigo-400 mb-3">
            Core Features
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold font-[family-name:var(--font-display)]">
            Everything for secure
            <br />
            online examinations
          </h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="p-6 rounded-2xl bg-white/[0.025] border border-white/[0.06] hover:border-white/15 transition-all group"
            >
              <div className={`w-12 h-12 rounded-xl ${f.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                {f.icon}
              </div>
              <h3 className="text-base font-bold text-white/90 mb-2">{f.title}</h3>
              <p className="text-sm text-white/35 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────── */}
      <section id="how" className="px-6 md:px-12 py-20 max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-xs font-bold tracking-widest uppercase text-indigo-400 mb-3">
            How It Works
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold font-[family-name:var(--font-display)]">
            Simple for teachers,
            <br />
            transparent for students
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((s) => (
            <div
              key={s.num}
              className="p-8 rounded-2xl bg-white/[0.025] border border-white/[0.06] text-center"
            >
              <div className="text-4xl font-extrabold bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent mb-4 font-[family-name:var(--font-display)]">
                {s.num}
              </div>
              <h3 className="text-lg font-bold text-white/90 mb-2">{s.title}</h3>
              <p className="text-sm text-white/35 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── TESTIMONIALS ───────────────────────────── */}
      <section id="testimonials" className="px-6 md:px-12 py-20 max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-xs font-bold tracking-widest uppercase text-indigo-400 mb-3">
            Testimonials
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold font-[family-name:var(--font-display)]">
            Trusted by educators
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {testimonials.map((t) => (
            <div
              key={t.name}
              className="p-6 rounded-2xl bg-white/[0.025] border border-white/[0.06]"
            >
              <div className="text-amber-400 text-sm mb-3">
                {Array.from({ length: t.stars }, (_, i) => (
                  <Star key={i} className="w-4 h-4 inline fill-current" />
                ))}
                {t.stars < 5 && <Star className="w-4 h-4 inline text-white/15" />}
              </div>
              <p className="text-sm text-white/40 italic leading-relaxed mb-4">
                &ldquo;{t.quote}&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 ${t.color} rounded-full flex items-center justify-center text-xs font-extrabold text-white`}>
                  {t.initials}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white/70">{t.name}</div>
                  <div className="text-xs text-white/30">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRICING ────────────────────────────────── */}
      <section id="pricing" className="px-6 md:px-12 py-20 max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-xs font-bold tracking-widest uppercase text-indigo-400 mb-3">
            Pricing
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold font-[family-name:var(--font-display)]">
            Simple, transparent pricing
          </h2>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-8 rounded-2xl bg-white/[0.025] border border-white/[0.06]">
            <div className="text-xs font-bold tracking-widest uppercase text-white/40 mb-2">
              Free
            </div>
            <div className="text-4xl font-extrabold text-white font-[family-name:var(--font-display)]">
              ₱0
              <span className="text-sm font-normal text-white/30"> / forever</span>
            </div>
            <p className="text-xs text-white/35 mt-3 mb-6 leading-relaxed">
              For individual teachers trying out the platform.
            </p>
            <Link
              href="/login"
              className="block w-full py-3 text-center text-sm font-semibold text-white/60 border border-white/10 rounded-lg hover:bg-white/5 transition-all"
            >
              Get Started Free
            </Link>
          </div>
          <div className="p-8 rounded-2xl bg-indigo-600/[0.06] border border-indigo-500/30">
            <div className="text-xs font-bold tracking-widest uppercase text-indigo-400 mb-2">
              Premium Yearly
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-extrabold text-white font-[family-name:var(--font-display)]">
                ₱1,999
                <span className="text-sm font-normal text-white/30"> / yr</span>
              </span>
              <span className="px-2 py-1 rounded-full bg-red-500/20 text-red-400 text-[10px] font-extrabold">
                Save 40%
              </span>
            </div>
            <p className="text-xs text-white/35 mt-3 mb-6 leading-relaxed">
              Full AI analysis, evidence replay, unlimited exams.
            </p>
            <Link
              href="/login"
              className="block w-full py-3 text-center text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/25"
            >
              Upgrade to Premium →
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────── */}
      <section className="px-6 md:px-12 py-20 text-center bg-gradient-to-b from-indigo-600/[0.08] via-violet-600/[0.04] to-transparent border-t border-white/[0.04]">
        <h2 className="text-3xl md:text-4xl font-extrabold max-w-lg mx-auto font-[family-name:var(--font-display)]">
          Ready to make your exams cheat-proof?
        </h2>
        <p className="text-white/40 text-base mt-4 mb-10">
          Join 200+ schools already using Proctor Shield AI.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/login/student"
            className="px-8 py-4 text-base font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-600/30"
          >
            🎓 Start as Student
          </Link>
          <Link
            href="/login/teacher"
            className="px-6 py-4 text-base font-semibold text-white/50 border border-white/10 rounded-xl hover:bg-white/5 transition-all"
          >
            👩‍🏫 Start as Teacher
          </Link>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────── */}
      <footer className="px-6 md:px-12 py-8 border-t border-white/[0.04] flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-white/20">
        <p>© 2025 Proctor Shield AI · Built for the modern classroom</p>
        <div className="flex gap-6">
          <a href="#" className="hover:text-white/50 transition-colors">Privacy Policy</a>
          <a href="#" className="hover:text-white/50 transition-colors">Terms of Service</a>
          <Link href="/admin/login" className="text-white/[0.08] hover:text-white/20 transition-colors">
            System
          </Link>
        </div>
      </footer>
    </div>
  );
}
