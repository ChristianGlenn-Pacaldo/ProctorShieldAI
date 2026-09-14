"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles, Check, Shirt, Shield } from "lucide-react";
import {
  AVATAR_GEAR_CATALOG,
  AvatarGearItem,
  EquippedAvatarGear,
  RARITY_CONFIG,
  DEFAULT_EQUIPPED_GEAR,
  parseEquippedGear,
} from "@/lib/avatar-gear-catalog";
import ModularAvatarStage from "@/components/student/modular-avatar-stage";
import { playBloop, playSuccessFanfare } from "@/lib/student-gamify";

export default function AvatarShopJoinPage() {
  const [equippedGear, setEquippedGear] = useState<EquippedAvatarGear>(DEFAULT_EQUIPPED_GEAR);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isSavingLook, setIsSavingLook] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    const localSaved = localStorage.getItem("proctor_custom_gear");
    if (localSaved) {
      setEquippedGear(parseEquippedGear(localSaved));
    }
    // Also try fetching from student session if logged in
    fetch("/api/student/avatar-shop")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.equippedAvatar) {
          setEquippedGear(parseEquippedGear(data.equippedAvatar));
        }
      })
      .catch(() => {});
  }, []);

  const handleToggleEquip = (item: AvatarGearItem) => {
    playBloop(540, 0.06);
    const category = item.category as keyof EquippedAvatarGear;
    const isCurrentlyEquipped = equippedGear[category] === item.id;

    const nextGear: EquippedAvatarGear = {
      ...equippedGear,
      [category]: isCurrentlyEquipped ? null : item.id,
    };
    setEquippedGear(nextGear);
  };

  const handleSaveAvatarLook = async () => {
    setIsSavingLook(true);
    try {
      localStorage.setItem("proctor_custom_gear", JSON.stringify(equippedGear));
      playSuccessFanfare();

      // Also persist to backend if student is authenticated
      await fetch("/api/student/avatar-shop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-look",
          gear: equippedGear,
        }),
      }).catch(() => {});

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setIsSavingLook(false);
    }
  };

  const filteredGear = AVATAR_GEAR_CATALOG.filter((item) => {
    if (selectedCategory === "all") return true;
    return item.category === selectedCategory;
  });

  const categoryTabs = [
    { id: "all", label: "All Items" },
    { id: "headwear", label: "🐸 Headwear" },
    { id: "hair", label: "⚡ Hair" },
    { id: "top", label: "🧥 Outfits" },
    { id: "bottom", label: "👖 Bottoms" },
    { id: "accessory", label: "🪙 Accessories" },
    { id: "back", label: "🎒 Back Gear" },
    { id: "shoes", label: "👟 Footwear" },
  ];

  return (
    <div className="min-h-screen bg-[#060a19] text-white flex flex-col justify-between selection:bg-indigo-500 selection:text-white">
      {/* ── TOP NAVIGATION ────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#080d22]/80 border-b border-indigo-500/20 px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/join"
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold text-slate-300 hover:text-white transition-all border border-white/10"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Join
          </Link>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-500 flex items-center justify-center shadow-md shadow-indigo-500/30">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-black tracking-tight font-[family-name:var(--font-display)]">
              Proctor<span className="text-cyan-400">Shield</span> Avatar Shop
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/student/settings"
            className="hidden sm:inline-flex px-3.5 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-300 text-xs font-bold transition-all"
          >
            Go to Profile Settings
          </Link>
          <button
            type="button"
            onClick={handleSaveAvatarLook}
            disabled={isSavingLook}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-extrabold text-xs shadow-md shadow-cyan-500/25 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {isSavingLook ? (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5 text-emerald-300" />
            )}
            {saveSuccess ? "Saved!" : "Save Look"}
          </button>
        </div>
      </header>

      {/* ── MAIN CONTENT CONTAINER ─────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Banner */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-950/80 via-[#0f1738] to-[#070b1e] border border-indigo-500/30 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-black uppercase tracking-wider text-cyan-300">
                  Student Avatar Customizer
                </span>
              </div>
              <h1 className="text-xl sm:text-3xl font-black text-white font-[family-name:var(--font-display)]">
                Customize Your Avatar
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                Freely mix and match items for your 2D ShieldBot. All items are 100% unlocked!
              </p>
            </div>
          </div>
        </div>

        {/* 2-Column Customizer */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Wardrobe & Gear Catalog */}
          <div className="lg:col-span-7 bg-[#0b1026]/90 backdrop-blur-md rounded-3xl border-2 border-indigo-500/25 p-5 sm:p-6 shadow-xl shadow-indigo-950/30">
            <div className="pb-4 border-b border-indigo-500/20 mb-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shirt className="w-4 h-4 text-indigo-400" />
                  <span className="text-sm font-black text-white">Wardrobe Items</span>
                </div>
                <span className="text-xs text-slate-400 font-bold">
                  {filteredGear.length} Items Available
                </span>
              </div>

              {/* Category Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                {categoryTabs.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(cat.id);
                      playBloop(450, 0.04);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold whitespace-nowrap transition-all cursor-pointer ${
                      selectedCategory === cat.id
                        ? "bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-600/30"
                        : "bg-slate-900/60 text-slate-400 hover:text-white hover:bg-slate-800 border border-white/5"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Item Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 max-h-[500px] overflow-y-auto pr-1">
              {filteredGear.map((item) => {
                const category = item.category as keyof EquippedAvatarGear;
                const isEquipped = equippedGear[category] === item.id;
                const rarityStyle = RARITY_CONFIG[item.rarity];

                return (
                  <div
                    key={item.id}
                    onClick={() => handleToggleEquip(item)}
                    className={`relative rounded-2xl border-2 p-3 flex flex-col justify-between transition-all duration-200 cursor-pointer group select-none ${
                      isEquipped
                        ? "bg-indigo-950/60 border-indigo-400 shadow-lg shadow-indigo-500/25 ring-2 ring-indigo-400/40"
                        : "bg-[#0f1738]/60 border-indigo-500/20 hover:border-indigo-400/50 hover:bg-[#131d45]/80"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span
                        className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${rarityStyle.badgeClass}`}
                      >
                        {rarityStyle.label}
                      </span>
                      {isEquipped && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-emerald-500 text-white flex items-center gap-0.5">
                          <Check className="w-2.5 h-2.5" /> ON
                        </span>
                      )}
                    </div>

                    <div className="my-1 w-full h-24 rounded-xl bg-black/30 border border-white/5 flex items-center justify-center p-2 group-hover:scale-105 transition-transform">
                      {item.previewSvg({ className: "w-full h-full object-contain" })}
                    </div>

                    <div className="mt-1.5 text-left">
                      <div className="text-xs font-black text-white truncate">
                        {item.name}
                      </div>
                      <div className="text-[10px] text-slate-400 line-clamp-1">
                        {item.description}
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-white/10">
                      {isEquipped ? (
                        <button
                          type="button"
                          className="w-full py-1 rounded-xl text-[11px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                        >
                          Equipped
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="w-full py-1 rounded-xl text-[11px] font-black bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-sm"
                        >
                          Equip
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Stage Preview */}
          <div className="lg:col-span-5 sticky top-20">
            <ModularAvatarStage
              equippedGear={equippedGear}
              onGearChange={(newGear) => setEquippedGear(newGear)}
              onSave={handleSaveAvatarLook}
              isSaving={isSavingLook}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
