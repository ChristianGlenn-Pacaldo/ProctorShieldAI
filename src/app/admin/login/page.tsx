"use client";

import { useState } from "react";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";

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

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Verification failed");
        setIsLoading(false);
        return;
      }

      const role = data.user?.role || data.role;
      window.location.href = `/dashboard/${role}`;
    } catch {
      setError("Network error. Please try again.");
      setIsLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: credentialResponse.credential,
          role: "admin", // Lock role to admin
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

      // Universal redirect based on role
      const role = data.user?.role || data.role;
      window.location.href = `/dashboard/${role}`;
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
          email,
          password,
          role: "admin",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Invalid admin credentials");
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

      // Universal redirect based on role
      const role = data.user?.role || data.role;
      window.location.href = `/dashboard/${role}`;
    } catch {
      setError("Network error. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ""}>
      <div className="min-h-screen bg-[var(--dark-bg)] flex items-center justify-center p-6 relative overflow-hidden">
        {/* Decorative gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-red-600/10 via-transparent to-rose-600/10 pointer-events-none" />

        <div className="w-full max-w-md p-8 rounded-2xl bg-white/[0.02] border border-white/[0.06] backdrop-blur-xl shadow-2xl relative z-10">
          <div className="text-center mb-8">
            <div className="text-5xl mb-4 animate-bounce">🔒</div>
            <h1 className="text-2xl font-extrabold text-white font-[family-name:var(--font-display)]">
              Admin Access
            </h1>
            <p className="text-sm text-white/35 mt-2">
              Restricted to authorized system administrators only
            </p>
          </div>


          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 animate-fade-in text-center">
              ⚠ {error}
            </div>
          )}

          {mfaState.isPending ? (
            <div className="animate-fade-in">
              <h2 className="text-xl font-bold text-white mb-1 text-center">Verify Your Identity</h2>
              <p className="text-sm text-white/35 mb-6 text-center">
                We sent a 6-digit verification code to <strong className="text-white">{mfaState.email}</strong>.
              </p>

              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-white/45 mb-1.5 block">
                    Verification Code
                  </label>
                  <input
                    type="text"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="Enter 6-digit code"
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/30 transition-all text-center tracking-[0.5em]"
                    maxLength={6}
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading || otpCode.length !== 6}
                  className="w-full py-3.5 rounded-xl bg-red-600 text-sm font-bold text-white hover:bg-red-500 transition-all shadow-lg shadow-red-600/25 disabled:opacity-50 disabled:cursor-not-allowed"
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
              <p className="text-center text-xs text-white/25 mt-5">
                Didn't receive the email? Check your spam folder or{" "}
                <button
                  onClick={() => { setMfaState({ isPending: false, userId: "", email: "", role: "" }); setOtpCode(""); }}
                  className="text-red-400 font-semibold hover:text-red-300"
                >
                  go back
                </button>
              </p>
            </div>
          ) : (
            <>
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
                  <label className="text-xs font-semibold text-white/45 mb-1.5 block">Admin Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@proctorshield.ai"
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/30 transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-white/45 mb-1.5 block">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/30 transition-all"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3.5 rounded-xl bg-red-600 text-sm font-bold text-white hover:bg-red-500 transition-all shadow-lg shadow-red-600/25 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
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
            </>
          )}
        </div>
      </div>
    </GoogleOAuthProvider>
  );
}
