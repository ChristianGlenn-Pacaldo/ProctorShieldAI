"use client";

import React from "react";
import { Flame, Shield, Snowflake, Zap } from "lucide-react";
import type { BattlePowerType } from "@/lib/student-battle";

interface ArenaBattleDockProps {
  inventory: Record<string, boolean>;
  hasShield: boolean;
  isLaunching: string | null;
  enabledPowers?: string[];
  onUsePower: (powerType: BattlePowerType) => void;
  disabled?: boolean;
}

interface PowerConfig {
  id: BattlePowerType;
  name: string;
  emoji: string;
  damageText: string;
  colorGradient: string;
  activeBorder: string;
  badgeBg: string;
  textColor: string;
}

const POWERS: PowerConfig[] = [
  {
    id: "meteor",
    name: "Meteor Strike",
    emoji: "☄️",
    damageText: "-25 HP",
    colorGradient: "from-rose-600/30 to-amber-600/30 hover:from-rose-600/50 hover:to-amber-600/50",
    activeBorder: "border-rose-500/50 hover:border-rose-400 shadow-rose-500/20",
    badgeBg: "bg-rose-500/30 text-rose-300",
    textColor: "text-rose-200",
  },
  {
    id: "earthquake",
    name: "Earthquake",
    emoji: "🌋",
    damageText: "Rumble",
    colorGradient: "from-amber-600/30 to-yellow-600/30 hover:from-amber-600/50 hover:to-yellow-600/50",
    activeBorder: "border-amber-500/50 hover:border-amber-400 shadow-amber-500/20",
    badgeBg: "bg-amber-500/30 text-amber-300",
    textColor: "text-amber-200",
  },
  {
    id: "blizzard",
    name: "Blizzard Frost",
    emoji: "❄️",
    damageText: "Freeze 4s",
    colorGradient: "from-cyan-600/30 to-blue-600/30 hover:from-cyan-600/50 hover:to-blue-600/50",
    activeBorder: "border-cyan-500/50 hover:border-cyan-400 shadow-cyan-500/20",
    badgeBg: "bg-cyan-500/30 text-cyan-300",
    textColor: "text-cyan-200",
  },
  {
    id: "shield",
    name: "Guardian Shield",
    emoji: "🛡️",
    damageText: "Deflect",
    colorGradient: "from-indigo-600/30 to-purple-600/30 hover:from-indigo-600/50 hover:to-purple-600/50",
    activeBorder: "border-indigo-500/50 hover:border-indigo-400 shadow-indigo-500/20",
    badgeBg: "bg-indigo-500/30 text-indigo-300",
    textColor: "text-indigo-200",
  },
];

export function ArenaBattleDock({
  inventory,
  hasShield,
  isLaunching,
  enabledPowers,
  onUsePower,
  disabled = false,
}: ArenaBattleDockProps) {
  const activePowers = enabledPowers && enabledPowers.length > 0
    ? POWERS.filter((p) => enabledPowers.includes(p.id))
    : POWERS;

  return (
    <div className="w-full bg-[#0d111d]/90 backdrop-blur-xl border border-indigo-500/30 rounded-2xl p-3 sm:p-4 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-amber-500 to-rose-600 flex items-center justify-center text-white shadow-md">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
              Battle Arsenal
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300 font-bold">
                Live vs Rivals
              </span>
            </h3>
          </div>
        </div>

        {hasShield && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[11px] font-black animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            <Shield className="w-3.5 h-3.5" />
            <span>SHIELD ARMED</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {activePowers.map((power) => {
          const isUsed = Boolean(inventory[power.id]);
          const isCurrentLoading = isLaunching === power.id;
          const isButtonDisabled = disabled || isUsed || isLaunching !== null;

          return (
            <button
              key={power.id}
              type="button"
              id={`arena-power-${power.id}`}
              onClick={() => onUsePower(power.id)}
              disabled={isButtonDisabled}
              className={`relative group px-3 py-2.5 rounded-xl border text-left flex flex-col justify-between transition-all duration-200 cursor-pointer shadow-md ${
                isUsed
                  ? "bg-[#141828]/60 border-slate-800 text-slate-500 opacity-50 cursor-not-allowed"
                  : `bg-gradient-to-br ${power.colorGradient} ${power.activeBorder} ${power.textColor} hover:scale-[1.02] active:scale-[0.98]`
              }`}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <span className="text-xl sm:text-2xl">{power.emoji}</span>
                <span
                  className={`text-[9px] sm:text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    isUsed ? "bg-slate-800 text-slate-500" : power.badgeBg
                  }`}
                >
                  {isUsed ? "USED" : power.damageText}
                </span>
              </div>

              <div className="w-full">
                <div className="text-xs font-black truncate">{power.name}</div>
                <div className="text-[10px] text-slate-400 truncate">
                  {isCurrentLoading ? "Deploying..." : isUsed ? "Expended" : "Ready to cast"}
                </div>
              </div>

              {!isUsed && !disabled && (
                <div className="absolute inset-0 rounded-xl bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
