"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import BrandImage from "@/components/brand-image";
import { Mail, KeyRound, Lock, Eye, EyeOff, ArrowLeft, CheckCircle2 } from "lucide-react";

type Step = "email" | "reset" | "done";

function ForgotPasswordContent() {
  const searchParams = useSearchParams();
  const role = searchParams.get("role");
  const portalRole = role === "teacher" || role === "student" ? role : null;
  const loginHref = portalRole ? `/login/${portalRole}` : "/login";
  const portalName = portalRole
    ? `${portalRole[0].toUpperCase()}${portalRole.slice(1)}`
    : null;
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError("Please enter your email address."); return; }
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) {
        setStep("reset");
      } else {
        setError(data.message || "Failed to send reset code.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim() || otpCode.length !== 6) { setError("Please enter the 6-digit code."); return; }
    if (!newPassword || newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) { setError("Password must be at least 10 characters and contain letters and numbers."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match."); return; }
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otpCode, newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setStep("done");
      } else {
        setError(data.message || "Failed to reset password.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-shell ps-auth-recovery app-gradient-shell min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <BrandImage width={50} className="mx-auto mb-4" decorative />
          <h1 className="text-2xl font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">ProctorShieldAI</h1>
          <p className="text-sm text-[var(--muted)] mt-1 uppercase tracking-widest font-semibold">
            {portalName ? `${portalName} Password Recovery` : "Password Recovery"}
          </p>
        </div>

        <div className="auth-panel bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-xl overflow-hidden">
          {/* Progress bar */}
          <div className="h-1 bg-[var(--surface2)]">
            <div
              className="h-full bg-[var(--ps-primary)] transition-all duration-500"
              style={{ width: step === "email" ? "33%" : step === "reset" ? "66%" : "100%" }}
            />
          </div>

          <div className="p-8">
            {/* Step 1: Email */}
            {step === "email" && (
              <form onSubmit={handleRequestReset} aria-busy={isLoading} className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">Forgot your password?</h2>
                  <p className="text-base text-[var(--muted)] mt-1">Enter your account email and we'll send you a verification code.</p>
                </div>
                <div>
                  <label htmlFor="recovery-email" className="text-sm font-semibold text-[var(--muted)] mb-1.5 block uppercase tracking-wide">Email Address</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
                    <input
                      id="recovery-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      autoComplete="email"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-base text-[var(--ink)] focus:outline-none focus:border-[var(--ps-focus)] transition-colors"
                      required
                    />
                  </div>
                </div>
                {error && <p role="alert" className="ps-auth-alert text-sm text-[var(--ps-error)] font-semibold">{error}</p>}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 ps-auth-primary bg-[var(--ps-primary)] hover:bg-[var(--ps-primary-hover)] text-[var(--ps-text)] font-bold rounded-xl transition-all shadow-xs disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                  {isLoading ? "Sending code..." : "Send Verification Code"}
                </button>
                <Link href={loginHref} className="flex items-center justify-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] transition-colors mt-2">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to {portalName ? `${portalName} Login` : "Login"}
                </Link>
              </form>
            )}

            {/* Step 2: OTP + New Password */}
            {step === "reset" && (
              <form onSubmit={handleResetPassword} aria-busy={isLoading} className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">Enter verification code</h2>
                  <p className="text-base text-[var(--muted)] mt-1">
                    We sent a 6-digit code to <span className="font-semibold text-[var(--ink)]">{email}</span>. Check your inbox and spam folder.
                  </p>
                </div>
                <div>
                  <label htmlFor="recovery-code" className="text-sm font-semibold text-[var(--muted)] mb-1.5 block uppercase tracking-wide">Verification Code</label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
                    <input
                      id="recovery-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-base text-[var(--ink)] focus:outline-none focus:border-[var(--ps-focus)] transition-colors tracking-[0.4em] font-mono text-center"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="new-password" className="text-sm font-semibold text-[var(--muted)] mb-1.5 block uppercase tracking-wide">New Password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
                    <input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New password"
                      aria-describedby="new-password-help"
                      autoComplete="new-password"
                      className="w-full pl-10 pr-10 py-3 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-base text-[var(--ink)] focus:outline-none focus:border-[var(--ps-focus)] transition-colors"
                    />
                    <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-controls="new-password confirm-new-password" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted2)] hover:text-[var(--ink)]">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p id="new-password-help" className="mt-2 text-sm leading-5 text-[var(--ps-text-secondary)]">10–128 characters, including letters and numbers.</p>
                </div>
                <div>
                  <label htmlFor="confirm-new-password" className="text-sm font-semibold text-[var(--muted)] mb-1.5 block uppercase tracking-wide">Confirm New Password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
                    <input
                      id="confirm-new-password"
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter new password"
                      autoComplete="new-password"
                      className={`w-full pl-10 pr-4 py-3 rounded-xl bg-[var(--surface2)] border text-base text-[var(--ink)] focus:outline-none transition-colors ${
                        confirmPassword && confirmPassword !== newPassword
                          ? "ps-auth-invalid border-[var(--ps-error)]"
                          : "border-[var(--border)] focus:border-[var(--ps-focus)]"
                      }`}
                    />
                  </div>
                  {confirmPassword && confirmPassword !== newPassword && (
                    <p className="text-sm text-[var(--ps-error)] mt-1">Passwords do not match.</p>
                  )}
                </div>
                {error && <p role="alert" className="ps-auth-alert text-sm text-[var(--ps-error)] font-semibold">{error}</p>}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 ps-auth-primary bg-[var(--ps-primary)] hover:bg-[var(--ps-primary-hover)] text-[var(--ps-text)] font-bold rounded-xl transition-all shadow-xs disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {isLoading ? "Resetting password..." : "Reset Password"}
                </button>
                <button type="button" onClick={() => { setStep("email"); setError(""); }} className="flex items-center justify-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] transition-colors w-full mt-1">
                  <ArrowLeft className="w-3.5 h-3.5" /> Use a different email
                </button>
              </form>
            )}

            {/* Step 3: Done */}
            {step === "done" && (
              <div className="text-center space-y-5">
                <div className="w-16 h-16 rounded-full bg-[var(--ps-success-soft)] flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-9 h-9 text-[var(--ps-success)]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">Password Reset!</h2>
                  <p className="text-base text-[var(--muted)] mt-1">Your password has been changed successfully. You can now log in with your new password.</p>
                </div>
                <Link
                  href={loginHref}
                  className="w-full inline-block py-3 ps-auth-primary bg-[var(--ps-primary)] hover:bg-[var(--ps-primary-hover)] text-[var(--ps-text)] font-bold rounded-xl transition-all shadow-xs text-center"
                >
                  Go to {portalName ? `${portalName} Login` : "Login"}
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="app-gradient-shell min-h-screen" aria-busy="true" />}>
      <ForgotPasswordContent />
    </Suspense>
  );
}
