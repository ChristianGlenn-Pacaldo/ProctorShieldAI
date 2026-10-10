"use client";

import { fetchAuth } from "@/lib/auth-request";

import { useRef, useState } from "react";
import Link from "next/link";
import BrandImage from "@/components/brand-image";
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
    <main className="auth-shell ps-auth-unified min-h-screen min-h-svh text-[var(--ps-text)] flex items-center justify-center px-4 py-8 sm:px-8 sm:py-12 relative overflow-hidden">
      <div aria-hidden="true" className="ps-auth-decoration absolute inset-0 bg-gradient-to-br from-slate-950/40 via-transparent to-blue-950/30 pointer-events-none" />
      <div className="relative z-10 grid w-full max-w-6xl min-w-0 items-center gap-12 lg:grid-cols-[1fr_460px] lg:gap-16 xl:gap-24">
        <aside aria-labelledby="login-intro" className="hidden min-w-0 lg:block">
          <div className="mb-12 flex items-center gap-3">
            <BrandImage width={40} decorative />
            <span className="text-2xl font-bold font-[family-name:var(--font-display)] tracking-tight">ProctorShield<span className="text-[var(--ps-accent)]">AI</span></span>
          </div>
          <h2 id="login-intro" className="text-5xl xl:text-6xl font-semibold font-[family-name:var(--font-display)] leading-[1.1] tracking-tight text-[var(--ps-text)]">Smarter Quizzes.<br /><span className="text-[var(--ps-accent)]">Higher Integrity.</span></h2>
          <p className="mt-6 max-w-md text-base leading-7 text-[var(--ps-text-secondary)]">Bring your quizzes, monitoring, and assessment insights together in one focused workspace.</p>
          <ul className="mt-9 space-y-5 text-base font-medium text-[var(--ps-text-secondary)]">
            <li className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-inset)] text-[var(--ps-accent)]" aria-hidden="true"><ScanFace className="h-5 w-5" /></span>AI-Assisted Monitoring</li>
            <li className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-inset)] text-[var(--ps-accent)]" aria-hidden="true"><ShieldCheck className="h-5 w-5" /></span>Secure Assessments</li>
            <li className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-inset)] text-[var(--ps-accent)]" aria-hidden="true"><BarChart3 className="h-5 w-5" /></span>Actionable Analytics</li>
          </ul>
        </aside>
        <div className="w-full min-w-0 max-w-[460px] mx-auto">
          <div className="mb-6 flex items-center justify-center gap-2.5 lg:hidden">
            <BrandImage width={30} decorative />
            <span className="text-2xl font-bold font-[family-name:var(--font-display)] tracking-tight">ProctorShield<span className="text-[var(--ps-accent)]">AI</span></span>
          </div>
          <section aria-labelledby="login-heading" className="ps-auth-card rounded-3xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 sm:p-8 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.6)]">
            <div className="mb-7">
              <h1 id="login-heading" className="text-3xl font-semibold text-[var(--ps-text)] font-[family-name:var(--font-display)] tracking-tight">Welcome Back</h1>
              <p className="mt-2 text-base leading-6 text-[var(--ps-text-secondary)]">Sign in to your ProctorShieldAI account</p>
            </div>
            {sessionUnavailable && <p role="alert" className="ps-auth-alert ps-auth-warning mb-4 p-3 rounded-xl bg-[var(--ps-warning-soft)] border border-[var(--ps-warning)] text-base text-[var(--ps-warning)]">Sign-in status is temporarily unavailable. Please try again.</p>}
            {error && <p role="alert" className="ps-auth-alert mb-4 p-3 rounded-xl bg-[var(--ps-error-soft)] border border-[var(--ps-error)] text-base text-[var(--ps-error)]">{error}</p>}
            <form onSubmit={handleLogin} aria-busy={isLoading} aria-labelledby="login-heading" className="space-y-5">
              <div>
                <label htmlFor="login-email" className="text-base font-medium text-[var(--ps-text-secondary)] mb-2 block">Email Address</label>
                <input id="login-email" name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} disabled={isLoading} required className="w-full min-h-12 px-4 py-3 rounded-xl bg-[var(--ps-surface-inset)] border border-[var(--ps-border-control)] text-base text-[var(--ps-text)] focus:outline-none focus:border-[var(--ps-focus)] focus:ring-2 focus:ring-[var(--ps-focus)] disabled:opacity-60" />
              </div>
              <div>
                <div className="flex flex-wrap items-center justify-between mb-2 gap-2">
                  <label htmlFor="login-password" className="text-base font-medium text-[var(--ps-text-secondary)]">Password</label>
                  <Link href="/login/forgot-password" className="rounded text-sm font-semibold text-[var(--ps-accent)] hover:text-[var(--ps-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-focus)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--ps-surface)]">Forgot Password?</Link>
                </div>
                <div className="relative">
                  <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={isLoading} required className="w-full min-h-12 px-4 py-3 pr-14 rounded-xl bg-[var(--ps-surface-inset)] border border-[var(--ps-border-control)] text-base text-[var(--ps-text)] focus:outline-none focus:border-[var(--ps-focus)] focus:ring-2 focus:ring-[var(--ps-focus)] disabled:opacity-60" />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-controls="login-password" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-1 my-auto flex h-11 w-11 items-center justify-center rounded-lg text-[var(--ps-text-secondary)] hover:text-[var(--ps-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-focus)]">
                    {showPassword ? <EyeOff className="w-5 h-5" aria-hidden="true" /> : <Eye className="w-5 h-5" aria-hidden="true" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={isLoading} className="w-full min-h-12 py-3.5 rounded-xl ps-auth-primary bg-[var(--ps-primary)] text-base font-bold text-[var(--ps-text)] hover:from-blue-600 hover:to-blue-500 shadow-lg shadow-blue-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-focus)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--ps-surface)] disabled:opacity-50 disabled:cursor-not-allowed">{isLoading ? "Signing in..." : "Sign In"}</button>
            </form>
            {!isLoading && <UnifiedGoogleSignIn />}
            <div className="mt-6 pt-5 border-t border-[var(--ps-border)] text-center text-sm">
              <p className="text-[var(--ps-text-secondary)] mb-4">Don&apos;t have an account?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Link href="/login/student?tab=register" className="flex min-h-11 items-center justify-center rounded-xl border border-[var(--ps-border-control)] px-3 py-3 font-semibold text-[var(--ps-text-secondary)] hover:border-[var(--ps-focus)] hover:bg-[var(--ps-accent-soft)] hover:text-[var(--ps-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ps-surface)]">Create Student Account</Link>
                <Link href="/login/teacher?tab=register" className="flex min-h-11 items-center justify-center rounded-xl border border-[var(--ps-border-control)] px-3 py-3 font-semibold text-[var(--ps-text-secondary)] hover:border-[var(--ps-focus)] hover:bg-[var(--ps-accent-soft)] hover:text-[var(--ps-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ps-surface)]">Create Teacher Account</Link>
              </div>
            </div>
          </section>
          <div className="mt-6 text-center">
            <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded px-2 text-sm text-[var(--ps-text-secondary)] hover:text-[var(--ps-text)] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-focus)]"><ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />Back to Home Page</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
