"use client";

import { useState, useEffect } from "react";

export default function SettingsContent() {
  const [darkMode, setDarkMode] = useState(false);
  const [emailNotif, setEmailNotif] = useState(true);
  const [user, setUser] = useState<{ fullName: string; email: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setUser({
            fullName: data.user.fullName,
            email: data.user.email,
          });
        }
      })
      .catch((err) => console.error("Failed to load session:", err));
  }, []);

  const name = user?.fullName || "Student User";
  const email = user?.email || "";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="animate-fade-in grid lg:grid-cols-2 gap-4">
      {/* Profile Card */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">👤 User Profile</h3>
        </div>
        <div className="p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-3xl font-extrabold text-white mx-auto mb-4">
            {initials || "SD"}
          </div>
          <h3 className="text-lg font-bold text-[var(--ink)] mb-1">{name}</h3>
          <p className="text-sm text-[var(--muted)] mb-6">Computer Science Student</p>
          <button className="w-full py-2.5 text-sm font-semibold text-[var(--muted)] border border-[var(--border)] rounded-xl hover:bg-[var(--surface2)] transition-all">
            Update Avatar
          </button>
        </div>
      </div>

      {/* Settings Form */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">⚙️ Profile Settings</h3>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">Full Name</label>
            <input key={name} defaultValue={name} className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-indigo-500/50" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">Email Address</label>
            <input key={email} defaultValue={email} disabled className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--muted)] cursor-not-allowed" />
          </div>
          <div className="pt-3 border-t border-[var(--border)] space-y-0">
            <div className="flex items-center justify-between py-3 border-b border-[var(--border)]">
              <div>
                <div className="text-sm font-medium text-[var(--ink)]">Dark Mode</div>
                <div className="text-xs text-[var(--muted)]">Enable dark theme for the dashboard</div>
              </div>
              <button onClick={() => setDarkMode(!darkMode)} className={`w-10 h-6 rounded-full transition-all ${darkMode ? "bg-indigo-600" : "bg-[var(--muted2)]"}`}>
                <span className={`block w-4 h-4 bg-white rounded-full transition-transform mx-1 ${darkMode ? "translate-x-4" : ""}`} />
              </button>
            </div>
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-medium text-[var(--ink)]">Email Notifications</div>
                <div className="text-xs text-[var(--muted)]">Receive exam reminders via email</div>
              </div>
              <button onClick={() => setEmailNotif(!emailNotif)} className={`w-10 h-6 rounded-full transition-all ${emailNotif ? "bg-indigo-600" : "bg-[var(--muted2)]"}`}>
                <span className={`block w-4 h-4 bg-white rounded-full transition-transform mx-1 ${emailNotif ? "translate-x-4" : ""}`} />
              </button>
            </div>
          </div>
          <button className="w-full py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/20 mt-2">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
