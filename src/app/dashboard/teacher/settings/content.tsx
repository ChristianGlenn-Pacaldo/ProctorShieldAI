"use client";

import { useState, useEffect, useRef } from "react";
import { CheckCircle2, XCircle, Eye, EyeOff, Lock } from "lucide-react";

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
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    fetch("/api/auth/session")
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
      const res = await fetch("/api/auth/profile", {
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
    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast("All password fields are required.", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("New passwords do not match.", "error");
      return;
    }
    if (newPassword.length < 6) {
      showToast("New password must be at least 6 characters.", "error");
      return;
    }
    setIsChangingPassword(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Password changed successfully!", "success");
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
    <div className="animate-fade-in space-y-4">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-[200] flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg border text-sm font-semibold animate-fade-in
          ${toast.type === "success" ? "bg-emerald-950/90 border-emerald-500/30 text-emerald-300" : "bg-rose-950/90 border-rose-500/30 text-rose-300"}`}>
          {toast.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Profile Card */}
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">👤 Instructor Profile</h3>
          </div>
          <div className="p-6">
            <div className="flex flex-col items-center mb-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-3xl font-extrabold text-white mb-4">
                {initials}
              </div>
              <h3 className="text-base font-bold text-[var(--ink)]">{user?.fullName || "—"}</h3>
              <p className="text-xs text-[var(--muted)] mt-0.5">{user?.email}</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">Full Name</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">Email Address</label>
                <input
                  value={user?.email || ""}
                  disabled
                  className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--muted)] cursor-not-allowed"
                />
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
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">🔒 Change Password</h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">Leave blank to keep your current password</p>
          </div>
          <div className="p-6 space-y-3">
            {/* Current Password */}
            <div>
              <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">Current Password</label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
                <input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-blue-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted2)] hover:text-[var(--ink)]"
                >
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {/* New Password */}
            <div>
              <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">New Password</label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
                <input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-blue-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted2)] hover:text-[var(--ink)]"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {/* Confirm Password */}
            <div>
              <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">Confirm New Password</label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className={`w-full pl-9 pr-4 py-2.5 rounded-xl bg-[var(--surface2)] border text-sm text-[var(--ink)] focus:outline-none transition-colors ${
                    confirmPassword && confirmPassword !== newPassword
                      ? "border-rose-500 focus:border-rose-500"
                      : "border-[var(--border)] focus:border-blue-500"
                  }`}
                />
              </div>
              {confirmPassword && confirmPassword !== newPassword && (
                <p className="text-xs text-rose-500 mt-1">Passwords do not match.</p>
              )}
            </div>
            <button
              disabled={isChangingPassword}
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
