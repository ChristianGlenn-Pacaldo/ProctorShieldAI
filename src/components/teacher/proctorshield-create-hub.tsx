"use client";

import { useState, useEffect } from "react";
import {
  ClipboardCheck,
  Swords,
  Sparkles,
  Upload,
  Plus,
  Crown,
  Lock,
} from "lucide-react";

export interface ProctorShieldCreateHubProps {
  teacherName?: string;
  isSubscribed?: boolean;
  onOpenCreateQuiz: () => void;
  onOpenAiGenerator?: () => void;
  onOpenArena?: () => void;
  onRequirePro?: (reason: "ai" | "arena") => void;
}

export default function ProctorShieldCreateHub({
  teacherName = "Teacher",
  isSubscribed = false,
  onOpenCreateQuiz,
  onOpenAiGenerator,
  onOpenArena,
  onRequirePro,
}: ProctorShieldCreateHubProps) {
  const [activeTab, setActiveTab] = useState<"create" | "upload">("create");
  const [timeGreeting, setTimeGreeting] = useState("Good afternoon");

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setTimeGreeting("Good morning");
    else if (hour < 18) setTimeGreeting("Good afternoon");
    else setTimeGreeting("Good evening");
  }, []);

  const cleanName = teacherName.split(" ")[0] || "Teacher";

  const handleArenaClick = () => {
    if (!isSubscribed) {
      if (onRequirePro) onRequirePro("arena");
      return;
    }
    if (onOpenArena) onOpenArena();
  };

  const handleAiClick = () => {
    if (!isSubscribed) {
      if (onRequirePro) onRequirePro("ai");
      return;
    }
    if (onOpenAiGenerator) onOpenAiGenerator();
  };

  return (
    <div className="space-y-6">
      {/* ProctorShield Top Greeting & Mode Selector */}
      <div className="text-center space-y-4 pt-2">
        <h2 className="text-xl sm:text-2xl font-black text-[var(--ink)] font-[family-name:var(--font-display)] tracking-tight">
          {timeGreeting}, <span className="text-indigo-600 dark:text-indigo-400">{cleanName}</span>, 👋 Let&apos;s get started.
        </h2>

        {/* Tab Pills (Create, Upload) */}
        <div className="inline-flex items-center p-1.5 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-xs">
          <button
            type="button"
            onClick={() => {
              setActiveTab("create");
              onOpenCreateQuiz();
            }}
            className={`inline-flex items-center gap-2 px-4 sm:px-6 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeTab === "create"
                ? "bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md shadow-pink-500/25"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>Create</span>
            <span className="hidden sm:inline text-[10px] opacity-80 font-normal">a resource</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!isSubscribed) {
                if (onRequirePro) onRequirePro("ai");
                return;
              }
              setActiveTab("upload");
              if (onOpenAiGenerator) onOpenAiGenerator();
            }}
            className={`inline-flex items-center gap-2 px-4 sm:px-6 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeTab === "upload"
                ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md shadow-purple-500/25"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Upload</span>
            <span className="hidden sm:inline text-[10px] opacity-80 font-normal">&amp; enhance AI</span>
            {!isSubscribed && <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
          </button>
        </div>
      </div>

      {/* Activity Creation Cards Grid (3 Cards: Assessment, Proctor Arena [PRO], AI Generator [PRO]) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 max-w-4xl mx-auto">
        {/* 1. Assessment (Quiz) - Primary */}
        <button
          type="button"
          onClick={onOpenCreateQuiz}
          className="group p-5 sm:p-6 rounded-2xl bg-[var(--surface)] hover:bg-[var(--surface2)] border-2 border-emerald-500/30 hover:border-emerald-500 shadow-xs hover:shadow-xl hover:shadow-emerald-500/10 transition-all flex flex-col items-center text-center space-y-3.5 cursor-pointer"
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center text-2xl shadow-lg shadow-emerald-500/20 group-hover:scale-110 transition-transform">
            <ClipboardCheck className="w-8 h-8" />
          </div>
          <div>
            <div className="text-base font-bold text-[var(--ink)] group-hover:text-emerald-500 transition-colors">
              Assessment
            </div>
            <div className="text-xs text-[var(--muted)] mt-1 leading-snug">
              Quick &amp; interactive questions
            </div>
          </div>
        </button>

        {/* 2. Proctor Arena (Multiplayer) - PRO MODE ONLY */}
        <button
          type="button"
          onClick={handleArenaClick}
          className={`group p-5 sm:p-6 rounded-2xl bg-[var(--surface)] hover:bg-[var(--surface2)] border-2 transition-all flex flex-col items-center text-center space-y-3.5 cursor-pointer relative ${
            isSubscribed
              ? "border-amber-500/40 hover:border-amber-500 hover:shadow-xl hover:shadow-amber-500/10"
              : "border-amber-500/30 hover:border-amber-400 hover:shadow-lg"
          }`}
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-yellow-500 text-slate-950 flex items-center justify-center text-2xl shadow-lg shadow-amber-500/20 group-hover:scale-110 transition-transform relative">
            <Swords className="w-8 h-8" />
            {!isSubscribed && (
              <div className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-slate-950 border border-amber-400 flex items-center justify-center shadow-md">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
              </div>
            )}
          </div>
          <div>
            <div className="text-base font-bold text-[var(--ink)] group-hover:text-amber-500 transition-colors flex items-center justify-center gap-1.5">
              <span>Proctor Arena</span>
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/40 text-amber-400 font-extrabold uppercase tracking-wide">
                <Crown className="w-3 h-3 text-amber-400" />
                PRO
              </span>
            </div>
            <div className="text-xs text-[var(--muted)] mt-1 leading-snug">
              {isSubscribed ? "Live battle royale with powers & shields" : "Pro Exclusive • Live battle royale"}
            </div>
          </div>
        </button>

        {/* 3. AI Generator - PRO MODE ONLY */}
        <button
          type="button"
          onClick={handleAiClick}
          className={`group p-5 sm:p-6 rounded-2xl bg-[var(--surface)] hover:bg-[var(--surface2)] border-2 transition-all flex flex-col items-center text-center space-y-3.5 cursor-pointer relative ${
            isSubscribed
              ? "border-purple-500/40 hover:border-purple-500 hover:shadow-xl hover:shadow-purple-500/10"
              : "border-purple-500/30 hover:border-purple-400 hover:shadow-lg"
          }`}
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 via-violet-600 to-indigo-600 text-white flex items-center justify-center text-2xl shadow-lg shadow-purple-500/20 group-hover:scale-110 transition-transform relative">
            <Sparkles className="w-8 h-8" />
            {!isSubscribed && (
              <div className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-slate-950 border border-purple-400 flex items-center justify-center shadow-md">
                <Lock className="w-3.5 h-3.5 text-purple-400" />
              </div>
            )}
          </div>
          <div>
            <div className="text-base font-bold text-[var(--ink)] group-hover:text-purple-500 transition-colors flex items-center justify-center gap-1.5">
              <span>AI Generator</span>
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-400/20 border border-purple-400/40 text-purple-400 font-extrabold uppercase tracking-wide">
                <Crown className="w-3 h-3 text-purple-400" />
                PRO
              </span>
            </div>
            <div className="text-xs text-[var(--muted)] mt-1 leading-snug">
              {isSubscribed ? "Scan notes, webcam, or exams" : "Pro Exclusive • Auto-generate exams"}
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
