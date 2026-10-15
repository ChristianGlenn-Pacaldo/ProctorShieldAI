"use client";

import { useState, useEffect, useRef } from "react";
import { CheckCircle2, XCircle, Lock } from "lucide-react";

import { PasswordVisibilityButton } from "@/components/password-visibility-button";
import { updateAccountPassword, type PasswordFeedback } from "@/lib/password-update";

export default function SettingsContent() {
  const [user, setUser] = useState<{ fullName: string; email: string } | null>(null);
  const [fullName, setFullName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Password change state
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
    fetch("/api/auth/session?scope=user&role=teacher")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setUser({ fullName: data.user.fullName, email: data.user.email });
          setFullName(data.user.fullName);
        }
      })
      .catch((err) => console.error("Failed to load session:", err));
  }, []);

  const initials = fullName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "TR";

  const handleSaveProfile = async () => {
    if (!fullName.trim()) {
      showToast("Full name cannot be empty.", "error");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/auth/profile?scope=user&role=teacher", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Profile updated successfully!", "success");
        setUser((prev) => prev ? { ...prev, fullName } : null);
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
      const feedback = await updateAccountPassword("teacher", { currentPassword, newPassword, confirmPassword });
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
    <div className="ps-teacher-settings ps-teacher-glass-canvas animate-fade-in space-y-4">
      {/* Toast */}
      {toast && (
        <div role="status" className={`fixed top-6 inset-x-4 sm:left-auto sm:right-6 sm:max-w-md z-[200] flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg border text-sm font-semibold animate-fade-in
          ${toast.type === "success" ? "bg-emerald-950/90 border-emerald-500/30 text-emerald-300" : "bg-rose-950/90 border-rose-500/30 text-rose-300"}`}>
          {toast.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
          <span className="min-w-0 break-words">{toast.msg}</span>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Profile Card */}
        <div className="ps-teacher-glass-card bg-[var(--surface)] rounded-xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">👤 Instructor Profile</h3>
          </div>
          <div className="p-6">
            <div className="flex flex-col items-center mb-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-3xl font-extrabold text-white mb-4">
                {initials}
              </div>
              <h3 className="text-base font-bold text-[var(--ink)]">{user?.fullName || "—"}</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="teacher-full-name" className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">Full Name</label>
                <input
                  id="teacher-full-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="ps-teacher-glass-dense w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div>
                <p id="teacher-email-label" className="text-xs font-semibold text-[var(--muted)] mb-1.5">Sign-in email</p>
                <p id="teacher-email" aria-labelledby="teacher-email-label" className="break-all text-sm text-[var(--ink)]">{user?.email || "—"}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">Email changes are not available here.</p>
              </div>
              <button
                disabled={isSaving}
                onClick={handleSaveProfile}
                className="w-full py-2.5 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-xs disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSaving && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {isSaving ? "Saving..." : "Save Profile"}
              </button>
            </div>
          </div>
        </div>

        {/* Password Change Card */}
        <div className="ps-teacher-glass-card bg-[var(--surface)] rounded-xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">🔒 Change Password</h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">Leave blank to keep your current password</p>
          </div>
          <div className="p-6 space-y-3">
            {/* Current Password */}
            <div>
              <label htmlFor="teacher-current-password" className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">Current Password</label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
                <input
                  id="teacher-current-password"
                  autoComplete="current-password"
                  disabled={isChangingPassword}
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="ps-teacher-glass-dense w-full pl-9 pr-14 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-blue-500 transition-colors"
                />
                <PasswordVisibilityButton inputId="teacher-current-password" visible={showCurrent} onToggle={() => setShowCurrent(!showCurrent)} label="current password" disabled={isChangingPassword} />
              </div>
            </div>
            {/* New Password */}
            <div>
              <label htmlFor="teacher-new-password" className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">New Password</label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
                <input
                  id="teacher-new-password"
                  autoComplete="new-password"
                  maxLength={128}
                  disabled={isChangingPassword}
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password"
                  aria-describedby="teacher-new-password-help"
                  className="ps-teacher-glass-dense w-full pl-9 pr-14 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-blue-500 transition-colors"
                />
                <PasswordVisibilityButton inputId="teacher-new-password" visible={showNew} onToggle={() => setShowNew(!showNew)} label="new password" disabled={isChangingPassword} />
              </div>
            </div>
            <p id="teacher-new-password-help" className="text-xs text-[var(--muted)]">At least 10 characters with letters and numbers. Maximum 128 characters.</p>
            {/* Confirm Password */}
            <div>
              <label htmlFor="teacher-confirm-password" className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">Confirm New Password</label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
                <input
                  type={showConfirm ? "text" : "password"}
                  id="teacher-confirm-password"
                  autoComplete="new-password"
                  maxLength={128}
                  disabled={isChangingPassword}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className={`ps-teacher-glass-dense w-full pl-9 pr-14 py-2.5 rounded-xl bg-[var(--surface2)] border text-sm text-[var(--ink)] focus:outline-none transition-colors ${
                    confirmPassword && confirmPassword !== newPassword
                      ? "border-rose-500 focus:border-rose-500"
                      : "border-[var(--border)] focus:border-blue-500"
                  }`}
                />
                <PasswordVisibilityButton inputId="teacher-confirm-password" visible={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} label="confirm password" disabled={isChangingPassword} />
              </div>
              {confirmPassword && confirmPassword !== newPassword && (
                <p className="text-xs text-rose-500 mt-1">Passwords do not match.</p>
              )}
            </div>
            {passwordMessage && (
              <p role={passwordMessage.type === "error" ? "alert" : "status"} aria-atomic="true"
                className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3 text-sm font-semibold text-[var(--ink)]">
                {passwordMessage.type === "success" ? "✓ " : "⚠ "}{passwordMessage.text}
              </p>
            )}
            <button
              disabled={isChangingPassword}
              aria-busy={isChangingPassword}
              onClick={handleChangePassword}
              className="w-full py-2.5 text-sm font-bold text-white bg-slate-700 hover:bg-slate-600 dark:bg-slate-600 dark:hover:bg-slate-500 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
            >
              {isChangingPassword && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {isChangingPassword ? "Updating..." : "Update Password"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
