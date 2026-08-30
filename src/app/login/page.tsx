"use client";

import Link from "next/link";
import { GraduationCap, Presentation, ArrowLeft } from "lucide-react";

export default function LoginPortalSelector() {
  return (
    <div className="min-h-screen bg-[var(--dark-bg)] text-white flex items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-950/30 via-slate-950 to-slate-900 pointer-events-none" />

      <div className="w-full max-w-4xl relative z-10">
        <div className="text-center mb-12 animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-3xl mx-auto mb-4 shadow-lg shadow-blue-900/20">
            🛡️
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold font-[family-name:var(--font-display)] tracking-tight text-slate-100">
            Proctor Shield <span className="text-blue-400">AI</span>
          </h1>
          <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
            Choose your dedicated portal to sign in or register your account
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {/* Student Card */}
          <Link
            href="/login/student"
            className="group flex flex-col justify-between p-8 rounded-2xl bg-slate-900/70 hover:bg-slate-900/90 border border-slate-800 hover:border-blue-500/40 transition-all duration-300 transform hover:-translate-y-1 shadow-xl text-left"
          >
            <div>
              <div className="w-14 h-14 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-6 group-hover:scale-105 transition-all duration-300">
                <GraduationCap className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-bold text-slate-100 mb-2 font-[family-name:var(--font-display)]">Student Portal</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Access your assigned quizzes, complete proctored sessions, and view your detailed AI integrity and performance reports.
              </p>
            </div>
            <div className="mt-8 flex items-center gap-2 text-sm font-semibold text-blue-400 group-hover:text-blue-300 transition-colors">
              Enter Student Portal &rarr;
            </div>
          </Link>

          {/* Teacher Card */}
          <Link
            href="/login/teacher"
            className="group flex flex-col justify-between p-8 rounded-2xl bg-slate-900/70 hover:bg-slate-900/90 border border-slate-800 hover:border-indigo-500/40 transition-all duration-300 transform hover:-translate-y-1 shadow-xl text-left"
          >
            <div>
              <div className="w-14 h-14 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-6 group-hover:scale-105 transition-all duration-300">
                <Presentation className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-bold text-slate-100 mb-2 font-[family-name:var(--font-display)]">Teacher Portal</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Create and manage assessments, run live proctoring monitoring feeds, review visual evidence logs, and grade student submissions.
              </p>
            </div>
            <div className="mt-8 flex items-center gap-2 text-sm font-semibold text-indigo-400 group-hover:text-indigo-300 transition-colors">
              Enter Teacher Portal &rarr;
            </div>
          </Link>
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Home Page
          </Link>
        </div>
      </div>
    </div>
  );
}
