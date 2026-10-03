"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { getAuthDestination } from "@/lib/auth-destination";

export default function LoginPage() {
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
      const response = await fetch("/api/auth/login", {
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
    <div className="auth-shell min-h-screen bg-[var(--dark-bg)] text-white flex items-center justify-center px-4 py-8 sm:p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-950/30 via-slate-950 to-slate-900 pointer-events-none" />
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-3xl mx-auto mb-4 shadow-lg shadow-blue-900/20" aria-hidden="true">🛡️</div>
          <h1 className="text-3xl font-extrabold font-[family-name:var(--font-display)] tracking-tight text-slate-100">Proctor Shield <span className="text-blue-400">AI</span></h1>
          <p className="text-sm text-slate-400 mt-2">Sign in to your account</p>
        </div>
        <div className="auth-panel p-6 sm:p-8 rounded-2xl bg-slate-900/70 border border-slate-800 shadow-xl">
          <h2 className="text-xl font-bold text-slate-100 mb-5 font-[family-name:var(--font-display)]">Sign In</h2>
          {error && <p role="alert" className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400">{error}</p>}
          <form onSubmit={handleLogin} aria-busy={isLoading} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="text-xs font-semibold text-slate-300 mb-1.5 block">Email</label>
              <input id="login-email" name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} disabled={isLoading} required className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-60" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <label htmlFor="login-password" className="text-xs font-semibold text-slate-300">Password</label>
                <Link href="/login/forgot-password" className="text-xs font-semibold text-blue-400 hover:text-blue-300">Forgot Password?</Link>
              </div>
              <div className="relative">
                <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={isLoading} required className="w-full px-4 py-3 pr-12 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-60" />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1">
                  {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={isLoading} className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 text-sm font-bold text-white hover:from-blue-500 hover:to-sky-400 shadow-lg shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed">{isLoading ? "Signing in..." : "Sign In"}</button>
          </form>
          <div className="mt-6 pt-5 border-t border-slate-800 text-center text-xs">
            <p className="text-slate-400 mb-3">Need an account?</p>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-3">
              <Link href="/login/student?tab=register" className="font-semibold text-blue-400 hover:text-blue-300">Create Student Account</Link>
              <Link href="/login/teacher?tab=register" className="font-semibold text-blue-400 hover:text-blue-300">Create Teacher Account</Link>
            </div>
            <p className="text-slate-400 mt-5 mb-2">Sign in with Google through your existing portal:</p>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-3">
              <Link href="/login/student" className="font-semibold text-blue-400 hover:text-blue-300">Student Google Sign In</Link>
              <Link href="/login/teacher" className="font-semibold text-blue-400 hover:text-blue-300">Teacher Google Sign In</Link>
            </div>
          </div>
        </div>
        <div className="mt-6 text-center">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 font-semibold"><ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />Back to Home Page</Link>
        </div>
      </div>
    </div>
  );
}
