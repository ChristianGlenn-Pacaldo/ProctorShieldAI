"use client";

import React, { useState } from "react";
import {
  Sparkles,
  Flame,
  Save,
  Dices,
  RotateCcw,
  Check,
  Download,
} from "lucide-react";
import {
  EquippedAvatarGear,
  getGearItemById,
  DEFAULT_EQUIPPED_GEAR,
  getRandomGearCombo,
} from "@/lib/avatar-gear-catalog";
import { playBloop, playSuccessFanfare } from "@/lib/student-gamify";

interface ModularAvatarStageProps {
  equippedGear: EquippedAvatarGear;
  onGearChange: (newGear: EquippedAvatarGear) => void;
  onSave: () => void;
  isSaving?: boolean;
}

export default function ModularAvatarStage({
  equippedGear,
  onGearChange,
  onSave,
  isSaving = false,
}: ModularAvatarStageProps) {
  const [auraActive, setAuraActive] = useState<boolean>(equippedGear.aura ?? true);

  const headwearItem = getGearItemById(equippedGear.headwear);
  const hairItem = getGearItemById(equippedGear.hair);
  const topItem = getGearItemById(equippedGear.top);
  const bottomItem = getGearItemById(equippedGear.bottom);
  const accessoryItem = getGearItemById(equippedGear.accessory);
  const backItem = getGearItemById(equippedGear.back);
  const shoesItem = getGearItemById(equippedGear.shoes);

  const handleToggleAura = () => {
    playBloop(640, 0.06);
    const next = !auraActive;
    setAuraActive(next);
    onGearChange({ ...equippedGear, aura: next });
  };

  const handleRandomize = () => {
    playBloop(750, 0.08);
    const randomized = getRandomGearCombo();
    onGearChange(randomized);
  };

  const handleReset = () => {
    playBloop(440, 0.08);
    onGearChange(DEFAULT_EQUIPPED_GEAR);
  };

  return (
    <div className="relative w-full h-[520px] sm:h-[580px] lg:h-[640px] rounded-3xl overflow-hidden border-2 border-indigo-500/30 bg-[#080d1e] shadow-2xl flex flex-col justify-between select-none">
      {/* ── BACKGROUND SCI-FI HANGAR & SPOTLIGHT ──────────────────── */}
      {/* Wall Paneling & Pipes */}
      <div className="absolute inset-0 pointer-events-none opacity-40">
        {/* Wall Seams */}
        <div className="absolute top-0 bottom-0 left-1/4 w-[1px] bg-indigo-500/20" />
        <div className="absolute top-0 bottom-0 right-1/4 w-[1px] bg-indigo-500/20" />
        <div className="absolute top-1/3 left-0 right-0 h-[1px] bg-indigo-500/15" />
        <div className="absolute top-2/3 left-0 right-0 h-[1px] bg-indigo-500/15" />

        {/* Ceiling Pipes / Cables */}
        <div className="absolute top-0 left-6 w-3 h-28 border-r-2 border-b-2 border-slate-700/60 rounded-br-2xl" />
        <div className="absolute top-0 right-8 w-4 h-36 border-l-2 border-b-2 border-slate-700/60 rounded-bl-2xl" />
        <div className="absolute top-8 right-24 w-12 h-1.5 bg-slate-800 rounded-full" />
      </div>

      {/* Ceiling Spotlight Cone */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-80 sm:w-96 h-full pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(56, 189, 248, 0.25) 0%, rgba(99, 102, 241, 0.08) 50%, transparent 80%)",
        }}
      />
      {/* Intense Center Beam */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-48 sm:w-60 h-[85%] pointer-events-none opacity-60"
        style={{
          background:
            "linear-gradient(180deg, rgba(147, 197, 253, 0.35) 0%, rgba(59, 130, 246, 0.12) 65%, transparent 100%)",
          clipPath: "polygon(35% 0%, 65% 0%, 100% 100%, 0% 100%)",
        }}
      />

      {/* Circular Floor Pedestal Platform */}
      <div className="absolute bottom-6 sm:bottom-10 left-1/2 -translate-x-1/2 w-[280px] sm:w-[340px] pointer-events-none">
        <svg viewBox="0 0 320 110" className="w-full h-auto drop-shadow-2xl">
          {/* Base platform ring */}
          <ellipse cx="160" cy="55" rx="150" ry="42" fill="#0c1633" stroke="#1e293b" strokeWidth="3" />
          {/* Platform rim */}
          <ellipse cx="160" cy="50" rx="146" ry="38" fill="#0f1f45" stroke="#3b82f6" strokeWidth="2" />
          {/* Inner ring */}
          <ellipse cx="160" cy="48" rx="115" ry="28" fill="#132757" stroke="#60a5fa" strokeWidth="1.5" strokeDasharray="8 6" />
          {/* Core glow pad */}
          <ellipse cx="160" cy="46" rx="80" ry="18" fill="#1d3b7a" fillOpacity="0.8" stroke="#38bdf8" strokeWidth="2" />
          {/* Concentric light lines */}
          <line x1="45" y1="50" x2="90" y2="50" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
          <line x1="230" y1="50" x2="275" y2="50" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
          {/* Hazard safety stripe arc (as in screenshot) */}
          <path
            d="M210 70 Q240 64 265 52"
            stroke="#EAB308"
            strokeWidth="3.5"
            strokeDasharray="6 4"
            fill="none"
          />
        </svg>
      </div>

      {/* ── STAGE HEADER ("My ShieldBot") ────────────────────────── */}
      <div className="relative z-10 p-5 sm:p-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
            <span className="text-[11px] font-black uppercase tracking-widest text-cyan-400">
              Active Mannequin
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white font-[family-name:var(--font-display)] tracking-tight">
            My ShieldBot
          </h2>
        </div>

        {/* Current Equip Badges */}
        <div className="hidden sm:flex items-center gap-1.5 bg-black/40 border border-white/10 px-3 py-1.5 rounded-2xl backdrop-blur-md">
          <span className="text-[10px] font-bold text-slate-400">Slots:</span>
          {topItem && (
            <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-indigo-500/30 text-indigo-300 border border-indigo-500/30">
              {topItem.name}
            </span>
          )}
          {headwearItem && (
            <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-lime-500/30 text-lime-300 border border-lime-500/30">
              {headwearItem.name}
            </span>
          )}
        </div>
      </div>

      {/* ── CHARACTER AVATAR CANVAS ──────────────────────────────── */}
      <div className="relative z-10 flex-1 flex items-center justify-center p-2">
        {/* Aura particle glow effect */}
        {auraActive && (
          <div className="absolute w-64 h-80 rounded-full bg-gradient-to-t from-amber-500/25 via-cyan-500/20 to-purple-500/25 blur-2xl animate-pulse pointer-events-none" />
        )}

        <div className="relative w-[210px] sm:w-[250px] lg:w-[270px] h-[320px] sm:h-[380px] lg:h-[400px] flex items-center justify-center">
          <svg
            viewBox="0 0 200 240"
            className="w-full h-full overflow-visible transition-all duration-300 drop-shadow-[0_15px_30px_rgba(0,0,0,0.7)]"
          >
            <defs>
              {/* Chibi Body Gradient */}
              <linearGradient id="bodySkin" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="70%" stopColor="#F1F5F9" />
                <stop offset="100%" stopColor="#E2E8F0" />
              </linearGradient>
              {/* Shadow underneath */}
              <radialGradient id="footShadow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#030712" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#030712" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Platform Contact Shadow */}
            <ellipse cx="100" cy="216" rx="55" ry="12" fill="url(#footShadow)" />

            {/* 1. BACK GEAR LAYER (Behind body) */}
            {backItem && backItem.renderItem({ isStage: true })}

            {/* 2. BASE CHIBI BODY (White Qbit / ShieldBot Mannequin) */}
            <g id="base-mannequin">
              {/* Left Arm */}
              <path
                d="M74 110 C66 122 62 136 66 148 C68 152 74 152 76 146 C78 136 82 124 86 114 Z"
                fill="url(#bodySkin)"
                stroke="#CBD5E1"
                strokeWidth="1.2"
              />
              {/* Right Arm */}
              <path
                d="M126 110 C134 122 138 136 134 148 C132 152 126 152 124 146 C122 136 118 124 114 114 Z"
                fill="url(#bodySkin)"
                stroke="#CBD5E1"
                strokeWidth="1.2"
              />
              {/* Left Leg */}
              <rect
                x="76"
                y="156"
                width="18"
                height="46"
                rx="9"
                fill="url(#bodySkin)"
                stroke="#CBD5E1"
                strokeWidth="1.2"
              />
              {/* Right Leg */}
              <rect
                x="106"
                y="156"
                width="18"
                height="46"
                rx="9"
                fill="url(#bodySkin)"
                stroke="#CBD5E1"
                strokeWidth="1.2"
              />
              {/* Torso */}
              <rect
                x="76"
                y="100"
                width="48"
                height="60"
                rx="18"
                fill="url(#bodySkin)"
                stroke="#CBD5E1"
                strokeWidth="1.2"
              />
              {/* Rounded Chibi Head */}
              <ellipse
                cx="100"
                cy="66"
                rx="38"
                ry="36"
                fill="url(#bodySkin)"
                stroke="#CBD5E1"
                strokeWidth="1.5"
              />
              {/* Cute Chibi Bead Eyes (as in screenshot) */}
              <ellipse cx="85" cy="68" rx="4" ry="6" fill="#0F172A" />
              <circle cx="83.5" cy="65.5" r="1.5" fill="#FFFFFF" />

              <ellipse cx="115" cy="68" rx="4" ry="6" fill="#0F172A" />
              <circle cx="113.5" cy="65.5" r="1.5" fill="#FFFFFF" />

              {/* Rosy Blush */}
              <ellipse cx="77" cy="74" rx="4.5" ry="2.5" fill="#FDA4AF" fillOpacity="0.4" />
              <ellipse cx="123" cy="74" rx="4.5" ry="2.5" fill="#FDA4AF" fillOpacity="0.4" />
            </g>

            {/* 3. SHOES LAYER */}
            {shoesItem ? (
              shoesItem.renderItem({ isStage: true })
            ) : (
              // Default bare feet
              <g>
                <ellipse cx="85" cy="202" rx="11" ry="5" fill="#E2E8F0" />
                <ellipse cx="115" cy="202" rx="11" ry="5" fill="#E2E8F0" />
              </g>
            )}

            {/* 4. BOTTOMS LAYER */}
            {bottomItem && bottomItem.renderItem({ isStage: true })}

            {/* 5. TOP / OUTFIT LAYER */}
            {topItem && topItem.renderItem({ isStage: true })}

            {/* 6. ACCESSORY LAYER */}
            {accessoryItem && accessoryItem.renderItem({ isStage: true })}

            {/* 7. HAIR LAYER */}
            {hairItem && hairItem.renderItem({ isStage: true })}

            {/* 8. HEADWEAR LAYER */}
            {headwearItem && headwearItem.renderItem({ isStage: true })}
          </svg>
        </div>
      </div>

      {/* ── FLOATING ACTION TOOLBAR (RIGHT SIDE - Matching Screenshot) ── */}
      <div className="absolute right-4 sm:right-6 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-3">
        {/* Aura Button 🔥 */}
        <button
          type="button"
          onClick={handleToggleAura}
          title={auraActive ? "Disable Aura Glow" : "Enable Aura Glow"}
          className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center transition-all cursor-pointer shadow-xl ${
            auraActive
              ? "bg-gradient-to-tr from-amber-500 to-orange-500 text-white shadow-orange-500/40 scale-105"
              : "bg-slate-900/80 border border-slate-700/60 text-slate-400 hover:text-white hover:bg-slate-800"
          }`}
        >
          <Flame className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>

        {/* Save Button 💾 / 📥 */}
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          title="Save Outfit to Profile"
          className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white flex items-center justify-center transition-all cursor-pointer shadow-xl shadow-indigo-600/35 disabled:opacity-50"
        >
          {isSaving ? (
            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Save className="w-5 h-5 sm:w-6 sm:h-6" />
          )}
        </button>

        {/* Randomize Button 🎲 */}
        <button
          type="button"
          onClick={handleRandomize}
          title="Randomize Outfit Combo"
          className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 text-amber-400 hover:text-amber-300 active:scale-95 flex items-center justify-center transition-all cursor-pointer shadow-xl"
        >
          <Dices className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>

        {/* Reset Button 🔄 */}
        <button
          type="button"
          onClick={handleReset}
          title="Reset to Default Gear"
          className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 text-slate-400 hover:text-white active:scale-95 flex items-center justify-center transition-all cursor-pointer shadow-xl"
        >
          <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      </div>

      {/* ── STAGE BOTTOM BAR ─────────────────────────────────────── */}
      <div className="relative z-10 px-6 py-4 bg-gradient-to-t from-[#050814] via-[#050814]/80 to-transparent flex items-center justify-between text-xs text-slate-400 border-t border-indigo-500/10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>Equipped items apply immediately to your student card</span>
        </div>

        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-extrabold text-xs shadow-md shadow-cyan-500/20 cursor-pointer active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" />
          {isSaving ? "Saving..." : "Save Look"}
        </button>
      </div>
    </div>
  );
}
