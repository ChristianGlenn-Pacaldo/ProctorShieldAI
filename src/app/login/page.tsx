"use client";

import Link from "next/link";
import { GraduationCap, Presentation, ArrowLeft } from "lucide-react";

export default function LoginPortalSelector() {
  return (
    <div className="min-h-screen bg-[var(--dark-bg)] text-white flex items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/10 via-transparent to-violet-600/10 pointer-events-none" />

      <div className="w-full max-w-4xl relative z-10">
        <div className="text-center mb-12 animate-fade-in">
          <div className="text-6xl mb-4">🛡️</div>
          <h1 className="text-3xl md:text-4xl font-extrabold font-[family-name:var(--font-display)] tracking-tight">
            Proctor Shield <span className="text-indigo-400">AI</span>
          </h1>
          <p className="text-sm text-white/40 mt-2 max-w-md mx-auto">
            Choose your dedicated access portal to continue signing in or creating an account
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {/* Student Card */}
          <Link
            href="/login/student"
            className="group flex flex-col justify-between p-8 rounded-2xl bg-white/[0.025] hover:bg-white/[0.04] border border-white/[0.06] hover:border-indigo-500/30 transition-all duration-300 transform hover:-translate-y-1 shadow-xl hover:shadow-indigo-500/5 text-left"
          >
            <div>
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-6 group-hover:scale-110 transition-all duration-300">
                <GraduationCap className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Student Portal</h2>
              <p className="text-sm text-white/35 leading-relaxed">
                Access your assigned exams, complete proctored sessions, and view your detailed AI integrity and performance reports.
              </p>
            </div>
            <div className="mt-8 flex items-center gap-2 text-sm font-semibold text-indigo-400 group-hover:text-indigo-300 transition-colors">
              Enter Student Portal &rarr;
            </div>
          </Link>

          {/* Teacher Card */}
          <Link
            href="/login/teacher"
            className="group flex flex-col justify-between p-8 rounded-2xl bg-white/[0.025] hover:bg-white/[0.04] border border-white/[0.06] hover:border-violet-500/30 transition-all duration-300 transform hover:-translate-y-1 shadow-xl hover:shadow-violet-500/5 text-left"
          >
            <div>
              <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 mb-6 group-hover:scale-110 transition-all duration-300">
                <Presentation className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Teacher Portal</h2>
              <p className="text-sm text-white/35 leading-relaxed">
                Create and manage assessments, run live proctoring monitoring feeds, review visual evidence logs, and grade student submissions.
              </p>
            </div>
            <div className="mt-8 flex items-center gap-2 text-sm font-semibold text-violet-400 group-hover:text-violet-300 transition-colors">
              Enter Teacher Portal &rarr;
            </div>
          </Link>
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/50 transition-colors font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Home Page
          </Link>
        </div>
      </div>
    </div>
  );
}
