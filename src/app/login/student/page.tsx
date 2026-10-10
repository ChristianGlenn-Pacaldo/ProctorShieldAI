"use client";

import { fetchAuth } from "@/lib/auth-request";

import { useState, useEffect } from "react";
import Link from "next/link";
import BrandImage from "@/components/brand-image";
import { Target, Camera, Brain, Lock, UserPlus, LogIn, Eye, EyeOff } from "lucide-react";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";

type Panel = "login" | "register";

export default function StudentLoginPage() {
  const [activePanel, setActivePanel] = useState<Panel>("login");
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [googleScriptStatus, setGoogleScriptStatus] = useState<"loading" | "ready" | "error">("loading");
  const [showPassword, setShowPassword] = useState(false);

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

  useEffect(() => {
    setMounted(true);
    // Check URL query param for default tab
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("tab") === "register" || params.get("mode") === "register") {
        setActivePanel("register");
      }
    }
  }, []);

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setError("");
    setIsLoading(true);

    try {
      const res = await fetchAuth(fetch, "/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: credentialResponse.credential,
          role: "student",
        }),
      });

      const data = await res.json().catch(() => ({ message: "Google auth server error" }));

      if (!res.ok) {
        setError(data.message || data.error || "Google Authentication failed");
        setIsLoading(false);
        return;
      }

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

      const role = data.user?.role || data.role;
      if (role === "student") {
        const pendingCode = localStorage.getItem("pendingJoinCode");
        if (pendingCode) {
          localStorage.removeItem("pendingJoinCode");
          window.location.href = `/join?code=${pendingCode}`;
        } else {
          window.location.href = "/dashboard/student";
        }
      } else {
        setError(`Access Denied: This portal is restricted to students. Your account is registered as ${role?.toUpperCase()}.`);
        setIsLoading(false);
      }
    } catch (err: any) {
      console.error("Google login error:", err);
      setError("Network error connecting to Google Auth. Please register with Email & Password below.");
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!loginEmail || !loginPassword) {
      setError("Please fill in both email and password.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetchAuth(fetch, "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
          role: "student",
        }),
      });

      const data = await res.json().catch(() => ({ message: "Server error occurred" }));

      if (!res.ok) {
        setError(data.message || data.error || "Invalid email or password");
        setIsLoading(false);
        return;
      }

      const role = data.user?.role || data.role;
      if (role === "student") {
        const pendingCode = localStorage.getItem("pendingJoinCode");
        if (pendingCode) {
          localStorage.removeItem("pendingJoinCode");
          window.location.href = `/join?code=${pendingCode}`;
        } else {
          window.location.href = "/dashboard/student";
        }
      } else {
        setError(`Access Denied: This portal is restricted to students. Your account is registered as ${role?.toUpperCase()}.`);
        setIsLoading(false);
      }
    } catch (err: any) {
      console.error("Login error:", err);
      setError("Network error. Please check your connection.");
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!regName.trim()) {
      setError("Please enter your full name");
      return;
    }

    if (!regEmail.trim()) {
      setError("Please enter your email address");
      return;
    }

    if (regPassword.length < 10 || !/[A-Za-z]/.test(regPassword) || !/\d/.test(regPassword)) {
      setError("Password must be at least 10 characters and contain letters and numbers");
      return;
    }

    if (regPassword !== regConfirm) {
      setError("Passwords do not match. Please verify your password.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetchAuth(fetch, "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: regName.trim(),
          email: regEmail.trim(),
          password: regPassword,
          confirmPassword: regConfirm,
          role: "student",
        }),
      });

      const data = await res.json().catch(() => ({ message: "Server error occurred" }));

      if (!res.ok) {
        setError(data.message || data.error || "Registration failed. Please try a different email.");
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
    } catch (err: any) {
      console.error("Registration error:", err);
      setError("Network error during registration. Please try again.");
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetchAuth(fetch, "/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: mfaState.userId,
          otpCode: otpCode,
        }),
      });

      const data = await res.json().catch(() => ({ message: "Verification error" }));

      if (!res.ok) {
        setError(data.message || data.error || "Verification failed");
        setIsLoading(false);
        return;
      }

      const role = data.user?.role || data.role;
      if (role === "student") {
        const pendingCode = localStorage.getItem("pendingJoinCode");
        if (pendingCode) {
          localStorage.removeItem("pendingJoinCode");
          window.location.href = `/join?code=${pendingCode}`;
        } else {
          window.location.href = "/dashboard/student";
        }
      } else {
        setError(`Access Denied: This portal is restricted to students. Your account is registered as ${role?.toUpperCase()}.`);
        setIsLoading(false);
      }
    } catch (err: any) {
      console.error("OTP error:", err);
      setError("Network error. Please try again.");
      setIsLoading(false);
    }
  };

  const features = [
    { icon: <Target className="w-5 h-5" />, title: "AI-Assisted Face Detection", sub: "Real-time monitoring" },
    { icon: <Camera className="w-5 h-5" />, title: "Automatic Evidence Capture", sub: "Screenshots on every violation event" },
    { icon: <Brain className="w-5 h-5" />, title: "Gemini AI Verdict", sub: "Intelligent cheating analysis report" },
    { icon: <Lock className="w-5 h-5" />, title: "Role-based Access Control", sub: "Secure, individual student dashboards" },
  ];

  return (
    <GoogleOAuthProvider
      clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ""}
      onScriptLoadSuccess={() => setGoogleScriptStatus("ready")}
      onScriptLoadError={() => {
        setGoogleScriptStatus("error");
        setError("Google sign-in could not load. Check your connection and retry.");
      }}
    >
      <div className="auth-shell ps-auth-portal min-h-screen flex bg-[var(--ps-canvas)]">
        {/* ── LEFT PANEL (DESKTOP) ─────────────────── */}
        <div className="ps-auth-intro hidden lg:flex lg:w-1/2 bg-[var(--ps-canvas)] text-[var(--ps-text)] relative overflow-hidden">
          <div className="ps-auth-decoration absolute inset-0 bg-gradient-to-br from-blue-950/40 via-slate-950 to-slate-900 pointer-events-none" />
          <div className="relative z-10 flex flex-col justify-center px-16 py-12">
            <BrandImage width={50} className="mb-6" />
            <h1 className="text-3xl font-extrabold mb-3 font-[family-name:var(--font-display)] text-[var(--ps-text)]">
              Student Portal
            </h1>
            <p className="text-base text-[var(--ps-text-muted)] leading-relaxed mb-10 max-w-md">
              Access your quizzes in a secure environment. ProctorShieldAI monitors proctored sessions, records evidence, and analyzes logs automatically.
            </p>
            <div className="space-y-5">
              {features.map((f) => (
                <div key={f.title} className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[var(--ps-surface)] border border-[var(--ps-border)] flex items-center justify-center text-[var(--ps-accent)] shrink-0">
                    {f.icon}
                  </div>
                  <div>
                    <div className="text-base font-semibold text-[var(--ps-text-secondary)]">{f.title}</div>
                    <div className="text-sm text-[var(--ps-text-muted)]">{f.sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-12 pt-8 border-t border-[var(--ps-border)] text-center">
              <p className="text-sm text-[var(--ps-text-muted)]">
                ← Back to{" "}
                <Link href="/login" className="text-[var(--ps-accent)] font-semibold hover:text-[var(--ps-accent)]">
                  Portal Selection
                </Link>
              </p>
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL ──────────────────────────── */}
        <div className="auth-panel w-full lg:w-1/2 bg-[var(--ps-surface)] flex items-center justify-center p-4 sm:p-8 border-l border-[var(--ps-border)] min-h-screen">
          <div className="w-full max-w-md my-auto">
            {/* Mobile Branding Header */}
            <div className="lg:hidden text-center mb-6">
              <BrandImage width={42} className="mx-auto mb-2" />
              <h1 className="text-2xl font-extrabold text-[var(--ps-text)] font-[family-name:var(--font-display)]">
                Student Portal
              </h1>
              <p className="text-sm text-[var(--ps-text-muted)] mt-0.5">
                ProctorShieldAI Examination System
              </p>
            </div>

            {/* TAB SWITCHER (TOUCH OPTIMIZED) */}
            <div className="grid grid-cols-2 gap-1.5 bg-[var(--ps-canvas)] p-1.5 rounded-2xl border border-[var(--ps-border)] mb-6 shadow-inner">
              <button
                type="button"
                onClick={() => { setActivePanel("login"); setError(""); }}
                className={`py-3.5 px-4 rounded-xl text-base font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer select-none touch-manipulation ${
                  activePanel === "login"
                    ? "ps-auth-primary bg-[var(--ps-primary)] text-[var(--ps-text)] shadow-md shadow-blue-600/30 scale-[1.02]"
                    : "text-[var(--ps-text-muted)] hover:text-[var(--ps-text-secondary)] bg-transparent"
                }`}
              >
                <LogIn className="w-4 h-4" /> Sign In
              </button>
              <button
                type="button"
                onClick={() => { setActivePanel("register"); setError(""); }}
                className={`py-3.5 px-4 rounded-xl text-base font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer select-none touch-manipulation ${
                  activePanel === "register"
                    ? "ps-auth-primary bg-[var(--ps-primary)] text-[var(--ps-text)] shadow-md shadow-blue-600/30 scale-[1.02]"
                    : "text-[var(--ps-text-muted)] hover:text-[var(--ps-text-secondary)] bg-transparent"
                }`}
              >
                <UserPlus className="w-4 h-4" /> Create Account
              </button>
            </div>

            {/* Error Message Box */}
            {error && (
              <div role="alert" className="ps-auth-alert mb-5 p-3.5 rounded-xl bg-[var(--ps-error-soft)] border border-[var(--ps-error)] text-base text-[var(--ps-error)] animate-fade-in text-center font-medium">
                ⚠ {error}
              </div>
            )}

            {!mfaState.isPending && (
              <div className="mb-5 space-y-5">
                <div>
                  <h2 className="text-xl font-bold text-[var(--ps-text)] font-[family-name:var(--font-display)]">
                    {activePanel === "login" ? "Student Sign In" : "Create Student Account"}
                  </h2>
                  <p className="text-sm text-[var(--ps-text-muted)] mt-1">
                    {activePanel === "login"
                      ? "Sign in to access your proctored quizzes"
                      : "Register to start taking proctored exams"}
                  </p>
                </div>

                <div className="flex min-h-[44px] w-full items-center justify-center">
                  {!mounted || googleScriptStatus === "loading" ? (
                    <div className="flex items-center gap-2 text-base text-[var(--ps-text-muted)]" role="status">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400/30 border-t-blue-400" />
                      Loading Google sign-in...
                    </div>
                  ) : googleScriptStatus === "error" ? (
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="h-11 rounded-lg border border-[var(--ps-border-control)] px-5 text-base font-semibold text-[var(--ps-text-secondary)] transition-colors hover:border-[var(--ps-focus)] hover:text-[var(--ps-text)]"
                    >
                      Retry Google sign-in
                    </button>
                  ) : (
                    <GoogleLogin
                      onSuccess={handleGoogleSuccess}
                      onError={() => setError("Google sign-in failed. Please retry or use email and password.")}
                      theme="outline"
                      size="large"
                      text="continue_with"
                      shape="rectangular"
                    />
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-[var(--ps-border)]" />
                  <span className="text-sm text-[var(--ps-text-muted)] font-semibold">
                    {activePanel === "login" ? "OR EMAIL" : "OR REGISTER WITH EMAIL"}
                  </span>
                  <div className="flex-1 h-px bg-[var(--ps-border)]" />
                </div>
              </div>
            )}

            {/* ── MFA OTP FORM ──────────────────────── */}
            {mfaState.isPending ? (
              <div className="animate-fade-in bg-[var(--ps-surface-inset)] p-6 rounded-2xl border border-[var(--ps-border)]">
                <h2 className="text-xl font-bold text-[var(--ps-text)] mb-1 font-[family-name:var(--font-display)]">Verify Your Identity</h2>
                <p className="text-base text-[var(--ps-text-muted)] mb-6">
                  We sent a 6-digit verification code to <strong className="text-[var(--ps-text-secondary)]">{mfaState.email}</strong>.
                </p>

                <form onSubmit={handleVerifyOtp} aria-busy={isLoading} className="space-y-4">
                  <div>
                    <label htmlFor="student-otp" className="text-sm font-semibold text-[var(--ps-text-secondary)] mb-1.5 block">
                      Verification Code
                    </label>
                    <input
                      id="student-otp" type="text"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="Enter 6-digit code"
                      className="w-full px-4 py-3.5 rounded-xl bg-[var(--ps-canvas)] border border-[var(--ps-border)] text-base text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:border-[var(--ps-focus)] focus:ring-2 focus:ring-[var(--ps-focus)] transition-all text-center tracking-[0.5em] font-mono"
                      maxLength={6}
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading || otpCode.length !== 6}
                    className="w-full py-4 rounded-xl ps-auth-primary bg-[var(--ps-primary)] text-base font-bold text-[var(--ps-text)] hover:bg-[var(--ps-primary-hover)] active:scale-[0.99] transition-all shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer touch-manipulation"
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
                <p className="text-center text-sm text-[var(--ps-text-muted)] mt-5">
                  Didn&apos;t receive the email? Check your spam folder or{" "}
                  <button
                    type="button"
                    onClick={() => { setMfaState({ isPending: false, userId: "", email: "", role: "" }); setOtpCode(""); }}
                    className="text-[var(--ps-accent)] font-semibold hover:text-[var(--ps-accent)] cursor-pointer underline"
                  >
                    go back
                  </button>
                </p>
              </div>
            ) : (
              <>
                {/* ── 1. LOGIN FORM ───────────────────── */}
                {activePanel === "login" && (
                  <div className="animate-fade-in space-y-5">
                    <form onSubmit={handleLogin} aria-busy={isLoading} className="space-y-4">
                      <div>
                        <label htmlFor="student-login-email" className="text-sm font-semibold text-[var(--ps-text-secondary)] mb-1.5 block">
                          Student Email Address
                        </label>
                        <input
                          id="student-login-email" type="email"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          placeholder="student@demo.com"
                          autoComplete="email"
                          className="w-full px-4 py-3.5 rounded-xl bg-[var(--ps-canvas)] border border-[var(--ps-border)] text-base text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:border-[var(--ps-focus)] focus:ring-2 focus:ring-[var(--ps-focus)] transition-all"
                          required
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label htmlFor="student-login-password" className="text-sm font-semibold text-[var(--ps-text-secondary)]">Password</label>
                          <Link
                            href="/login/forgot-password?role=student"
                            className="text-sm font-semibold text-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors"
                          >
                            Forgot password?
                          </Link>
                        </div>
                        <div className="relative">
                        <input
                          id="student-login-password" type={showPassword ? "text" : "password"}
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          className="w-full px-4 py-3.5 pr-12 rounded-xl bg-[var(--ps-canvas)] border border-[var(--ps-border)] text-base text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:border-[var(--ps-focus)] focus:ring-2 focus:ring-[var(--ps-focus)] transition-all"
                          required
                        />
                        <button type="button" onClick={() => setShowPassword((value) => !value)} aria-controls="student-login-password" aria-label={showPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 px-4 text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)]">
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full py-4 rounded-xl ps-auth-primary bg-[var(--ps-primary)] text-base font-bold text-[var(--ps-text)] hover:bg-[var(--ps-primary-hover)] active:scale-[0.99] transition-all shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer touch-manipulation"
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

                    <div className="text-center pt-2">
                      <p className="text-sm text-[var(--ps-text-muted)]">
                        Don&apos;t have an account?{" "}
                        <button
                          type="button"
                          onClick={() => { setActivePanel("register"); setError(""); }}
                          className="text-[var(--ps-accent)] font-bold hover:text-[var(--ps-accent)] cursor-pointer underline touch-manipulation"
                        >
                          Create one now →
                        </button>
                      </p>
                    </div>
                  </div>
                )}

                {/* ── 2. REGISTER FORM ────────────────── */}
                {activePanel === "register" && (
                  <div className="animate-fade-in space-y-5">
                    <form onSubmit={handleRegister} aria-busy={isLoading} className="space-y-3.5">
                      <div>
                        <label htmlFor="student-register-name" className="text-sm font-semibold text-[var(--ps-text-secondary)] mb-1 block">Full Name</label>
                        <input
                          id="student-register-name" type="text"
                          value={regName}
                          onChange={(e) => setRegName(e.target.value)}
                          placeholder="Juan Dela Cruz"
                          autoComplete="name"
                          className="w-full px-4 py-3 rounded-xl bg-[var(--ps-canvas)] border border-[var(--ps-border)] text-base text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:border-[var(--ps-focus)] focus:ring-2 focus:ring-[var(--ps-focus)] transition-all"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="student-register-email" className="text-sm font-semibold text-[var(--ps-text-secondary)] mb-1 block">Email Address</label>
                        <input
                          id="student-register-email" type="email"
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          placeholder="student@school.edu.ph"
                          autoComplete="email"
                          className="w-full px-4 py-3 rounded-xl bg-[var(--ps-canvas)] border border-[var(--ps-border)] text-base text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:border-[var(--ps-focus)] focus:ring-2 focus:ring-[var(--ps-focus)] transition-all"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="student-register-password" className="text-sm font-semibold text-[var(--ps-text-secondary)] mb-1 block">Password</label>
                        <input
                          id="student-register-password" type="password"
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder="Create a password"
                          aria-describedby="student-register-password-help"
                          autoComplete="new-password"
                          className="w-full px-4 py-3 rounded-xl bg-[var(--ps-canvas)] border border-[var(--ps-border)] text-base text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:border-[var(--ps-focus)] focus:ring-2 focus:ring-[var(--ps-focus)] transition-all"
                          required
                        />
                        <p id="student-register-password-help" className="mt-2 text-sm leading-5 text-[var(--ps-text-secondary)]">10–128 characters, including letters and numbers.</p>
                      </div>
                      <div>
                        <label htmlFor="student-register-confirm" className="text-sm font-semibold text-[var(--ps-text-secondary)] mb-1 block">Confirm Password</label>
                        <input
                          id="student-register-confirm" type="password"
                          value={regConfirm}
                          onChange={(e) => setRegConfirm(e.target.value)}
                          placeholder="Repeat your password"
                          autoComplete="new-password"
                          className="w-full px-4 py-3 rounded-xl bg-[var(--ps-canvas)] border border-[var(--ps-border)] text-base text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:border-[var(--ps-focus)] focus:ring-2 focus:ring-[var(--ps-focus)] transition-all"
                          required
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full py-4 rounded-xl ps-auth-primary bg-[var(--ps-primary)] text-base font-bold text-[var(--ps-text)] hover:bg-[var(--ps-primary-hover)] active:scale-[0.99] transition-all shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer touch-manipulation mt-2"
                      >
                        {isLoading ? (
                          <span className="flex items-center justify-center gap-2">
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Creating Account...
                          </span>
                        ) : (
                          "Create Student Account"
                        )}
                      </button>
                    </form>

                    <div className="text-center pt-2">
                      <p className="text-sm text-[var(--ps-text-muted)]">
                        Already have an account?{" "}
                        <button
                          type="button"
                          onClick={() => { setActivePanel("login"); setError(""); }}
                          className="text-[var(--ps-accent)] font-bold hover:text-[var(--ps-accent)] cursor-pointer underline touch-manipulation"
                        >
                          Sign in instead →
                        </button>
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="lg:hidden mt-8 pt-6 border-t border-[var(--ps-border)] text-center">
              <Link href="/login" className="text-sm text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] transition-colors">
                ← Back to Portal Selection
              </Link>
            </div>
          </div>
        </div>
      </div>
    </GoogleOAuthProvider>
  );
}
