"use client";

import { useState } from "react";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // MFA State
  const [mfaState, setMfaState] = useState({ isPending: false, userId: "", email: "", role: "" });
  const [otpCode, setOtpCode] = useState("");

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

      const data = await res.json().catch(() => ({ message: "Server error occurred" }));

      if (!res.ok) {
        setError(data.message || data.error || "Verification failed");
        setIsLoading(false);
        return;
      }

      const role = data.user?.role || data.role;
      if (role === "admin") {
        window.location.href = "/dashboard/admin";
      } else {
        setError("Access Denied: This portal is restricted to administrators.");
        setIsLoading(false);
      }
    } catch (err: any) {
      console.error("OTP verification error:", err);
      setError(err?.message || "Network error. Please try again.");
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
          email,
          password,
          role: "admin",
        }),
      });

      const data = await res.json().catch(() => ({ message: "Server error occurred" }));

      if (!res.ok) {
        setError(data.message || data.error || `Error ${res.status}: Failed to authenticate`);
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
      if (role === "admin") {
        window.location.href = "/dashboard/admin";
      } else {
        setError("Access Denied: This portal is restricted to administrators.");
        setIsLoading(false);
      }
    } catch (err: any) {
      console.error("Login request error:", err);
      setError(err?.message || "Network error. Please check your connection or database.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-rose-950/20 pointer-events-none" />

      <div className="w-full max-w-md p-8 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl relative z-10">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-2xl mx-auto mb-4">
            🔒
          </div>
          <h1 className="text-2xl font-extrabold text-slate-100 font-[family-name:var(--font-display)]">
            Admin Access
          </h1>
          <p className="text-sm text-slate-400 mt-2">
            Restricted to authorized system administrators only
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400 animate-fade-in text-center">
            ⚠ {error}
          </div>
        )}

        {mfaState.isPending ? (
          <div className="animate-fade-in">
            <h2 className="text-xl font-bold text-slate-100 mb-1 text-center font-[family-name:var(--font-display)]">Verify Your Identity</h2>
            <p className="text-sm text-slate-400 mb-6 text-center">
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
                  className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/30 transition-all text-center tracking-[0.5em]"
                  maxLength={6}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || otpCode.length !== 6}
                className="w-full py-3.5 rounded-xl bg-rose-600 text-sm font-bold text-white hover:bg-rose-700 transition-all shadow-md shadow-rose-600/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Verifying...
                  </span>
                ) : (
                  "Verify & Access Admin"
                )}
              </button>
            </form>
            <p className="text-center text-xs text-slate-400 mt-5">
              Didn't receive the email? Check your spam folder or{" "}
              <button
                onClick={() => { setMfaState({ isPending: false, userId: "", email: "", role: "" }); setOtpCode(""); }}
                className="text-rose-400 font-semibold hover:text-rose-300 cursor-pointer"
              >
                go back
              </button>
            </p>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-300 mb-1.5 block">Admin Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@proctorshield.ai"
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/30 transition-all"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 mb-1.5 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/30 transition-all"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 rounded-xl bg-rose-600 text-sm font-bold text-white hover:bg-rose-700 transition-all shadow-md shadow-rose-600/20 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed mt-2"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Authenticating...
                </span>
              ) : (
                "Access Admin Panel"
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
