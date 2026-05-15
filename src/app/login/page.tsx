"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield, Target, Camera, Brain, Lock } from "lucide-react";

type Role = "student" | "teacher";
type Panel = "login" | "register";

export default function LoginPage() {
  const [activeRole, setActiveRole] = useState<Role>("student");
  const [activePanel, setActivePanel] = useState<Panel>("login");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
          role: activeRole,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        setIsLoading(false);
        return;
      }

      // Redirect based on role
      const role = data.user.role;
      if (role === "admin") {
        window.location.href = "/dashboard/admin";
      } else if (role === "teacher") {
        window.location.href = "/dashboard/teacher";
      } else {
        window.location.href = "/dashboard/student";
      }
    } catch {
      setError("Network error. Please try again.");
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (regPassword !== regConfirm) {
      setError("Passwords do not match");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: regName,
          email: regEmail,
          password: regPassword,
          confirmPassword: regConfirm,
          role: activeRole,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        setIsLoading(false);
        return;
      }

      // Redirect based on role
      const role = data.user.role;
      if (role === "teacher") {
        window.location.href = "/dashboard/teacher";
      } else {
        window.location.href = "/dashboard/student";
      }
    } catch {
      setError("Network error. Please try again.");
      setIsLoading(false);
    }
  };

  const fillDemo = (type: "student" | "teacher") => {
    if (type === "student") {
      setLoginEmail("student@demo.com");
      setLoginPassword("student123");
      setActiveRole("student");
    } else {
      setLoginEmail("teacher@demo.com");
      setLoginPassword("teacher123");
      setActiveRole("teacher");
    }
    setActivePanel("login");
  };

  const features = [
    { icon: <Target className="w-5 h-5" />, title: "99% Accurate Face Detection", sub: "Real-time monitoring with face-api.js" },
    { icon: <Camera className="w-5 h-5" />, title: "Automatic Evidence Capture", sub: "Screenshots on every violation event" },
    { icon: <Brain className="w-5 h-5" />, title: "Gemini AI Verdict", sub: "Intelligent cheating analysis report" },
    { icon: <Lock className="w-5 h-5" />, title: "Role-based Access Control", sub: "Separate portals for Student & Teacher" },
  ];

  return (
    <div className="min-h-screen flex">
      {/* ── LEFT PANEL ───────────────────────────── */}
      <div className="hidden lg:flex lg:w-1/2 bg-[var(--dark-bg)] text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/15 via-transparent to-violet-600/10 pointer-events-none" />
        <div className="relative z-10 flex flex-col justify-center px-16 py-12">
          <div className="text-6xl mb-6">🛡️</div>
          <h1 className="text-3xl font-extrabold mb-3 font-[family-name:var(--font-display)]">
            Secure. Smart. Fair.
          </h1>
          <p className="text-sm text-white/40 leading-relaxed mb-10 max-w-md">
            AI-powered proctoring that monitors exams in real-time, captures evidence automatically,
            and delivers intelligent cheating analysis.
          </p>
          <div className="space-y-5">
            {features.map((f) => (
              <div key={f.title} className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-indigo-400 shrink-0">
                  {f.icon}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white/80">{f.title}</div>
                  <div className="text-xs text-white/30">{f.sub}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-12 pt-8 border-t border-white/[0.06] text-center">
            <p className="text-xs text-white/20">
              ← Back to{" "}
              <Link href="/" className="text-indigo-400 font-semibold hover:text-indigo-300">
                Home Page
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL ──────────────────────────── */}
      <div className="w-full lg:w-1/2 bg-[var(--dark-s1)] flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Tab Switcher */}
          <div className="flex gap-0.5 bg-white/5 p-1 rounded-xl mb-6">
            <button
              onClick={() => { setActivePanel("login"); setError(""); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                activePanel === "login"
                  ? "bg-indigo-600/20 text-indigo-300"
                  : "text-white/35 hover:text-white/50"
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setActivePanel("register"); setError(""); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                activePanel === "register"
                  ? "bg-indigo-600/20 text-indigo-300"
                  : "text-white/35 hover:text-white/50"
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Role Selector */}
          <div className="flex gap-3 mb-6">
            {(["student", "teacher"] as Role[]).map((role) => (
              <button
                key={role}
                onClick={() => { setActiveRole(role); setError(""); }}
                className={`flex-1 py-3 rounded-xl border text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                  activeRole === role
                    ? "bg-indigo-600/10 border-indigo-500/40 text-indigo-300"
                    : "bg-white/[0.02] border-white/[0.06] text-white/30 hover:border-white/15"
                }`}
              >
                <span>{role === "student" ? "🎓" : "👩‍🏫"}</span>
                <span className="capitalize">{role}</span>
              </button>
            ))}
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 animate-fade-in">
              ⚠ {error}
            </div>
          )}

          {/* ── LOGIN FORM ──────────────────────── */}
          {activePanel === "login" && (
            <div className="animate-fade-in">
              <h2 className="text-xl font-bold text-white mb-1">Welcome back</h2>
              <p className="text-sm text-white/35 mb-6">
                Sign in to your Proctor Shield account
              </p>

              {/* Google Button */}
              <button className="w-full py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm font-semibold text-white/70 hover:bg-white/[0.08] transition-all flex items-center justify-center gap-3 mb-4">
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>

              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-xs text-white/20 font-semibold">OR</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-white/45 mb-1.5 block">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="you@school.edu.ph"
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                    required
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-white/45">Password</label>
                    <button type="button" className="text-xs text-indigo-400 hover:text-indigo-300">
                      Forgot password?
                    </button>
                  </div>
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3.5 rounded-xl bg-indigo-600 text-sm font-bold text-white hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/25 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Signing In...
                    </span>
                  ) : (
                    "Sign In"
                  )}
                </button>
              </form>

              <p className="text-center text-xs text-white/25 mt-5">
                Don&apos;t have an account?{" "}
                <button
                  onClick={() => setActivePanel("register")}
                  className="text-indigo-400 font-semibold hover:text-indigo-300"
                >
                  Create one →
                </button>
              </p>

              {/* Demo Credentials — clickable to autofill */}
              <div className="mt-6 p-3 rounded-xl bg-indigo-600/[0.07] border border-indigo-500/15">
                <p className="text-[11px] text-white/35 leading-relaxed text-center mb-2">
                  <strong className="text-white/50">Quick Demo Login:</strong>
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fillDemo("student")}
                    className="flex-1 py-2 rounded-lg bg-indigo-600/15 text-[11px] font-bold text-indigo-300 hover:bg-indigo-600/25 transition-all"
                  >
                    🎓 Student Demo
                  </button>
                  <button
                    type="button"
                    onClick={() => fillDemo("teacher")}
                    className="flex-1 py-2 rounded-lg bg-violet-600/15 text-[11px] font-bold text-violet-300 hover:bg-violet-600/25 transition-all"
                  >
                    👩‍🏫 Teacher Demo
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── REGISTER FORM ───────────────────── */}
          {activePanel === "register" && (
            <div className="animate-fade-in">
              <h2 className="text-xl font-bold text-white mb-1">Create account</h2>
              <p className="text-sm text-white/35 mb-6">
                Join Proctor Shield AI today
              </p>

              <button className="w-full py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm font-semibold text-white/70 hover:bg-white/[0.08] transition-all flex items-center justify-center gap-3 mb-4">
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Sign up with Google
              </button>

              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-xs text-white/20 font-semibold">OR</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>

              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-white/45 mb-1.5 block">Full Name</label>
                  <input
                    type="text"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Juan Dela Cruz"
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-white/45 mb-1.5 block">Email Address</label>
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="you@school.edu.ph"
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-white/45 mb-1.5 block">Password</label>
                  <input
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Min. 6 characters"
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-white/45 mb-1.5 block">Confirm Password</label>
                  <input
                    type="password"
                    value={regConfirm}
                    onChange={(e) => setRegConfirm(e.target.value)}
                    placeholder="Repeat your password"
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3.5 rounded-xl bg-indigo-600 text-sm font-bold text-white hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/25 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Creating Account...
                    </span>
                  ) : (
                    "Create Account"
                  )}
                </button>
              </form>

              <p className="text-center text-xs text-white/25 mt-5">
                Already have an account?{" "}
                <button
                  onClick={() => setActivePanel("login")}
                  className="text-indigo-400 font-semibold hover:text-indigo-300"
                >
                  Sign in →
                </button>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
