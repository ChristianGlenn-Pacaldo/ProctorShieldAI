"use client";

import { fetchAuth } from "@/lib/auth-request";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, Eye, EyeOff, ScanFace, ShieldCheck } from "lucide-react";
import { getAuthDestination } from "@/lib/auth-destination";
import UnifiedGoogleSignIn from "./unified-google-signin";

export default function LoginContent({ sessionUnavailable = false }: { sessionUnavailable?: boolean } = {}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  // The synchronous guard also covers submissions before the loading render.
  const submitting = useRef(false);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    submitting.current = true;
    setIsLoading(true);
    setError("");
    let navigating = false;
    try {
      const response = await fetchAuth(fetch, "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        // Do not render arbitrary server messages or internal error details.
        if (response.status === 401) setError("Invalid email or password.");
        else if (response.status === 429) setError("Too many sign-in attempts. Please try again later.");
        else if (response.status === 403) setError("Sign-in is not allowed for this account or request.");
        else setError("Unable to sign in. Please try again.");
        return;
      }
      const destination = data?.success === true && data?.requiresMfa !== true
        ? getAuthDestination(data?.user?.role) : null;
      if (!destination) {
        setError("Unable to confirm your account. Please try signing in again.");
        return;
      }
      // A full document request mounts the freshly authenticated account shell.
      window.location.assign(new URL(destination, window.location.origin).href);
      navigating = true;
    } catch {
      setError("Unable to sign in. Please check your connection and try again.");
    } finally {
      if (!navigating) {
        submitting.current = false;
        setIsLoading(false);
      }
    }
  };

  return (
    <main className="auth-shell min-h-screen min-h-svh text-white flex items-center justify-center px-4 py-8 sm:px-8 sm:py-12 relative overflow-hidden">
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-slate-950/40 via-transparent to-blue-950/30 pointer-events-none" />
      <div className="relative z-10 grid w-full max-w-6xl min-w-0 items-center gap-12 lg:grid-cols-[1fr_460px] lg:gap-16 xl:gap-24">
        <aside aria-labelledby="login-intro" className="hidden min-w-0 lg:block">
          <div className="mb-12 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-400/25 bg-blue-500/10 text-cyan-300" aria-hidden="true"><ShieldCheck className="h-6 w-6" /></div>
            <span className="text-2xl font-bold font-[family-name:var(--font-display)] tracking-tight">ProctorShield<span className="text-cyan-300">AI</span></span>
          </div>
          <h2 id="login-intro" className="text-5xl xl:text-6xl font-semibold font-[family-name:var(--font-display)] leading-[1.1] tracking-tight text-slate-50">Smarter Quizzes.<br /><span className="text-cyan-300">Higher Integrity.</span></h2>
          <p className="mt-6 max-w-md text-base leading-7 text-slate-300">Bring your quizzes, monitoring, and assessment insights together in one focused workspace.</p>
          <ul className="mt-9 space-y-5 text-sm font-medium text-slate-200">
            <li className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700/70 bg-slate-900/60 text-cyan-300" aria-hidden="true"><ScanFace className="h-5 w-5" /></span>AI-Assisted Monitoring</li>
            <li className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700/70 bg-slate-900/60 text-cyan-300" aria-hidden="true"><ShieldCheck className="h-5 w-5" /></span>Secure Assessments</li>
            <li className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700/70 bg-slate-900/60 text-cyan-300" aria-hidden="true"><BarChart3 className="h-5 w-5" /></span>Actionable Analytics</li>
          </ul>
        </aside>
        <div className="w-full min-w-0 max-w-[460px] mx-auto">
          <div className="mb-6 flex items-center justify-center gap-2.5 lg:hidden">
            <ShieldCheck className="h-7 w-7 text-cyan-300" aria-hidden="true" />
            <span className="text-2xl font-bold font-[family-name:var(--font-display)] tracking-tight">ProctorShield<span className="text-cyan-300">AI</span></span>
          </div>
          <section aria-labelledby="login-heading" className="rounded-3xl border border-blue-300/15 bg-[#0b1830] p-6 sm:p-8 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.6)]">
            <div className="mb-7">
              <h1 id="login-heading" className="text-3xl font-semibold text-slate-50 font-[family-name:var(--font-display)] tracking-tight">Welcome Back</h1>
              <p className="mt-2 text-sm leading-6 text-slate-300">Sign in to your ProctorShieldAI account</p>
            </div>
            {sessionUnavailable && <p role="alert" className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">Sign-in status is temporarily unavailable. Please try again.</p>}
            {error && <p role="alert" className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400">{error}</p>}
            <form onSubmit={handleLogin} aria-busy={isLoading} aria-labelledby="login-heading" className="space-y-5">
              <div>
                <label htmlFor="login-email" className="text-sm font-medium text-slate-200 mb-2 block">Email Address</label>
                <input id="login-email" name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} disabled={isLoading} required className="w-full min-h-12 px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-700 text-base text-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30 disabled:opacity-60" />
              </div>
              <div>
                <div className="flex flex-wrap items-center justify-between mb-2 gap-2">
                  <label htmlFor="login-password" className="text-sm font-medium text-slate-200">Password</label>
                  <Link href="/login/forgot-password" className="rounded text-xs font-semibold text-blue-300 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0b1830]">Forgot Password?</Link>
                </div>
                <div className="relative">
                  <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={isLoading} required className="w-full min-h-12 px-4 py-3 pr-14 rounded-xl bg-slate-950/60 border border-slate-700 text-base text-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30 disabled:opacity-60" />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-controls="login-password" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-1 my-auto flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                    {showPassword ? <EyeOff className="w-5 h-5" aria-hidden="true" /> : <Eye className="w-5 h-5" aria-hidden="true" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={isLoading} className="w-full min-h-12 py-3.5 rounded-xl bg-gradient-to-r from-blue-700 to-blue-600 text-sm font-bold text-white hover:from-blue-600 hover:to-blue-500 shadow-lg shadow-blue-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0b1830] disabled:opacity-50 disabled:cursor-not-allowed">{isLoading ? "Signing in..." : "Sign In"}</button>
            </form>
            {!isLoading && <UnifiedGoogleSignIn />}
            <div className="mt-6 pt-5 border-t border-slate-700/60 text-center text-xs">
              <p className="text-slate-300 mb-4">Don&apos;t have an account?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Link href="/login/student?tab=register" className="flex min-h-11 items-center justify-center rounded-xl border border-slate-600 px-3 py-3 font-semibold text-slate-200 hover:border-blue-400 hover:bg-blue-500/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1830]">Create Student Account</Link>
                <Link href="/login/teacher?tab=register" className="flex min-h-11 items-center justify-center rounded-xl border border-slate-600 px-3 py-3 font-semibold text-slate-200 hover:border-blue-400 hover:bg-blue-500/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1830]">Create Teacher Account</Link>
              </div>
            </div>
          </section>
          <div className="mt-6 text-center">
            <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded px-2 text-xs text-slate-300 hover:text-white font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />Back to Home Page</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
