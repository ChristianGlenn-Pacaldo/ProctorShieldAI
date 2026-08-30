"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Shield, Target, Camera, Brain, Lock } from "lucide-react";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";

type Panel = "login" | "register";

export default function StudentLoginPage() {
  const [activePanel, setActivePanel] = useState<"login" | "register">("login");
  const [isSecureOrigin, setIsSecureOrigin] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Google Identity Services blocks HTTP IPs on mobile (except localhost)
    if (
      typeof window !== "undefined" && 
      window.location.protocol === "http:" && 
      window.location.hostname !== "localhost" && 
      window.location.hostname !== "127.0.0.1"
    ) {
      setIsSecureOrigin(false);
    }
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");

  // MFA State
  const [mfaState, setMfaState] = useState({ isPending: false, userId: "", email: "", role: "" });
  const [otpCode, setOtpCode] = useState("");

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: credentialResponse.credential,
          role: "student", // Lock role to student
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Google Auth failed");
        setIsLoading(false);
        return;
      }

      // Check if MFA is required
      if (data.requiresMfa) {
        setMfaState({
          isPending: true,
          userId: data.userId,
          email: data.email,
          role: data.role
        });
        setIsLoading(false);
        return;
      }

      // Fallback for regular login (should not happen with our update)
      const role = data.user.role;
      if (role === "student") {
        const pendingCode = localStorage.getItem("pendingJoinCode");
        if (pendingCode) {
          localStorage.removeItem("pendingJoinCode");
          window.location.href = `/join?code=${pendingCode}`;
        } else {
          window.location.href = "/dashboard/student";
        }
      } else {
        setError(`Access Denied: This portal is restricted to students. Your account is registered as ${role.toUpperCase()}.`);
        setIsLoading(false);
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
          role: "student", // Lock role to student
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Login failed");
        setIsLoading(false);
        return;
      }

      // Redirect based on role
      const role = data.user.role;
      if (role === "student") {
        const pendingCode = localStorage.getItem("pendingJoinCode");
        if (pendingCode) {
          localStorage.removeItem("pendingJoinCode");
          window.location.href = `/join?code=${pendingCode}`;
        } else {
          window.location.href = "/dashboard/student";
        }
      } else {
        setError(`Access Denied: This portal is restricted to students. Your account is registered as ${role.toUpperCase()}.`);
        setIsLoading(false);
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
          role: "student", // Lock role to student
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Registration failed");
        setIsLoading(false);
        return;
      }

      const pendingCode = localStorage.getItem("pendingJoinCode");
      if (pendingCode) {
        localStorage.removeItem("pendingJoinCode");
        window.location.href = `/join?code=${pendingCode}`;
      } else {
        window.location.href = "/dashboard/student";
      }
    } catch {
      setError("Network error. Please try again.");
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: mfaState.userId,
          otpCode: otpCode,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Verification failed");
        setIsLoading(false);
        return;
      }

      const role = data.user.role;
      if (role === "student") {
        const pendingCode = localStorage.getItem("pendingJoinCode");
        if (pendingCode) {
          localStorage.removeItem("pendingJoinCode");
          window.location.href = `/join?code=${pendingCode}`;
        } else {
          window.location.href = "/dashboard/student";
        }
      } else {
        setError(`Access Denied: This portal is restricted to students. Your account is registered as ${role.toUpperCase()}.`);
        setIsLoading(false);
      }
    } catch {
      setError("Network error. Please try again.");
      setIsLoading(false);
    }
  };

  const features = [
    { icon: <Target className="w-5 h-5" />, title: "99% Accurate Face Detection", sub: "Real-time monitoring" },
    { icon: <Camera className="w-5 h-5" />, title: "Automatic Evidence Capture", sub: "Screenshots on every violation event" },
    { icon: <Brain className="w-5 h-5" />, title: "Gemini AI Verdict", sub: "Intelligent cheating analysis report" },
    { icon: <Lock className="w-5 h-5" />, title: "Role-based Access Control", sub: "Secure, individual student dashboards" },
  ];

  return (
    <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ""}>
      <div className="min-h-screen flex">
        {/* ── LEFT PANEL ───────────────────────────── */}
        <div className="hidden lg:flex lg:w-1/2 bg-slate-950 text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-950/40 via-slate-950 to-slate-900 pointer-events-none" />
          <div className="relative z-10 flex flex-col justify-center px-16 py-12">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-2xl mb-6 shadow-lg shadow-blue-900/20">
              🛡️
            </div>
            <h1 className="text-3xl font-extrabold mb-3 font-[family-name:var(--font-display)] text-slate-100">
              Student Portal
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed mb-10 max-w-md">
              Access your quizzes in a secure environment. ProctorShield AI monitors proctored sessions, records evidence, and analyzes logs automatically.
            </p>
            <div className="space-y-5">
              {features.map((f) => (
                <div key={f.title} className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-blue-400 shrink-0">
                    {f.icon}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-200">{f.title}</div>
                    <div className="text-xs text-slate-400">{f.sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-12 pt-8 border-t border-slate-800/80 text-center">
              <p className="text-xs text-slate-400">
                ← Back to{" "}
                <Link href="/login" className="text-blue-400 font-semibold hover:text-blue-300">
                  Portal Selection
                </Link>
              </p>
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL ──────────────────────────── */}
        <div className="w-full lg:w-1/2 bg-slate-900 flex items-center justify-center p-6 border-l border-slate-800/50">
          <div className="w-full max-w-md">
            {/* Tab Switcher */}
            <div className="flex gap-1 bg-slate-950 p-1.5 rounded-xl border border-slate-800 mb-6">
              <button
                type="button"
                onClick={() => { setActivePanel("login"); setError(""); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${activePanel === "login"
                    ? "bg-blue-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-slate-200"
                  }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { setActivePanel("register"); setError(""); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${activePanel === "register"
                    ? "bg-blue-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-slate-200"
                  }`}
              >
                Create Account
              </button>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400 animate-fade-in">
                ⚠ {error}
              </div>
            )}

            {/* ── MFA OTP FORM ──────────────────────── */}
            {mfaState.isPending ? (
              <div className="animate-fade-in">
                <h2 className="text-xl font-bold text-slate-100 mb-1 font-[family-name:var(--font-display)]">Verify Your Identity</h2>
                <p className="text-sm text-slate-400 mb-6">
                  We sent a 6-digit verification code to <strong className="text-slate-200">{mfaState.email}</strong>.
                </p>

                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
                      Verification Code
                    </label>
                    <input
                      type="text"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="Enter 6-digit code"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all text-center tracking-[0.5em]"
                      maxLength={6}
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading || otpCode.length !== 6}
                    className="w-full py-3.5 rounded-xl bg-blue-600 text-sm font-bold text-white hover:bg-blue-700 transition-all shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Verifying...
                      </span>
                    ) : (
                      "Verify & Sign In"
                    )}
                  </button>
                </form>
                <p className="text-center text-xs text-white/25 mt-5">
                  Didn't receive the email? Check your spam folder or{" "}
                  <button
                    onClick={() => { setMfaState({ isPending: false, userId: "", email: "", role: "" }); setOtpCode(""); }}
                    className="text-indigo-400 font-semibold hover:text-indigo-300"
                  >
                    go back
                  </button>
                </p>
              </div>
            ) : (
              <>
                {/* ── LOGIN FORM ──────────────────────── */}
                {activePanel === "login" && (
              <div className="animate-fade-in">
                <h2 className="text-xl font-bold text-slate-100 mb-1 font-[family-name:var(--font-display)]">Student Sign In</h2>
                <p className="text-sm text-slate-400 mb-6">
                  Sign in to access your proctored quizzes
                </p>

                {/* Real Google Button */}
                <div className="mb-4 flex justify-center w-full min-h-[40px]">
                  {mounted && isSecureOrigin ? (
                    <GoogleLogin
                      onSuccess={handleGoogleSuccess}
                      onError={() => setError("Google Login Failed")}
                      theme="filled_black"
                      size="large"
                      text="signin_with"
                      shape="rectangular"
                    />
                  ) : mounted && !isSecureOrigin ? (
                    <div className="w-full py-3 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-bold rounded-xl text-center px-4">
                      Google Auth requires HTTPS. On mobile Wi-Fi, please use Email & Password.
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 h-px bg-slate-800" />
                  <span className="text-xs text-slate-500 font-semibold">OR</span>
                  <div className="flex-1 h-px bg-slate-800" />
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
                      Student Email Address
                    </label>
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="you@school.edu.ph"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
                      required
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-slate-300">Password</label>
                      <Link href="/login/forgot-password" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                        Forgot password?
                      </Link>
                    </div>
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3.5 rounded-xl bg-blue-600 text-sm font-bold text-white hover:bg-blue-700 transition-all shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
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

                <p className="text-center text-xs text-slate-400 mt-5">
                  Don&apos;t have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setActivePanel("register")}
                    className="text-blue-400 font-semibold hover:text-blue-300"
                  >
                    Create one →
                  </button>
                </p>
              </div>
            )}

            {/* ── REGISTER FORM ───────────────────── */}
            {activePanel === "register" && (
              <div className="animate-fade-in">
                <h2 className="text-xl font-bold text-slate-100 mb-1 font-[family-name:var(--font-display)]">Create Student Account</h2>
                <p className="text-sm text-slate-400 mb-6">
                  Join Proctor Shield student portal today
                </p>

                {/* Real Google Button */}
                <div className="mb-4 flex justify-center w-full">
                  {isSecureOrigin ? (
                    <GoogleLogin
                      onSuccess={handleGoogleSuccess}
                      onError={() => setError("Google Registration Failed")}
                      theme="filled_black"
                      size="large"
                      text="signup_with"
                      shape="rectangular"
                    />
                  ) : (
                    <div className="w-full py-3 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-bold rounded-xl text-center px-4">
                      Google Auth requires HTTPS. On mobile Wi-Fi, please use Email & Password.
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 h-px bg-slate-800" />
                  <span className="text-xs text-slate-500 font-semibold">OR</span>
                  <div className="flex-1 h-px bg-slate-800" />
                </div>

                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-300 mb-1.5 block">Full Name</label>
                    <input
                      type="text"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="Juan Dela Cruz"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-300 mb-1.5 block">Email Address</label>
                    <input
                      type="email"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="you@school.edu.ph"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-300 mb-1.5 block">Password</label>
                    <input
                      type="password"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Min. 6 characters"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-300 mb-1.5 block">Confirm Password</label>
                    <input
                      type="password"
                      value={regConfirm}
                      onChange={(e) => setRegConfirm(e.target.value)}
                      placeholder="Repeat your password"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3.5 rounded-xl bg-blue-600 text-sm font-bold text-white hover:bg-blue-700 transition-all shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
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

                <p className="text-center text-xs text-slate-400 mt-5">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setActivePanel("login")}
                    className="text-blue-400 font-semibold hover:text-blue-300"
                  >
                    Sign in instead →
                  </button>
                </p>
              </div>
            )}
            </>
            )}
          </div>
        </div>
      </div>
    </GoogleOAuthProvider>
  );
}
