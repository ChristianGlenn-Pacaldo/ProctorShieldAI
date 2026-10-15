"use client";

import { useEffect, useState, useRef } from "react";
import { CheckCircle2, Lock, Shield, XCircle } from "lucide-react";

import { PasswordVisibilityButton } from "@/components/password-visibility-button";
import { updateAccountPassword, type PasswordFeedback } from "@/lib/password-update";

export default function SettingsContent() {
  const [user, setUser] = useState<{ fullName: string; email: string } | null>(null);
  const [fullName, setFullName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const passwordBusyRef = useRef(false);
  const [passwordMessage, setPasswordMessage] = useState<PasswordFeedback | null>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    fetch("/api/auth/session?scope=user&role=student")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setUser({ fullName: data.user.fullName, email: data.user.email });
          setFullName(data.user.fullName);
        }
      })
      .catch((error) => console.error("Failed to load session:", error));
  }, []);

  const handleSaveProfile = async () => {
    if (!fullName.trim()) {
      showToast("Full name cannot be empty.", "error");
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch("/api/auth/profile?scope=user&role=student", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName }),
      });
      const data = await response.json();
      if (data.success) {
        showToast("Profile updated successfully!");
        setUser((previous) => (previous ? { ...previous, fullName } : null));
      } else {
        showToast(data.message || "Failed to save profile.", "error");
      }
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordBusyRef.current) return;
    passwordBusyRef.current = true;
    setIsChangingPassword(true);
    setPasswordMessage(null);
    try {
      const feedback = await updateAccountPassword("student", { currentPassword, newPassword, confirmPassword });
      setPasswordMessage(feedback);
      if (feedback.type === "success") {
        setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
        setShowCurrent(false); setShowNew(false); setShowConfirm(false);
      }
    } finally {
      passwordBusyRef.current = false;
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="ps-student-page min-w-0 animate-fade-in space-y-6 pb-16">
      {toast && (
        <div
          role={toast.type === "error" ? "alert" : "status"}
          className={`fixed top-6 inset-x-4 sm:left-auto sm:right-6 sm:max-w-md z-[200] flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border bg-[var(--surface)] text-sm font-bold animate-fade-in ${
            toast.type === "success"
              ? " border-[var(--ps-border)] text-[var(--ps-success)] [.dark_&]:text-[var(--ps-success)]"
              : " border-[var(--ps-border)] text-[var(--ps-error)] [.dark_&]:text-[var(--ps-error)]"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 shrink-0" />
          )}
          <span className="min-w-0 break-words">{toast.msg}</span>
        </div>
      )}

      {/* Match the shell's selected .dark class without changing shared variants. */}
      <div className="ps-student-hero relative overflow-hidden rounded-3xl border p-6 sm:p-8 text-[var(--ink)]">
        <div className="relative z-10">
          <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-[var(--ink)] font-[family-name:var(--font-display)]">
            Account Settings
          </h1>
          <p className="text-xs sm:text-sm text-[var(--ink2)] mt-1 max-w-xl">
            Keep your student information and account security up to date.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 pt-4">
        <div className="ps-student-card bg-[var(--surface)] rounded-3xl border border-[var(--border)] p-6 shadow-sm">
          <div className="px-1 pb-4 border-b border-[var(--border)] mb-5 flex items-center gap-2">
            <Shield className="w-5 h-5 text-[var(--ps-accent)] " />
            <h3 className="text-base font-extrabold text-[var(--ink)] font-[family-name:var(--font-display)]">
              Student Information
            </h3>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="student-full-name" className="text-xs font-bold text-[var(--muted)] mb-1.5 block uppercase tracking-wider">
                Full Name
              </label>
              <input
                id="student-full-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--ps-accent)] font-semibold transition-colors"
              />
            </div>

            <div>
              <p id="student-email-label" className="text-xs font-semibold text-[var(--muted)] mb-1.5">Sign-in email</p>
              <p id="student-email" aria-labelledby="student-email-label" className="break-all text-sm text-[var(--ink)]">{user?.email || "—"}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">Email changes are not available here.</p>
            </div>

            <button
              type="button"
              disabled={isSaving}
              onClick={handleSaveProfile}
              className="w-full py-3 text-sm font-bold text-[var(--ps-on-primary)] bg-[var(--ps-primary)] hover:bg-[var(--ps-primary-hover)] rounded-xl transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSaving && <span className="w-4 h-4 border-2 border-[var(--ps-on-primary)]/30 border-t-[var(--ps-on-primary)] rounded-full animate-spin" />}
              {isSaving ? "Saving..." : "Save Profile Details"}
            </button>
          </div>
        </div>

        <div className="ps-student-card bg-[var(--surface)] rounded-3xl border border-[var(--border)] p-6 shadow-sm">
          <div className="px-1 pb-4 border-b border-[var(--border)] mb-5 flex flex-wrap gap-2 items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 shrink-0 text-[var(--ps-accent)] " />
              <h3 className="text-base font-extrabold text-[var(--ink)] font-[family-name:var(--font-display)]">
                Security & Password
              </h3>
            </div>
            <span className="text-[11px] text-[var(--muted)]">Optional</span>
          </div>

          <div className="space-y-3.5">
            <div>
              <label htmlFor="student-current-password" className="text-xs font-bold text-[var(--muted)] mb-1.5 block uppercase tracking-wider">
                Current Password
              </label>
              <div className="relative">
                <input
                  id="student-current-password"
                  autoComplete="current-password"
                  disabled={isChangingPassword}
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="Enter current password"
                  className="w-full pl-4 pr-14 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:outline-none focus:border-[var(--ps-accent)] transition-colors"
                />
                <PasswordVisibilityButton inputId="student-current-password" visible={showCurrent} onToggle={() => setShowCurrent(!showCurrent)} label="current password" disabled={isChangingPassword} />
              </div>
            </div>

            <div>
              <label htmlFor="student-new-password" className="text-xs font-bold text-[var(--muted)] mb-1.5 block uppercase tracking-wider">
                New Password
              </label>
              <div className="relative">
                <input
                  id="student-new-password"
                  autoComplete="new-password"
                  maxLength={128}
                  disabled={isChangingPassword}
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="New password"
                  aria-describedby="student-new-password-help"
                  className="w-full pl-4 pr-14 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:outline-none focus:border-[var(--ps-accent)] transition-colors"
                />
                <PasswordVisibilityButton inputId="student-new-password" visible={showNew} onToggle={() => setShowNew(!showNew)} label="new password" disabled={isChangingPassword} />
              </div>
              <p id="student-new-password-help" className="mt-2 text-sm leading-5 text-[var(--ps-text-secondary)]">At least 10 characters with letters and numbers. Maximum 128 characters.</p>
            </div>

            <div>
              <label htmlFor="student-confirm-password" className="text-xs font-bold text-[var(--muted)] mb-1.5 block uppercase tracking-wider">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id="student-confirm-password"
                  autoComplete="new-password"
                  maxLength={128}
                  disabled={isChangingPassword}
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Re-type new password"
                  className="w-full pl-4 pr-14 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:outline-none focus:border-[var(--ps-accent)] transition-colors"
                />
                <PasswordVisibilityButton inputId="student-confirm-password" visible={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} label="confirm password" disabled={isChangingPassword} />
              </div>
            </div>

            {passwordMessage && (
              <p role={passwordMessage.type === "error" ? "alert" : "status"} aria-atomic="true"
                className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3 text-sm font-semibold text-[var(--ink)]">
                {passwordMessage.type === "success" ? "✓ " : "⚠ "}{passwordMessage.text}
              </p>
            )}
            <button
              type="button"
              disabled={isChangingPassword || !newPassword}
              aria-busy={isChangingPassword}
              onClick={handleChangePassword}
              className="ps-student-secondary w-full py-3 text-sm font-bold text-[var(--ps-text)] bg-[var(--ps-surface-inset)] hover:bg-[var(--ps-surface-inset)]   rounded-xl transition-all disabled:opacity-40 flex items-center justify-center gap-2 mt-2 cursor-pointer"
            >
              {isChangingPassword && <span className="w-4 h-4 border-2 border-[var(--ps-on-primary)]/30 border-t-[var(--ps-on-primary)] rounded-full animate-spin" />}
              {isChangingPassword ? "Updating..." : "Update Password"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
