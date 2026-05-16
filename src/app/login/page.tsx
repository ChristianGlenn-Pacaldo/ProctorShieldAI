"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield, Target, Camera, Brain, Lock } from "lucide-react";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";

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

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setError("");
    setIsLoading(true);
    
    try {
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: credentialResponse.credential,
          role: activeRole, // Determine if we are creating a student or teacher
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Google Auth failed");
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
      setError("Network error connecting to Google Auth.");
      setIsLoading(false);
    }
  };

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
    <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ""}>
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
              {/* Real Google Button */}
              <div className="mb-4 flex justify-center w-full">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => setError("Google Login Failed")}
                  theme="filled_black"
                  size="large"
                  text="signin_with"
                  shape="rectangular"
                />
              </div>

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


            </div>
          )}

          {/* ── REGISTER FORM ───────────────────── */}
          {activePanel === "register" && (
            <div className="animate-fade-in">
              <h2 className="text-xl font-bold text-white mb-1">Create account</h2>
              <p className="text-sm text-white/35 mb-6">
                Join Proctor Shield AI today
              </p>

              {/* Real Google Button */}
              <div className="mb-4 flex justify-center w-full">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => setError("Google Registration Failed")}
                  theme="filled_black"
                  size="large"
                  text="signup_with"
                  shape="rectangular"
                />
              </div>

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
    </GoogleOAuthProvider>
  );
}
