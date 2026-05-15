"use client";

import { useState } from "react";

export default function SettingsContent() {
  const [instructorReg, setInstructorReg] = useState(true);
  const [strictEnforce, setStrictEnforce] = useState(false);

  return (
    <div className="animate-fade-in grid lg:grid-cols-2 gap-4">
      {/* Admin Profile */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">👤 Admin Profile</h3>
        </div>
        <div className="p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center text-3xl font-extrabold text-white mx-auto mb-4">
            AD
          </div>
          <h3 className="text-lg font-bold text-[var(--ink)] mb-1">System Admin</h3>
          <p className="text-sm text-[var(--muted)] mb-6">ProctorShield Administration</p>
          <button className="w-full py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/20">
            Save Changes
          </button>
        </div>
      </div>

      {/* Global Settings */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">⚙️ Global Settings</h3>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">System Name</label>
            <input defaultValue="Proctor Shield AI" className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-indigo-500/50" />
          </div>
          <div className="pt-3 border-t border-[var(--border)]">
            <label className="text-xs font-semibold text-[var(--muted)] mb-3 block">Platform Policies</label>
            <div className="flex items-center justify-between py-3 border-b border-[var(--border)]">
              <div>
                <div className="text-sm font-medium text-[var(--ink)]">Allow Instructor Registration</div>
                <div className="text-xs text-[var(--muted)]">Teachers can create their own accounts</div>
              </div>
              <button onClick={() => setInstructorReg(!instructorReg)} className={`w-10 h-6 rounded-full transition-all ${instructorReg ? "bg-indigo-600" : "bg-[var(--muted2)]"}`}>
                <span className={`block w-4 h-4 bg-white rounded-full transition-transform mx-1 ${instructorReg ? "translate-x-4" : ""}`} />
              </button>
            </div>
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-medium text-[var(--ink)]">Strict AI Enforcements</div>
                <div className="text-xs text-[var(--muted)]">Force lock exams on high severity violations</div>
              </div>
              <button onClick={() => setStrictEnforce(!strictEnforce)} className={`w-10 h-6 rounded-full transition-all ${strictEnforce ? "bg-indigo-600" : "bg-[var(--muted2)]"}`}>
                <span className={`block w-4 h-4 bg-white rounded-full transition-transform mx-1 ${strictEnforce ? "translate-x-4" : ""}`} />
              </button>
            </div>
          </div>
          <button className="w-full py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/20 mt-2">
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
