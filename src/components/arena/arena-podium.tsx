"use client";

import React from "react";
import Link from "next/link";
import { Crown, Trophy, Medal, ArrowRight, Sparkles, Coins, Flame, Award } from "lucide-react";

export interface PodiumParticipant {
  studentId: string;
  studentName: string;
  avatar: string;
  score: number;
  rank: number;
  coinsEarned?: number;
  streak?: number;
}

interface ArenaPodiumProps {
  quizTitle: string;
  subjectName?: string;
  podium: PodiumParticipant[];
  allParticipants: PodiumParticipant[];
  currentStudentId: string;
  studentScore: number;
  studentRank: number;
  studentCoins: number;
  highestStreak: number;
  onExit?: () => void;
}

export function ArenaPodium({
  quizTitle,
  subjectName,
  podium,
  allParticipants,
  currentStudentId,
  studentScore,
  studentRank,
  studentCoins,
  highestStreak,
  onExit,
}: ArenaPodiumProps) {
  const firstPlace = podium.find((p) => p.rank === 1);
  const secondPlace = podium.find((p) => p.rank === 2);
  const thirdPlace = podium.find((p) => p.rank === 3);

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 flex flex-col items-center">
      {/* Header Banner */}
      <div className="text-center mb-8 animate-fade-in">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-black uppercase tracking-wider mb-3">
          <Sparkles className="w-4 h-4" />
          <span>Match Concluded — Live Arena Podium</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-rose-400 to-indigo-400 tracking-tight">
          Champions of the Arena
        </h1>
        <p className="text-sm text-slate-400 mt-2 font-medium">
          {quizTitle} {subjectName ? `• ${subjectName}` : ""}
        </p>
      </div>

      {/* 3D-Style Winner Podium */}
      <div className="w-full max-w-2xl grid grid-cols-3 items-end gap-3 sm:gap-6 mb-12 pt-12">
        {/* 2nd Place (Silver) */}
        <div className="flex flex-col items-center order-1">
          {secondPlace ? (
            <div className="flex flex-col items-center animate-fade-in">
              <div className="relative mb-2">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-slate-300 to-slate-500 p-0.5 shadow-[0_0_25px_rgba(203,213,225,0.4)]">
                  <div className="w-full h-full bg-[#0d1222] rounded-2xl flex items-center justify-center text-3xl sm:text-4xl">
                    {secondPlace.avatar || "🥈"}
                  </div>
                </div>
                <div className="absolute -top-3 -right-2 w-7 h-7 rounded-full bg-slate-300 text-slate-900 flex items-center justify-center font-black text-xs shadow-md">
                  2
                </div>
              </div>
              <div className="text-center font-black text-white text-xs sm:text-sm truncate max-w-[100px] sm:max-w-[130px]">
                {secondPlace.studentName}
              </div>
              <div className="text-xs font-mono font-bold text-slate-400">
                {secondPlace.score} pts
              </div>
            </div>
          ) : (
            <div className="h-24 flex items-center text-xs text-slate-600 font-bold">Unclaimed</div>
          )}
          <div className="w-full h-24 sm:h-32 mt-3 rounded-t-2xl bg-gradient-to-t from-slate-800 to-slate-700/80 border-t-2 border-x-2 border-slate-400/50 flex flex-col items-center justify-center shadow-lg">
            <Medal className="w-6 h-6 text-slate-300 mb-1" />
            <span className="text-sm sm:text-base font-black text-slate-300">2ND</span>
          </div>
        </div>

        {/* 1st Place (Gold Crown) */}
        <div className="flex flex-col items-center order-2">
          {firstPlace ? (
            <div className="flex flex-col items-center animate-fade-in relative">
              <div className="absolute -top-8 text-amber-400 animate-bounce">
                <Crown className="w-8 h-8 drop-shadow-[0_0_12px_rgba(251,191,36,0.8)]" />
              </div>
              <div className="relative mb-2">
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-amber-300 via-yellow-500 to-amber-600 p-1 shadow-[0_0_35px_rgba(245,158,11,0.6)]">
                  <div className="w-full h-full bg-[#0d1222] rounded-2xl flex items-center justify-center text-4xl sm:text-5xl">
                    {firstPlace.avatar || "👑"}
                  </div>
                </div>
                <div className="absolute -top-3 -right-2 w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 to-amber-500 text-amber-950 flex items-center justify-center font-black text-sm shadow-md">
                  1
                </div>
              </div>
              <div className="text-center font-black text-amber-200 text-sm sm:text-base truncate max-w-[120px] sm:max-w-[150px]">
                {firstPlace.studentName}
              </div>
              <div className="text-xs sm:text-sm font-mono font-black text-amber-400">
                {firstPlace.score} pts
              </div>
            </div>
          ) : (
            <div className="h-32 flex items-center text-xs text-slate-600 font-bold">Unclaimed</div>
          )}
          <div className="w-full h-32 sm:h-44 mt-3 rounded-t-2xl bg-gradient-to-t from-amber-950/80 to-amber-600/60 border-t-2 border-x-2 border-amber-400 flex flex-col items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.2)]">
            <Trophy className="w-8 h-8 text-amber-300 mb-1" />
            <span className="text-base sm:text-xl font-black text-amber-200">1ST</span>
          </div>
        </div>

        {/* 3rd Place (Bronze) */}
        <div className="flex flex-col items-center order-3">
          {thirdPlace ? (
            <div className="flex flex-col items-center animate-fade-in">
              <div className="relative mb-2">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-amber-700 to-amber-900 p-0.5 shadow-[0_0_25px_rgba(180,83,9,0.3)]">
                  <div className="w-full h-full bg-[#0d1222] rounded-2xl flex items-center justify-center text-3xl sm:text-4xl">
                    {thirdPlace.avatar || "🥉"}
                  </div>
                </div>
                <div className="absolute -top-3 -right-2 w-7 h-7 rounded-full bg-amber-700 text-amber-100 flex items-center justify-center font-black text-xs shadow-md">
                  3
                </div>
              </div>
              <div className="text-center font-black text-white text-xs sm:text-sm truncate max-w-[100px] sm:max-w-[130px]">
                {thirdPlace.studentName}
              </div>
              <div className="text-xs font-mono font-bold text-slate-400">
                {thirdPlace.score} pts
              </div>
            </div>
          ) : (
            <div className="h-20 flex items-center text-xs text-slate-600 font-bold">Unclaimed</div>
          )}
          <div className="w-full h-18 sm:h-24 mt-3 rounded-t-2xl bg-gradient-to-t from-amber-950 to-amber-900/80 border-t-2 border-x-2 border-amber-600/50 flex flex-col items-center justify-center shadow-lg">
            <Medal className="w-5 h-5 text-amber-500 mb-1" />
            <span className="text-sm sm:text-base font-black text-amber-400">3RD</span>
          </div>
        </div>
      </div>

      {/* Student Personal Match Recap */}
      <div className="w-full max-w-xl bg-gradient-to-br from-[#12182b] to-[#0d1222] border border-indigo-500/30 rounded-3xl p-6 shadow-2xl mb-8">
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 font-black">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Your Match Results</h3>
              <p className="text-xs text-slate-400">Power Arena Battle Station</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs font-bold text-slate-400">Rank</span>
            <div className="text-xl font-black text-amber-400">#{studentRank || "-"}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-[#182035]/60 border border-slate-800 rounded-2xl p-3">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Score</div>
            <div className="text-lg sm:text-xl font-black text-white font-mono">{studentScore}</div>
          </div>
          <div className="bg-[#182035]/60 border border-slate-800 rounded-2xl p-3">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-center gap-1">
              <Flame className="w-3.5 h-3.5 text-orange-400" />
              <span>Max Streak</span>
            </div>
            <div className="text-lg sm:text-xl font-black text-orange-400 font-mono">{highestStreak}X</div>
          </div>
          <div className="bg-[#182035]/60 border border-slate-800 rounded-2xl p-3">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-center gap-1">
              <Coins className="w-3.5 h-3.5 text-yellow-400" />
              <span>Coins</span>
            </div>
            <div className="text-lg sm:text-xl font-black text-yellow-400 font-mono">+{studentCoins}</div>
          </div>
        </div>
      </div>

      {/* Match Leaderboard */}
      {allParticipants.length > 0 && (
        <div className="w-full max-w-xl bg-[#0d1222]/80 border border-slate-800 rounded-2xl p-4 mb-8">
          <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider mb-3 px-2">
            Full Match Leaderboard ({allParticipants.length} Players)
          </h4>
          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {allParticipants.map((p) => {
              const isCurrent = p.studentId === currentStudentId;
              return (
                <div
                  key={p.studentId}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs ${
                    isCurrent
                      ? "bg-indigo-600/20 border border-indigo-500/40 text-indigo-200 font-bold"
                      : "bg-[#141a2e]/60 text-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono font-bold w-5 text-slate-400">#{p.rank}</span>
                    <span className="text-base">{p.avatar || "🎓"}</span>
                    <span className="truncate max-w-[150px] font-medium">
                      {p.studentName} {isCurrent && "(You)"}
                    </span>
                  </div>
                  <div className="font-mono font-bold text-white">{p.score} pts</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Navigation Actions */}
      <div className="flex items-center gap-3">
        {onExit ? (
          <button
            type="button"
            onClick={onExit}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black text-sm flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer hover:scale-105 active:scale-95"
          >
            <span>Exit Battle Station</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <Link
            href="/dashboard/student"
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black text-sm flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer hover:scale-105 active:scale-95"
          >
            <span>Back to Dashboard</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
