"use client";

import { useState, useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Lock,
  Sparkles,
  Trophy,
  Shield,
  Check,
  Flame,
  Shirt,
  ShoppingBag,
} from "lucide-react";
import {
  AVATAR_GEAR_CATALOG,
  AvatarGearItem,
  EquippedAvatarGear,
  GearCategory,
  RARITY_CONFIG,
  DEFAULT_EQUIPPED_GEAR,
  parseEquippedGear,
} from "@/lib/avatar-gear-catalog";
import ModularAvatarStage from "@/components/student/modular-avatar-stage";
import {
  playBloop,
  playSuccessFanfare,
  playErrorBuzz,
} from "@/lib/student-gamify";

export default function SettingsContent() {
  const [user, setUser] = useState<{ fullName: string; email: string } | null>(null);
  const [fullName, setFullName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Avatar Customizer state
  const [equippedGear, setEquippedGear] = useState<EquippedAvatarGear>(DEFAULT_EQUIPPED_GEAR);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isSavingLook, setIsSavingLook] = useState(false);
  const [topOneWins, setTopOneWins] = useState(0);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Load session & user details
  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setUser({ fullName: data.user.fullName, email: data.user.email });
          setFullName(data.user.fullName);
        }
      })
      .catch((err) => console.error("Failed to load session:", err));
  }, []);

  // Load avatar data from backend
  useEffect(() => {
    const loadAvatarData = async () => {
      try {
        const res = await fetch("/api/student/avatar-shop");
        if (res.ok) {
          const data = await res.json();
          setTopOneWins(data.topOneWins || 0);

          if (data.equippedAvatar) {
            const parsed = parseEquippedGear(data.equippedAvatar);
            setEquippedGear(parsed);
          } else {
            // Check local storage fallback
            const localSaved = localStorage.getItem("proctor_custom_gear");
            if (localSaved) {
              setEquippedGear(parseEquippedGear(localSaved));
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch avatar data:", err);
      }
    };
    loadAvatarData();
  }, []);

  // Handle Equipping / Unequipping gear
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

  // Handle Save Avatar Look
  const handleSaveAvatarLook = async () => {
    setIsSavingLook(true);
    try {
      const res = await fetch("/api/student/avatar-shop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-look",
          gear: equippedGear,
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        playSuccessFanfare();
        localStorage.setItem("proctor_custom_gear", JSON.stringify(equippedGear));
        showToast("🎉 Awesome! Avatar look saved to your student profile!", "success");
      } else {
        playErrorBuzz();
        showToast(data.error || "Failed to save avatar look.", "error");
      }
    } catch {
      playErrorBuzz();
      showToast("Network error while saving avatar look.", "error");
    } finally {
      setIsSavingLook(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!fullName.trim()) {
      showToast("Full name cannot be empty.", "error");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Profile updated successfully!", "success");
        setUser((prev) => (prev ? { ...prev, fullName } : null));
      } else {
        showToast(data.message || "Failed to save profile.", "error");
      }
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast("All password fields are required.", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("New passwords do not match.", "error");
      return;
    }
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      showToast("New password must be at least 10 characters and contain letters and numbers.", "error");
      return;
    }
    setIsChangingPassword(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Password changed successfully!", "success");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        showToast(data.message || "Failed to change password.", "error");
      }
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Filter items by category
  const filteredGear = AVATAR_GEAR_CATALOG.filter((item) => {
    if (selectedCategory === "all") return true;
    return item.category === selectedCategory;
  });

  const categoryTabs: { id: string; label: string }[] = [
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
    <div className="animate-fade-in space-y-8 pb-16">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed top-6 right-6 z-[200] flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border text-sm font-bold animate-fade-in ${
            toast.type === "success"
              ? "bg-emerald-950/95 border-emerald-500/40 text-emerald-200"
              : "bg-rose-950/95 border-rose-500/40 text-rose-200"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
          )}
          {toast.msg}
        </div>
      )}

      {/* ── HEADER BANNER ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0c1229] via-[#0e1638] to-[#070b1c] border-2 border-indigo-500/30 p-6 sm:p-8 text-white shadow-2xl shadow-indigo-950/50">
        <div className="absolute -top-16 -right-16 w-80 h-80 bg-cyan-500/15 blur-[100px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-10 w-72 h-72 bg-indigo-500/20 blur-[90px] rounded-full pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="text-[11px] uppercase font-black px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/35 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                Modular Avatar Studio
              </span>
              {topOneWins > 0 && (
                <span className="text-[11px] font-black px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/35 flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-amber-400" />
                  {topOneWins}x Top 1 Champion
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white font-[family-name:var(--font-display)]">
              Avatar Customization
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl">
              Express your unique identity! Freely customize your ShieldBot character with modular hats, anime hair, streetwear jackets, and accessories.
            </p>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            <button
              type="button"
              onClick={handleSaveAvatarLook}
              disabled={isSavingLook}
              className="w-full md:w-auto px-6 py-3.5 rounded-2xl bg-gradient-to-r from-indigo-500 via-blue-600 to-cyan-500 hover:from-indigo-400 hover:to-cyan-400 text-white font-black text-sm shadow-xl shadow-indigo-600/30 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSavingLook ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Check className="w-4 h-4 text-emerald-300" />
              )}
              {isSavingLook ? "Saving Look..." : "Save to Profile"}
            </button>
          </div>
        </div>
      </div>

      {/* ── 2-COLUMN WAYGROUND-STYLE AVATAR STUDIO ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: WARDROBE & GEAR CATALOG (7 cols) */}
        <div className="lg:col-span-7 bg-[#0b1026]/90 backdrop-blur-md rounded-3xl border-2 border-indigo-500/25 p-5 sm:p-7 shadow-xl shadow-indigo-950/20 flex flex-col justify-between min-h-[580px] lg:min-h-[640px]">
          <div>
            {/* Catalog Header & Category Pills */}
            <div className="pb-5 border-b border-indigo-500/20 mb-5">
              <div className="flex items-center justify-between gap-2 mb-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                    <Shirt className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white font-[family-name:var(--font-display)]">
                      Wardrobe Collection
                    </h3>
                    <p className="text-xs text-slate-400">
                      Tap any item to equip or unequip in real-time
                    </p>
                  </div>
                </div>

                <span className="text-[11px] font-bold text-slate-400 bg-white/5 px-2.5 py-1 rounded-xl border border-white/10">
                  {filteredGear.length} Items
                </span>
              </div>

              {/* Category Filter Pills (Scrollable) */}
              <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
                {categoryTabs.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(cat.id);
                      playBloop(450, 0.04);
                    }}
                    className={`px-3.5 py-2 rounded-xl text-xs font-black whitespace-nowrap transition-all cursor-pointer ${
                      selectedCategory === cat.id
                        ? "bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-600/30 scale-105"
                        : "bg-slate-900/60 text-slate-400 hover:text-white hover:bg-slate-800/80 border border-white/5"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Gear Item Grid (Matches Wayground Reference) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 sm:gap-4 max-h-[480px] overflow-y-auto pr-1">
              {filteredGear.map((item) => {
                const category = item.category as keyof EquippedAvatarGear;
                const isEquipped = equippedGear[category] === item.id;
                const rarityStyle = RARITY_CONFIG[item.rarity];

                return (
                  <div
                    key={item.id}
                    onClick={() => handleToggleEquip(item)}
                    className={`relative rounded-2xl border-2 p-3.5 flex flex-col justify-between transition-all duration-200 cursor-pointer group select-none ${
                      isEquipped
                        ? "bg-indigo-950/60 border-indigo-400 shadow-lg shadow-indigo-500/25 ring-2 ring-indigo-400/40"
                        : "bg-[#0f1738]/60 border-indigo-500/20 hover:border-indigo-400/50 hover:bg-[#131d45]/80"
                    }`}
                  >
                    {/* Top Bar: Rarity Badge & Active Indicator */}
                    <div className="flex items-center justify-between gap-1 mb-2">
                      <span
                        className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${rarityStyle.badgeClass}`}
                      >
                        {rarityStyle.label}
                      </span>

                      {isEquipped && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-emerald-500 text-white flex items-center gap-1 shadow-sm">
                          <Check className="w-2.5 h-2.5" /> ON
                        </span>
                      )}
                    </div>

                    {/* SVG Graphic Preview Frame */}
                    <div className="my-1.5 w-full h-24 sm:h-28 rounded-xl bg-black/30 border border-white/5 flex items-center justify-center p-2 group-hover:scale-105 transition-transform">
                      {item.previewSvg({ className: "w-full h-full object-contain" })}
                    </div>

                    {/* Item Name & Details */}
                    <div className="mt-2 text-left">
                      <div className="text-xs font-black text-white truncate">
                        {item.name}
                      </div>
                      <div className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                        {item.description}
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="mt-2.5 pt-2 border-t border-white/10">
                      {isEquipped ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleEquip(item);
                          }}
                          className="w-full py-1.5 rounded-xl text-[11px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition-all flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Check className="w-3 h-3 text-emerald-400" /> Equipped
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleEquip(item);
                          }}
                          className="w-full py-1.5 rounded-xl text-[11px] font-black bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-sm active:scale-95 cursor-pointer"
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

          <div className="mt-4 pt-3 border-t border-indigo-500/20 flex items-center justify-between text-xs text-slate-400">
            <span>✨ All gear is unlocked for student customization</span>
            <button
              type="button"
              onClick={() => setSelectedCategory("all")}
              className="text-cyan-400 hover:underline font-bold text-xs cursor-pointer"
            >
              View All Items
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: SPOTLIGHT PEDESTAL STAGE (5 cols) */}
        <div className="lg:col-span-5 sticky top-6">
          <ModularAvatarStage
            equippedGear={equippedGear}
            onGearChange={(newGear) => setEquippedGear(newGear)}
            onSave={handleSaveAvatarLook}
            isSaving={isSavingLook}
          />
        </div>
      </div>

      {/* ── PROFILE & SECURITY SETTINGS ───────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-6 pt-4">
        {/* Profile Details Card */}
        <div className="bg-[var(--surface)] rounded-3xl border border-[var(--border)] p-6 shadow-sm">
          <div className="px-1 pb-4 border-b border-[var(--border)] mb-5 flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-500" />
            <h3 className="text-base font-extrabold text-[var(--ink)] font-[family-name:var(--font-display)]">
              Student Information
            </h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-[var(--muted)] mb-1.5 block uppercase tracking-wider">
                Full Name
              </label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-indigo-500 font-semibold transition-colors"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[var(--muted)] mb-1.5 block uppercase tracking-wider">
                Email Address
              </label>
              <input
                value={user?.email || ""}
                disabled
                className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--muted)] cursor-not-allowed font-medium"
              />
            </div>

            <button
              disabled={isSaving}
              onClick={handleSaveProfile}
              className="w-full py-3 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSaving && (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {isSaving ? "Saving..." : "Save Profile Details"}
            </button>
          </div>
        </div>

        {/* Password Security Card */}
        <div className="bg-[var(--surface)] rounded-3xl border border-[var(--border)] p-6 shadow-sm">
          <div className="px-1 pb-4 border-b border-[var(--border)] mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-indigo-500" />
              <h3 className="text-base font-extrabold text-[var(--ink)] font-[family-name:var(--font-display)]">
                Security & Password
              </h3>
            </div>
            <span className="text-[11px] text-[var(--muted)]">Optional</span>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="text-xs font-bold text-[var(--muted)] mb-1.5 block uppercase tracking-wider">
                Current Password
              </label>
              <div className="relative">
                <input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted2)] hover:text-[var(--ink)]"
                >
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-[var(--muted)] mb-1.5 block uppercase tracking-wider">
                New Password
              </label>
              <div className="relative">
                <input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 10 characters with numbers"
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted2)] hover:text-[var(--ink)]"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-[var(--muted)] mb-1.5 block uppercase tracking-wider">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-type new password"
                className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <button
              disabled={isChangingPassword || !newPassword}
              onClick={handleChangePassword}
              className="w-full py-3 text-sm font-bold text-white bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-xl transition-all disabled:opacity-40 flex items-center justify-center gap-2 mt-2 cursor-pointer"
            >
              {isChangingPassword && (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {isChangingPassword ? "Updating..." : "Update Password"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
