// Modular 2D Avatar Gear Catalog for ProctorShieldAI
// Based on the Wayground avatar shop reference (Frog Hat, Flame Tape Jacket, Orange Puffer, etc.)

import React from "react";

export type GearCategory =
  | "headwear"
  | "hair"
  | "top"
  | "bottom"
  | "accessory"
  | "back"
  | "shoes";

export type GearRarity = "common" | "rare" | "epic" | "legendary";

export interface AvatarGearItem {
  id: string;
  name: string;
  category: GearCategory;
  rarity: GearRarity;
  description: string;
  renderItem: (props: { className?: string; isStage?: boolean }) => React.ReactNode;
  previewSvg: (props: { className?: string }) => React.ReactNode;
}

export interface EquippedAvatarGear {
  headwear?: string | null;
  hair?: string | null;
  top?: string | null;
  bottom?: string | null;
  accessory?: string | null;
  back?: string | null;
  shoes?: string | null;
  aura?: boolean;
}

// ── RARITY HELPERS ────────────────────────────────────────────────────────
export const RARITY_CONFIG: Record<
  GearRarity,
  { label: string; badgeClass: string; borderGlow: string; textClass: string }
> = {
  common: {
    label: "Common",
    badgeClass: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
    borderGlow: "rgba(6, 182, 212, 0.4)",
    textClass: "text-cyan-400",
  },
  rare: {
    label: "Rare",
    badgeClass: "bg-purple-500/20 text-purple-300 border-purple-500/40",
    borderGlow: "rgba(168, 85, 247, 0.5)",
    textClass: "text-purple-400",
  },
  epic: {
    label: "Epic",
    badgeClass: "bg-pink-500/20 text-pink-300 border-pink-500/40",
    borderGlow: "rgba(236, 72, 153, 0.55)",
    textClass: "text-pink-400",
  },
  legendary: {
    label: "Legendary",
    badgeClass: "bg-amber-400/25 text-amber-300 border-amber-400/50",
    borderGlow: "rgba(251, 191, 36, 0.7)",
    textClass: "text-amber-400",
  },
};

// ── CATALOG ITEMS ─────────────────────────────────────────────────────────
export const AVATAR_GEAR_CATALOG: AvatarGearItem[] = [
  // ── 1. HEADWEAR ─────────────────────────────────────────────────────────
  {
    id: "frog_hat",
    name: "Froggy Bucket Hat",
    category: "headwear",
    rarity: "rare",
    description: "Cute lime bucket hat with big round froggy eyes.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        {/* Frog Eyes */}
        <circle cx="34" cy="24" r="14" fill="#65A30D" />
        <circle cx="34" cy="24" r="11" fill="#FFFFFF" />
        <circle cx="34" cy="24" r="5.5" fill="#0F172A" />
        <circle cx="32" cy="21" r="2" fill="#FFFFFF" />

        <circle cx="66" cy="24" r="14" fill="#65A30D" />
        <circle cx="66" cy="24" r="11" fill="#FFFFFF" />
        <circle cx="66" cy="24" r="5.5" fill="#0F172A" />
        <circle cx="64" cy="21" r="2" fill="#FFFFFF" />

        {/* Hat Crown */}
        <path
          d="M26 36 C26 25 74 25 74 36 L78 52 C78 54 22 54 22 52 Z"
          fill="#4D7C0F"
        />
        <path
          d="M28 36 C28 27 72 27 72 36 L75 50 C75 52 25 52 25 50 Z"
          fill="#65A30D"
        />
        {/* Hat Brim */}
        <ellipse cx="50" cy="54" rx="38" ry="11" fill="#4D7C0F" />
        <ellipse cx="50" cy="52" rx="36" ry="9" fill="#84CC16" />
        {/* Subtle highlights */}
        <path
          d="M34 38 Q50 34 66 38"
          stroke="#A3E635"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        {/* Left Frog Eye */}
        <circle cx="78" cy="30" r="14" fill="#4D7C0F" />
        <circle cx="78" cy="30" r="11.5" fill="#FFFFFF" />
        <circle cx="78" cy="30" r="6" fill="#0F172A" />
        <circle cx="75" cy="27" r="2.2" fill="#FFFFFF" />

        {/* Right Frog Eye */}
        <circle cx="122" cy="30" r="14" fill="#4D7C0F" />
        <circle cx="122" cy="30" r="11.5" fill="#FFFFFF" />
        <circle cx="122" cy="30" r="6" fill="#0F172A" />
        <circle cx="119" cy="27" r="2.2" fill="#FFFFFF" />

        {/* Bucket Crown */}
        <path
          d="M66 45 C66 30 134 30 134 45 L138 64 C138 68 62 68 62 64 Z"
          fill="#4D7C0F"
        />
        <path
          d="M68 45 C68 33 132 33 132 45 L135 62 C135 65 65 65 65 62 Z"
          fill="#65A30D"
        />
        {/* Hat Brim */}
        <ellipse cx="100" cy="65" rx="44" ry="11" fill="#365314" />
        <ellipse cx="100" cy="63" rx="42" ry="9.5" fill="#84CC16" />
        {/* Light sheen */}
        <path
          d="M78 47 Q100 42 122 47"
          stroke="#BEF264"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </g>
    ),
  },
  {
    id: "bear_hood",
    name: "Bear Ear Hood",
    category: "headwear",
    rarity: "rare",
    description: "Cozy teddy bear ears peeking with soft warm fleece.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        {/* Left ear */}
        <circle cx="28" cy="28" r="14" fill="#78350F" />
        <circle cx="28" cy="28" r="8" fill="#FDE68A" />
        {/* Right ear */}
        <circle cx="72" cy="28" r="14" fill="#78350F" />
        <circle cx="72" cy="28" r="8" fill="#FDE68A" />
        {/* Hood dome */}
        <ellipse cx="50" cy="46" rx="34" ry="24" fill="#92400E" />
        <ellipse cx="50" cy="44" rx="30" ry="20" fill="#B45309" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        {/* Left Bear Ear */}
        <circle cx="68" cy="34" r="15" fill="#78350F" />
        <circle cx="68" cy="34" r="8.5" fill="#FDE68A" />
        {/* Right Bear Ear */}
        <circle cx="132" cy="34" r="15" fill="#78350F" />
        <circle cx="132" cy="34" r="8.5" fill="#FDE68A" />
        {/* Hood Cap */}
        <path
          d="M62 56 C62 30 138 30 138 56 C138 60 62 60 62 56 Z"
          fill="#92400E"
        />
        <path
          d="M66 54 C66 33 134 33 134 54 C134 57 66 57 66 54 Z"
          fill="#B45309"
        />
      </g>
    ),
  },
  {
    id: "royal_crown",
    name: "Podium Champion Crown",
    category: "headwear",
    rarity: "legendary",
    description: "Royal 24k gold crown encrusted with ruby and sapphire gems.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <path
          d="M20 54 L24 28 L40 40 L50 20 L60 40 L76 28 L80 54 Z"
          fill="#D97706"
        />
        <path
          d="M22 52 L26 30 L40 40 L50 24 L60 40 L74 30 L78 52 Z"
          fill="#FBBF24"
        />
        {/* Gems */}
        <circle cx="50" cy="45" r="4.5" fill="#DC2626" />
        <circle cx="34" cy="47" r="3.5" fill="#0284C7" />
        <circle cx="66" cy="47" r="3.5" fill="#0284C7" />
        <rect x="20" y="52" width="60" height="7" rx="3.5" fill="#B45309" />
        <rect x="22" y="53" width="56" height="5" rx="2.5" fill="#FDE68A" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        <path
          d="M70 48 L74 24 L86 35 L100 16 L114 35 L126 24 L130 48 Z"
          fill="#D97706"
        />
        <path
          d="M72 47 L76 26 L88 36 L100 20 L112 36 L124 26 L128 47 Z"
          fill="#FBBF24"
        />
        <circle cx="100" cy="40" r="4.5" fill="#EF4444" />
        <circle cx="84" cy="41" r="3.5" fill="#06B6D4" />
        <circle cx="116" cy="41" r="3.5" fill="#06B6D4" />
        <rect x="70" y="46" width="60" height="7" rx="3.5" fill="#B45309" />
        <rect x="72" y="47" width="56" height="5" rx="2.5" fill="#FEF08A" />
      </g>
    ),
  },
  {
    id: "cyber_visor",
    name: "Cyberpunk HUD Visor",
    category: "headwear",
    rarity: "epic",
    description: "Holographic tactical eyepiece with real-time HUD telemetry.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <rect x="18" y="32" width="64" height="22" rx="6" fill="#0284C7" fillOpacity="0.3" stroke="#06B6D4" strokeWidth="2.5" />
        <path d="M22 43 H78" stroke="#38BDF8" strokeWidth="1.5" strokeDasharray="3 2" />
        <circle cx="30" cy="43" r="3" fill="#22D3EE" />
        <rect x="64" y="36" width="12" height="4" rx="2" fill="#38BDF8" />
        {/* Frame bands */}
        <path d="M18 43 L12 40 M82 43 L88 40" stroke="#0EA5E9" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        <rect
          x="68"
          y="60"
          width="64"
          height="18"
          rx="5"
          fill="#06B6D4"
          fillOpacity="0.45"
          stroke="#22D3EE"
          strokeWidth="2.5"
        />
        <path d="M72 69 H128" stroke="#67E8F9" strokeWidth="1.5" strokeDasharray="4 2" />
        <circle cx="80" cy="69" r="3" fill="#A5F3FC" />
        <rect x="114" y="63" width="12" height="3" rx="1.5" fill="#A5F3FC" />
        {/* Ear straps */}
        <path d="M68 68 L60 66 M132 68 L140 66" stroke="#0891B2" strokeWidth="3" strokeLinecap="round" />
      </g>
    ),
  },

  // ── 2. HAIR ──────────────────────────────────────────────────────────────
  {
    id: "gojo_white",
    name: "Spiky White Anime Hair",
    category: "hair",
    rarity: "legendary",
    description: "Pure white spiked locks inspired by the strongest sorcerer.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <path
          d="M24 55 L16 38 L28 40 L26 22 L40 28 L48 12 L56 26 L70 16 L68 34 L82 28 L76 52 L68 50 L56 54 L44 50 L34 54 Z"
          fill="#E2E8F0"
        />
        <path
          d="M26 52 L20 38 L30 41 L28 26 L40 30 L48 16 L54 28 L68 20 L66 36 L78 30 L74 50 L66 48 L54 52 L44 48 L34 52 Z"
          fill="#FFFFFF"
        />
        <path d="M38 34 L48 20 L52 32" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
        <path d="M58 28 L66 22 L64 34" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        <path
          d="M62 62 L52 40 L66 42 L62 20 L78 28 L90 8 L104 24 L122 14 L118 34 L138 26 L130 56 L122 52 L108 58 L92 52 L78 58 Z"
          fill="#CBD5E1"
        />
        <path
          d="M64 59 L56 42 L68 44 L66 24 L80 30 L92 12 L102 26 L120 18 L116 36 L134 30 L128 54 L120 50 L106 56 L94 50 L80 56 Z"
          fill="#FFFFFF"
        />
        <path d="M78 38 L90 22 L96 34" stroke="#E2E8F0" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M106 30 L116 22 L114 36" stroke="#E2E8F0" strokeWidth="2.5" strokeLinecap="round" />
        {/* Front Forehead Bangs */}
        <path d="M72 58 L80 68 L88 56 L96 66 L104 56 L114 66 L120 58" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="1" />
      </g>
    ),
  },
  {
    id: "kpop_undercut",
    name: "K-Pop Two-Block Cut",
    category: "hair",
    rarity: "rare",
    description: "Glossy jet black parted bangs with crisp styled volume.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <path
          d="M24 50 C22 30 38 18 50 18 C64 18 78 30 76 50 C74 46 68 44 60 48 C54 52 50 42 42 46 C34 50 28 46 24 50 Z"
          fill="#1E293B"
        />
        <path
          d="M26 48 C25 32 39 21 50 21 C62 21 75 32 74 48 C71 44 66 43 58 47 C52 50 49 41 41 45 C35 48 30 45 26 48 Z"
          fill="#334155"
        />
        <path d="M38 28 Q48 24 58 26" stroke="#64748B" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        <path
          d="M62 58 C60 34 78 20 100 20 C122 20 140 34 138 58 C134 52 126 50 114 56 C106 60 100 48 88 54 C78 58 70 52 62 58 Z"
          fill="#0F172A"
        />
        <path
          d="M64 56 C62 36 80 23 100 23 C120 23 136 36 136 56 C131 50 124 48 112 54 C104 58 98 47 87 52 C77 56 70 51 64 56 Z"
          fill="#334155"
        />
        <path d="M82 32 Q100 26 118 30" stroke="#64748B" strokeWidth="3" strokeLinecap="round" />
      </g>
    ),
  },
  {
    id: "blonde_curls",
    name: "Golden Wavy Curls",
    category: "hair",
    rarity: "common",
    description: "Bright sunny blonde locks with bouncy stylized waves.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <circle cx="28" cy="40" r="12" fill="#F59E0B" />
        <circle cx="72" cy="40" r="12" fill="#F59E0B" />
        <path d="M26 48 C24 28 40 18 50 18 C62 18 76 28 74 48 Z" fill="#FBBF24" />
        <circle cx="28" cy="44" r="9" fill="#FCD34D" />
        <circle cx="72" cy="44" r="9" fill="#FCD34D" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        <circle cx="68" cy="52" r="16" fill="#D97706" />
        <circle cx="132" cy="52" r="16" fill="#D97706" />
        <path d="M64 56 C62 30 80 18 100 18 C120 18 138 30 136 56 Z" fill="#F59E0B" />
        <path d="M68 54 C66 33 82 22 100 22 C118 22 134 33 132 54 Z" fill="#FBBF24" />
        <circle cx="68" cy="54" r="12" fill="#FDE68A" />
        <circle cx="132" cy="54" r="12" fill="#FDE68A" />
      </g>
    ),
  },

  // ── 3. TOPS / OUTFITS ───────────────────────────────────────────────────
  {
    id: "flame_jacket",
    name: "Tape Flame Street Jacket",
    category: "top",
    rarity: "legendary",
    description: "Measuring tape chest straps with blazing street flames.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        {/* Jacket Body */}
        <path d="M30 20 L20 62 L40 64 L50 48 L60 64 L80 62 L70 20 Z" fill="#18181B" />
        {/* Measuring tape collar */}
        <path d="M34 20 L50 38 L66 20 Z" fill="#FBBF24" />
        <path d="M36 22 L50 38 L64 22" stroke="#000000" strokeWidth="1.5" strokeDasharray="2 2" />
        {/* Flame graphics */}
        <path
          d="M26 62 L32 44 L38 52 L44 38 L50 50 L56 38 L62 52 L68 44 L74 62 Z"
          fill="#EA580C"
        />
        <path
          d="M30 62 L35 48 L40 54 L46 44 L50 52 L54 44 L60 54 L65 48 L70 62 Z"
          fill="#FACC15"
        />
        {/* Sleeves */}
        <path d="M26 22 L14 48 L22 52 L32 26 Z" fill="#27272A" />
        <path d="M74 22 L86 48 L78 52 L68 26 Z" fill="#27272A" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        {/* Back collar */}
        <path d="M84 98 L100 114 L116 98 Z" fill="#B45309" />
        {/* Left Arm / Sleeve */}
        <path
          d="M74 104 L56 142 L68 146 L82 112 Z"
          fill="#18181B"
          stroke="#09090B"
          strokeWidth="1.5"
        />
        {/* Right Arm / Sleeve */}
        <path
          d="M126 104 L144 142 L132 146 L118 112 Z"
          fill="#18181B"
          stroke="#09090B"
          strokeWidth="1.5"
        />
        {/* Main Torso */}
        <path
          d="M78 100 L74 156 L126 156 L122 100 Z"
          fill="#18181B"
        />
        {/* Flame Artwork Layer 1 (Red-Orange) */}
        <path
          d="M74 156 L78 132 L84 142 L90 122 L96 138 L102 118 L108 138 L114 124 L120 142 L126 132 L126 156 Z"
          fill="#EA580C"
        />
        {/* Flame Artwork Layer 2 (Yellow Core) */}
        <path
          d="M76 156 L80 138 L86 146 L92 130 L98 142 L102 126 L106 142 L112 132 L118 146 L124 138 L124 156 Z"
          fill="#FDE047"
        />
        {/* Measuring Tape Chest Banner */}
        <rect x="76" y="104" width="48" height="12" rx="2" fill="#FBBF24" />
        {/* Tape Measurement Ticks */}
        <line x1="82" y1="104" x2="82" y2="111" stroke="#000000" strokeWidth="1.5" />
        <line x1="88" y1="104" x2="88" y2="108" stroke="#000000" strokeWidth="1" />
        <line x1="94" y1="104" x2="94" y2="111" stroke="#000000" strokeWidth="1.5" />
        <line x1="100" y1="104" x2="100" y2="108" stroke="#000000" strokeWidth="1" />
        <line x1="106" y1="104" x2="106" y2="111" stroke="#000000" strokeWidth="1.5" />
        <line x1="112" y1="104" x2="112" y2="108" stroke="#000000" strokeWidth="1" />
        <line x1="118" y1="104" x2="118" y2="111" stroke="#000000" strokeWidth="1.5" />
        <text x="86" y="114" fontSize="4.5" fontWeight="900" fill="#000000">8</text>
        <text x="98" y="114" fontSize="4.5" fontWeight="900" fill="#000000">14</text>
        <text x="110" y="114" fontSize="4.5" fontWeight="900" fill="#000000">15</text>
      </g>
    ),
  },
  {
    id: "orange_puffer",
    name: "Orange Puffer Parka",
    category: "top",
    rarity: "rare",
    description: "Thermal winter down jacket with snaps and padded ridges.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        {/* Coat Body */}
        <rect x="30" y="24" width="40" height="42" rx="8" fill="#F97316" />
        {/* Sleeves */}
        <rect x="16" y="26" width="16" height="30" rx="6" fill="#EA580C" />
        <rect x="68" y="26" width="16" height="30" rx="6" fill="#EA580C" />
        {/* Horizontal Baffles */}
        <line x1="30" y1="36" x2="70" y2="36" stroke="#C2410C" strokeWidth="2" />
        <line x1="30" y1="48" x2="70" y2="48" stroke="#C2410C" strokeWidth="2" />
        <line x1="30" y1="58" x2="70" y2="58" stroke="#C2410C" strokeWidth="2" />
        {/* Snap Buttons */}
        <circle cx="50" cy="30" r="2.5" fill="#475569" />
        <circle cx="50" cy="42" r="2.5" fill="#475569" />
        <circle cx="50" cy="53" r="2.5" fill="#475569" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        {/* Left Puffy Sleeve */}
        <rect
          x="54"
          y="104"
          width="24"
          height="42"
          rx="10"
          fill="#EA580C"
          stroke="#C2410C"
          strokeWidth="1.5"
          transform="rotate(12 54 104)"
        />
        {/* Right Puffy Sleeve */}
        <rect
          x="122"
          y="104"
          width="24"
          height="42"
          rx="10"
          fill="#EA580C"
          stroke="#C2410C"
          strokeWidth="1.5"
          transform="rotate(-12 122 104)"
        />
        {/* Puffer Torso */}
        <rect
          x="74"
          y="100"
          width="52"
          height="56"
          rx="10"
          fill="#F97316"
          stroke="#C2410C"
          strokeWidth="1.5"
        />
        {/* Horizontal Stitching */}
        <line x1="75" y1="114" x2="125" y2="114" stroke="#C2410C" strokeWidth="2.5" />
        <line x1="75" y1="128" x2="125" y2="128" stroke="#C2410C" strokeWidth="2.5" />
        <line x1="75" y1="142" x2="125" y2="142" stroke="#C2410C" strokeWidth="2.5" />
        {/* Snap buttons */}
        <circle cx="100" cy="107" r="3" fill="#1E293B" stroke="#64748B" strokeWidth="1" />
        <circle cx="100" cy="121" r="3" fill="#1E293B" stroke="#64748B" strokeWidth="1" />
        <circle cx="100" cy="135" r="3" fill="#1E293B" stroke="#64748B" strokeWidth="1" />
        <circle cx="100" cy="149" r="3" fill="#1E293B" stroke="#64748B" strokeWidth="1" />
      </g>
    ),
  },
  {
    id: "autumn_dress",
    name: "Autumn Leaf Collar Dress",
    category: "top",
    rarity: "rare",
    description: "Chocolate brown dress with maple leaf print and white collar.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        {/* Dress flare */}
        <path d="M38 20 L24 64 L76 64 L62 20 Z" fill="#78350F" />
        {/* Leaf accents */}
        <circle cx="38" cy="38" r="3" fill="#D97706" />
        <circle cx="58" cy="46" r="3.5" fill="#F59E0B" />
        <circle cx="44" cy="54" r="3" fill="#EA580C" />
        {/* White Peter Pan Collar */}
        <path d="M38 20 C42 28 48 26 50 22 C52 26 58 28 62 20 Z" fill="#F8FAFC" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        {/* Sleeves */}
        <path d="M74 102 L64 128 L72 130 L80 106 Z" fill="#78350F" />
        <path d="M126 102 L136 128 L128 130 L120 106 Z" fill="#78350F" />
        {/* A-Line Flare Dress */}
        <path
          d="M78 100 L66 166 L134 166 L122 100 Z"
          fill="#78350F"
          stroke="#451A03"
          strokeWidth="1.5"
        />
        {/* Golden Autumn Leaf Patterns */}
        <circle cx="82" cy="120" r="3.5" fill="#D97706" />
        <circle cx="94" cy="132" r="4" fill="#F59E0B" />
        <circle cx="114" cy="124" r="3.5" fill="#EA580C" />
        <circle cx="84" cy="148" r="4.5" fill="#FBBF24" />
        <circle cx="106" cy="150" r="4" fill="#D97706" />
        <circle cx="122" cy="144" r="3" fill="#F59E0B" />
        {/* Peter Pan Collar */}
        <path
          d="M82 100 C88 110 97 108 100 103 C103 108 112 110 118 100 Z"
          fill="#FFFFFF"
          stroke="#E2E8F0"
          strokeWidth="1.5"
        />
      </g>
    ),
  },
  {
    id: "gojo_uniform",
    name: "Sorcerer Navy Uniform",
    category: "top",
    rarity: "legendary",
    description: "Midnight navy high-collar uniform worn by elite jujutsu sorcerers.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <path d="M34 20 L22 62 L78 62 L66 20 Z" fill="#1E1B4B" />
        {/* High collar */}
        <rect x="42" y="16" width="16" height="10" rx="3" fill="#312E81" />
        <circle cx="50" cy="32" r="2.5" fill="#F59E0B" />
        {/* Sleeves */}
        <path d="M32 22 L18 52 L26 55 L38 26 Z" fill="#1E1B4B" />
        <path d="M68 22 L82 52 L74 55 L62 26 Z" fill="#1E1B4B" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        {/* Left Sleeve */}
        <path d="M76 102 L58 142 L68 146 L82 110 Z" fill="#1E1B4B" stroke="#0F172A" strokeWidth="1.5" />
        {/* Right Sleeve */}
        <path d="M124 102 L142 142 L132 146 L118 110 Z" fill="#1E1B4B" stroke="#0F172A" strokeWidth="1.5" />
        {/* Uniform Torso */}
        <path d="M78 98 L74 156 L126 156 L122 98 Z" fill="#1E1B4B" stroke="#0F172A" strokeWidth="1.5" />
        {/* High Stand-up Collar */}
        <rect x="88" y="94" width="24" height="12" rx="4" fill="#312E81" stroke="#4338CA" strokeWidth="1" />
        {/* Gold Uniform Button */}
        <circle cx="100" cy="116" r="3.5" fill="#F59E0B" stroke="#FEF08A" strokeWidth="1" />
      </g>
    ),
  },
  {
    id: "basic_tee",
    name: "Classic White Tee",
    category: "top",
    rarity: "common",
    description: "Clean minimalist cotton crewneck t-shirt.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <path d="M34 20 L24 58 L76 58 L66 20 Z" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1.5" />
        <path d="M34 20 L20 34 L28 40 L38 24 Z" fill="#E2E8F0" />
        <path d="M66 20 L80 34 L72 40 L62 24 Z" fill="#E2E8F0" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        <path d="M76 102 L64 126 L74 130 L82 110 Z" fill="#E2E8F0" />
        <path d="M124 102 L136 126 L126 130 L118 110 Z" fill="#E2E8F0" />
        <path d="M78 100 L75 156 L125 156 L122 100 Z" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="1.5" />
        <path d="M88 100 Q100 108 112 100" stroke="#CBD5E1" strokeWidth="2" fill="none" />
      </g>
    ),
  },

  // ── 4. BOTTOMS ───────────────────────────────────────────────────────────
  {
    id: "denim_shorts",
    name: "Denim Cargo Shorts",
    category: "bottom",
    rarity: "rare",
    description: "Classic blue denim shorts with brown belt and utility pockets.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        {/* Belt */}
        <rect x="26" y="24" width="48" height="6" rx="2" fill="#78350F" />
        <rect x="46" y="23" width="8" height="8" rx="2" fill="#F59E0B" />
        {/* Denim legs */}
        <path d="M26 30 L22 62 L46 62 L50 42 L54 62 L78 62 L74 30 Z" fill="#1D4ED8" />
        {/* Pockets */}
        <rect x="22" y="40" width="8" height="12" rx="2" fill="#1E40AF" />
        <rect x="70" y="40" width="8" height="12" rx="2" fill="#1E40AF" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        {/* Belt */}
        <rect x="74" y="152" width="52" height="6" rx="2" fill="#78350F" />
        <rect x="96" y="151" width="8" height="8" rx="2" fill="#F59E0B" />
        {/* Shorts Body */}
        <path
          d="M74 156 L70 186 L94 186 L100 166 L106 186 L130 186 L126 156 Z"
          fill="#2563EB"
          stroke="#1E40AF"
          strokeWidth="1.5"
        />
        {/* Left Cargo Flap */}
        <rect x="68" y="166" width="8" height="12" rx="2" fill="#1D4ED8" stroke="#1E3A8A" strokeWidth="1" />
        <circle cx="72" cy="169" r="1.2" fill="#F59E0B" />
        {/* Right Cargo Flap */}
        <rect x="124" y="166" width="8" height="12" rx="2" fill="#1D4ED8" stroke="#1E3A8A" strokeWidth="1" />
        <circle cx="128" cy="169" r="1.2" fill="#F59E0B" />
      </g>
    ),
  },
  {
    id: "leaf_pants",
    name: "Tropical Leaf Pants",
    category: "bottom",
    rarity: "legendary",
    description: "Deep green trousers with bright botanical palm leaf patterns.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <path d="M30 18 L24 66 L46 66 L50 40 L54 66 L76 66 L70 18 Z" fill="#065F46" />
        {/* Leaf patterns */}
        <path d="M34 28 Q42 22 40 34" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M60 32 Q68 26 66 38" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M30 46 Q38 40 36 52" stroke="#6EE7B7" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M64 50 Q72 44 70 56" stroke="#6EE7B7" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        <path
          d="M76 154 L72 202 L93 202 L100 166 L107 202 L128 202 L124 154 Z"
          fill="#065F46"
          stroke="#064E3B"
          strokeWidth="1.5"
        />
        {/* Botanical Patterns */}
        <path d="M78 164 Q86 158 84 170" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M116 166 Q124 160 122 172" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M76 182 Q84 176 82 188" stroke="#6EE7B7" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M118 184 Q126 178 124 190" stroke="#6EE7B7" strokeWidth="2.5" strokeLinecap="round" />
      </g>
    ),
  },
  {
    id: "navy_trousers",
    name: "Sorcerer Slacks",
    category: "bottom",
    rarity: "common",
    description: "Sharp tailored midnight navy trousers.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <path d="M30 18 L24 66 L46 66 L50 38 L54 66 L76 66 L70 18 Z" fill="#1E1B4B" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        <path
          d="M76 154 L72 202 L93 202 L100 166 L107 202 L128 202 L124 154 Z"
          fill="#1E1B4B"
          stroke="#0F172A"
          strokeWidth="1.5"
        />
      </g>
    ),
  },

  // ── 5. ACCESSORIES ───────────────────────────────────────────────────────
  {
    id: "gold_chain",
    name: "Cuban Gold Chain",
    category: "accessory",
    rarity: "rare",
    description: "Polished heavy gold curb link chain necklace.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <path
          d="M32 30 C34 50 66 50 68 30"
          stroke="#F59E0B"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M32 30 C34 50 66 50 68 30"
          stroke="#FDE68A"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="4 2"
        />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        <path
          d="M84 96 C86 116 114 116 116 96"
          stroke="#D97706"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M84 96 C86 116 114 116 116 96"
          stroke="#FBBF24"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray="4 2"
        />
        <circle cx="100" cy="112" r="3" fill="#FEF08A" />
      </g>
    ),
  },
  {
    id: "blue_scarf",
    name: "Sky Blue Knit Scarf",
    category: "accessory",
    rarity: "common",
    description: "Warm pastel winter knit scarf with fringe tail.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <ellipse cx="50" cy="38" rx="26" ry="12" fill="#38BDF8" />
        <rect x="42" y="44" width="12" height="22" rx="3" fill="#0284C7" />
        {/* Fringe */}
        <line x1="44" y1="66" x2="44" y2="70" stroke="#0284C7" strokeWidth="2" />
        <line x1="48" y1="66" x2="48" y2="70" stroke="#0284C7" strokeWidth="2" />
        <line x1="52" y1="66" x2="52" y2="70" stroke="#0284C7" strokeWidth="2" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        <ellipse cx="100" cy="98" rx="28" ry="11" fill="#38BDF8" stroke="#0284C7" strokeWidth="1.5" />
        <rect x="90" y="104" width="14" height="24" rx="3" fill="#0284C7" />
        <line x1="93" y1="128" x2="93" y2="134" stroke="#0284C7" strokeWidth="2" />
        <line x1="97" y1="128" x2="97" y2="134" stroke="#0284C7" strokeWidth="2" />
        <line x1="101" y1="128" x2="101" y2="134" stroke="#0284C7" strokeWidth="2" />
      </g>
    ),
  },
  {
    id: "hoop_earrings",
    name: "Gold Hoop Earrings",
    category: "accessory",
    rarity: "common",
    description: "Gleaming polished golden hoop earring.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <circle cx="50" cy="40" r="14" stroke="#F59E0B" strokeWidth="4" fill="none" />
        <circle cx="50" cy="40" r="14" stroke="#FEF08A" strokeWidth="1.5" strokeDasharray="6 12" fill="none" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        <circle cx="64" cy="74" r="7" stroke="#F59E0B" strokeWidth="3" fill="none" />
        <circle cx="136" cy="74" r="7" stroke="#F59E0B" strokeWidth="3" fill="none" />
      </g>
    ),
  },

  // ── 6. BACK GEAR ─────────────────────────────────────────────────────────
  {
    id: "commuter_backpack",
    name: "Tactical Commuter Backpack",
    category: "back",
    rarity: "rare",
    description: "Rugged black canvas backpack with dual front straps.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <rect x="30" y="20" width="40" height="46" rx="8" fill="#334155" />
        <rect x="34" y="38" width="32" height="24" rx="4" fill="#1E293B" />
        <line x1="38" y1="46" x2="62" y2="46" stroke="#94A3B8" strokeWidth="2" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        {/* Rendered behind body on the right edge */}
        <rect
          x="126"
          y="102"
          width="20"
          height="48"
          rx="7"
          fill="#334155"
          stroke="#1E293B"
          strokeWidth="2"
        />
        <rect x="130" y="116" width="14" height="24" rx="4" fill="#0F172A" />
      </g>
    ),
  },
  {
    id: "jetpack",
    name: "Aero Jetpack Thrusters",
    category: "back",
    rarity: "legendary",
    description: "Twin-turbine sci-fi propulsion jetpack with neon flame exhaust.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <rect x="26" y="24" width="16" height="34" rx="6" fill="#0284C7" />
        <rect x="58" y="24" width="16" height="34" rx="6" fill="#0284C7" />
        <rect x="38" y="32" width="24" height="18" rx="4" fill="#0F172A" />
        {/* Thruster Flames */}
        <path d="M30 58 L34 72 L38 58 Z" fill="#F97316" />
        <path d="M62 58 L66 72 L70 58 Z" fill="#F97316" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        {/* Left Jet Thruster */}
        <rect x="54" y="100" width="18" height="42" rx="7" fill="#0284C7" stroke="#0369A1" strokeWidth="1.5" />
        <path d="M58 142 L63 158 L68 142 Z" fill="#F97316" />
        <path d="M60 142 L63 152 L66 142 Z" fill="#FDE047" />

        {/* Right Jet Thruster */}
        <rect x="128" y="100" width="18" height="42" rx="7" fill="#0284C7" stroke="#0369A1" strokeWidth="1.5" />
        <path d="M132 142 L137 158 L142 142 Z" fill="#F97316" />
        <path d="M134 142 L137 152 L140 142 Z" fill="#FDE047" />
      </g>
    ),
  },

  // ── 7. SHOES ─────────────────────────────────────────────────────────────
  {
    id: "cyan_sneakers",
    name: "Cyan Runner Sneakers",
    category: "shoes",
    rarity: "common",
    description: "Athletic street kicks with white rubber soles and cyan panels.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <path d="M20 48 C20 40 36 34 50 40 L54 50 L20 50 Z" fill="#0284C7" />
        <rect x="18" y="50" width="38" height="8" rx="3" fill="#F8FAFC" />
        <path d="M58 48 C58 40 74 34 88 40 L92 50 L58 50 Z" fill="#0284C7" />
        <rect x="56" y="50" width="38" height="8" rx="3" fill="#F8FAFC" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        {/* Left Shoe */}
        <path
          d="M68 200 C68 194 80 190 92 194 L94 204 L68 204 Z"
          fill="#0284C7"
          stroke="#0369A1"
          strokeWidth="1"
        />
        <rect x="66" y="204" width="28" height="6" rx="2.5" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1" />
        {/* Yellow stripe */}
        <line x1="74" y1="198" x2="86" y2="198" stroke="#FACC15" strokeWidth="1.5" />

        {/* Right Shoe */}
        <path
          d="M106 194 C118 190 130 194 130 200 L130 204 L104 204 Z"
          fill="#0284C7"
          stroke="#0369A1"
          strokeWidth="1"
        />
        <rect x="104" y="204" width="28" height="6" rx="2.5" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1" />
        {/* Yellow stripe */}
        <line x1="112" y1="198" x2="124" y2="198" stroke="#FACC15" strokeWidth="1.5" />
      </g>
    ),
  },
  {
    id: "combat_boots",
    name: "Timber Combat Boots",
    category: "shoes",
    rarity: "rare",
    description: "Rugged tan nubuck leather boots with dark rubber treads.",
    previewSvg: ({ className = "w-full h-full" }) => (
      <svg viewBox="0 0 100 80" className={className} fill="none">
        <rect x="22" y="34" width="26" height="18" rx="4" fill="#B45309" />
        <rect x="20" y="52" width="30" height="6" rx="2" fill="#18181B" />
        <rect x="56" y="34" width="26" height="18" rx="4" fill="#B45309" />
        <rect x="54" y="52" width="30" height="6" rx="2" fill="#18181B" />
      </svg>
    ),
    renderItem: ({ className = "" }) => (
      <g className={className}>
        {/* Left Boot */}
        <rect x="68" y="194" width="24" height="12" rx="3" fill="#B45309" stroke="#78350F" strokeWidth="1" />
        <rect x="66" y="206" width="26" height="6" rx="2" fill="#0F172A" />
        {/* Right Boot */}
        <rect x="108" y="194" width="24" height="12" rx="3" fill="#B45309" stroke="#78350F" strokeWidth="1" />
        <rect x="108" y="206" width="26" height="6" rx="2" fill="#0F172A" />
      </g>
    ),
  },
];

// ── DEFAULT EQUIPPED GEAR (Matches Screenshot) ────────────────────────────
export const DEFAULT_EQUIPPED_GEAR: EquippedAvatarGear = {
  headwear: "frog_hat",
  hair: null,
  top: "flame_jacket",
  bottom: "denim_shorts",
  accessory: "gold_chain",
  back: "commuter_backpack",
  shoes: "cyan_sneakers",
  aura: true,
};

// ── HELPER UTILITIES ──────────────────────────────────────────────────────
export function getGearItemById(id: string | null | undefined): AvatarGearItem | undefined {
  if (!id) return undefined;
  return AVATAR_GEAR_CATALOG.find((item) => item.id === id);
}

export function parseEquippedGear(raw: string | null | undefined): EquippedAvatarGear {
  if (!raw) return DEFAULT_EQUIPPED_GEAR;
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return {
          headwear: typeof parsed.headwear === "string" ? parsed.headwear : null,
          hair: typeof parsed.hair === "string" ? parsed.hair : null,
          top: typeof parsed.top === "string" ? parsed.top : null,
          bottom: typeof parsed.bottom === "string" ? parsed.bottom : null,
          accessory: typeof parsed.accessory === "string" ? parsed.accessory : null,
          back: typeof parsed.back === "string" ? parsed.back : null,
          shoes: typeof parsed.shoes === "string" ? parsed.shoes : "cyan_sneakers",
          aura: typeof parsed.aura === "boolean" ? parsed.aura : true,
        };
      }
    } catch {
      // Fallback
    }
  }
  return DEFAULT_EQUIPPED_GEAR;
}

export function getRandomGearCombo(): EquippedAvatarGear {
  const getRand = (cat: GearCategory) => {
    const items = AVATAR_GEAR_CATALOG.filter((i) => i.category === cat);
    if (items.length === 0) return null;
    return items[Math.floor(Math.random() * items.length)].id;
  };

  return {
    headwear: Math.random() > 0.3 ? getRand("headwear") : null,
    hair: Math.random() > 0.4 ? getRand("hair") : null,
    top: getRand("top") || "flame_jacket",
    bottom: getRand("bottom") || "denim_shorts",
    accessory: Math.random() > 0.4 ? getRand("accessory") : null,
    back: Math.random() > 0.5 ? getRand("back") : null,
    shoes: getRand("shoes") || "cyan_sneakers",
    aura: Math.random() > 0.5,
  };
}
