"use client";

import { useState } from "react";

export default function SettingsContent() {
  const [darkMode, setDarkMode] = useState(false);
  const [strictAI, setStrictAI] = useState(true);

  return (
    <div className="animate-fade-in grid lg:grid-cols-2 gap-4">
      {/* Profile Card */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">👤 Instructor Profile</h3>
        </div>
        <div className="p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-3xl font-extrabold text-white mx-auto mb-4">
            SR
          </div>
          <h3 className="text-lg font-bold text-[var(--ink)] mb-1">Sir Ramos</h3>
          <p className="text-sm text-[var(--muted)] mb-6">Computer Science Department</p>
          <button className="w-full py-2.5 text-sm font-semibold text-[var(--muted)] border border-[var(--border)] rounded-xl hover:bg-[var(--surface2)] transition-all">
            Update Avatar
          </button>
        </div>
      </div>

      {/* Settings Form */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">⚙️ Instructor Settings</h3>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">Full Name</label>
            <input defaultValue="Sir Ramos" className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-indigo-500/50" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">Email Address</label>
            <input defaultValue="teacher@demo.com" disabled className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--muted)] cursor-not-allowed" />
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
                <div className="text-sm font-medium text-[var(--ink)]">Strict AI Mode</div>
                <div className="text-xs text-[var(--muted)]">Increase sensitivity for cheating detection</div>
              </div>
              <button onClick={() => setStrictAI(!strictAI)} className={`w-10 h-6 rounded-full transition-all ${strictAI ? "bg-indigo-600" : "bg-[var(--muted2)]"}`}>
                <span className={`block w-4 h-4 bg-white rounded-full transition-transform mx-1 ${strictAI ? "translate-x-4" : ""}`} />
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
