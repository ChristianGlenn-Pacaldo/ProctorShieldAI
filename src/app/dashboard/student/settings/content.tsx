"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Lock, Shield, XCircle } from "lucide-react";

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
  const [isChangingPassword, setIsChangingPassword] = useState(false);

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
    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast("All password fields are required.", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("New passwords do not match.", "error");
      return;
    }
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      showToast("New password must be at least 10 characters and contain letters and numbers.", "error");
      return;
    }
    setIsChangingPassword(true);
    try {
      const response = await fetch("/api/auth/profile?scope=user&role=student", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (data.success) {
        showToast("Password changed successfully!");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        showToast(data.message || "Failed to change password.", "error");
      }
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
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
              <label htmlFor="student-email" className="text-xs font-bold text-[var(--muted)] mb-1.5 block uppercase tracking-wider">
                Email Address
              </label>
              <input
                id="student-email"
                value={user?.email || ""}
                disabled
                className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--muted)] cursor-not-allowed font-medium"
              />
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
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="Enter current password"
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:outline-none focus:border-[var(--ps-accent)] transition-colors"
                />
                <button type="button" aria-label={showCurrent ? "Hide current password" : "Show current password"} onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink3)] hover:text-[var(--ink)]">
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="student-new-password" className="text-xs font-bold text-[var(--muted)] mb-1.5 block uppercase tracking-wider">
                New Password
              </label>
              <div className="relative">
                <input
                  id="student-new-password"
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="New password"
                  aria-describedby="student-new-password-help"
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:outline-none focus:border-[var(--ps-accent)] transition-colors"
                />
                <button type="button" aria-label={showNew ? "Hide new password" : "Show new password"} onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink3)] hover:text-[var(--ink)]">
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p id="student-new-password-help" className="mt-2 text-sm leading-5 text-[var(--ps-text-secondary)]">10–128 characters, including letters and numbers.</p>
            </div>

            <div>
              <label htmlFor="student-confirm-password" className="text-xs font-bold text-[var(--muted)] mb-1.5 block uppercase tracking-wider">
                Confirm Password
              </label>
              <input
                id="student-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-type new password"
                className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:outline-none focus:border-[var(--ps-accent)] transition-colors"
              />
            </div>

            <button
              type="button"
              disabled={isChangingPassword || !newPassword}
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
