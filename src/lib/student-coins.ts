// Avatar Shop Catalog & Coin Economy for ProctorShieldAI

export interface ShopAvatar {
  id: string;
  name: string;
  emoji: string;
  category: "starter" | "champion" | "mystic" | "cyber" | "guardian";
  rarity: "common" | "rare" | "epic" | "legendary";
  price: number; // 0 for starters
  color: string;
  borderGlow: string;
  description: string;
  perk: string;
}

export const AVATAR_CATALOG: ShopAvatar[] = [
  // Starters (Free)
  {
    id: "shield",
    name: "Guardian Shield",
    emoji: "🛡️",
    category: "guardian",
    rarity: "common",
    price: 0,
    color: "from-blue-500 to-indigo-600",
    borderGlow: "rgba(59, 130, 246, 0.4)",
    description: "The founding emblem of honest test-takers.",
    perk: "+5% Integrity Trust Boost",
  },
  {
    id: "fox",
    name: "Swift Fox",
    emoji: "🦊",
    category: "starter",
    rarity: "common",
    price: 0,
    color: "from-amber-500 to-orange-600",
    borderGlow: "rgba(245, 158, 11, 0.4)",
    description: "Nimble thinker with rapid quiz reaction time.",
    perk: "Quick Answer Animation",
  },
  {
    id: "owl",
    name: "Wise Owl",
    emoji: "🦉",
    category: "starter",
    rarity: "common",
    price: 0,
    color: "from-purple-500 to-violet-600",
    borderGlow: "rgba(168, 85, 247, 0.4)",
    description: "Deep intellect built on meticulous study.",
    perk: "+10 EXP per Quiz",
  },
  {
    id: "robot",
    name: "Cyber Bot",
    emoji: "🤖",
    category: "cyber",
    rarity: "common",
    price: 0,
    color: "from-cyan-500 to-blue-600",
    borderGlow: "rgba(6, 182, 212, 0.4)",
    description: "Precision-engineered logic unit.",
    perk: "Cyber Visual Effects",
  },
  {
    id: "lightning",
    name: "Sparky",
    emoji: "⚡",
    category: "starter",
    rarity: "common",
    price: 0,
    color: "from-yellow-400 to-amber-500",
    borderGlow: "rgba(234, 179, 8, 0.4)",
    description: "High voltage focus and quick reflex solver.",
    perk: "Lightning Streak Trail",
  },
  {
    id: "rocket",
    name: "Astro Jet",
    emoji: "🚀",
    category: "cyber",
    rarity: "common",
    price: 0,
    color: "from-rose-500 to-pink-600",
    borderGlow: "rgba(244, 63, 94, 0.4)",
    description: "Shooting for the moon on every leaderboard.",
    perk: "Orbit Particle Aura",
  },

  // Tier 1 (Common / Unlocked with basic quiz coins)
  {
    id: "ninja",
    name: "Focus Ninja",
    emoji: "🥷",
    category: "mystic",
    rarity: "common",
    price: 100,
    color: "from-slate-700 to-zinc-900",
    borderGlow: "rgba(113, 113, 122, 0.5)",
    description: "Silent, unwavering concentration through every exam.",
    perk: "Stealth Smoke Effect",
  },
  {
    id: "tiger",
    name: "Cyber Tiger",
    emoji: "🐯",
    category: "cyber",
    rarity: "rare",
    price: 180,
    color: "from-orange-500 to-red-600",
    borderGlow: "rgba(249, 115, 22, 0.5)",
    description: "Fierce exam predator that hunts down high marks.",
    perk: "Tiger Roar on Submit",
  },

  // Tier 2 (Rare / Top Finishers)
  {
    id: "wolf",
    name: "Shadow Wolf",
    emoji: "🐺",
    category: "mystic",
    rarity: "rare",
    price: 250,
    color: "from-indigo-600 to-slate-900",
    borderGlow: "rgba(99, 102, 241, 0.5)",
    description: "Solitary master of exams with sharp instincts.",
    perk: "Howling Aura Banner",
  },
  {
    id: "phoenix",
    name: "Golden Phoenix",
    emoji: "🔥",
    category: "mystic",
    rarity: "epic",
    price: 350,
    color: "from-amber-500 via-orange-600 to-red-600",
    borderGlow: "rgba(239, 68, 68, 0.6)",
    description: "Rises victorious even after tough questions.",
    perk: "Blazing Fire Rings",
  },
  {
    id: "dragon",
    name: "Zen Dragon",
    emoji: "🐉",
    category: "mystic",
    rarity: "epic",
    price: 450,
    color: "from-emerald-600 via-teal-600 to-cyan-700",
    borderGlow: "rgba(16, 185, 129, 0.6)",
    description: "Ancient master of wisdom, unshakeable in test trials.",
    perk: "Jade Dragon Waves",
  },

  // Tier 3 (Legendary / Top 1 Podium Champions)
  {
    id: "champion",
    name: "Crown Champion",
    emoji: "👑",
    category: "champion",
    rarity: "legendary",
    price: 500,
    color: "from-yellow-400 via-amber-500 to-yellow-600",
    borderGlow: "rgba(245, 158, 11, 0.8)",
    description: "The official crown for Top 1 Leaderboard conquerors.",
    perk: "Golden Confetti Shower & Royal Crown",
  },
  {
    id: "diamond",
    name: "Diamond Ace",
    emoji: "💎",
    category: "champion",
    rarity: "legendary",
    price: 650,
    color: "from-cyan-400 via-blue-500 to-indigo-600",
    borderGlow: "rgba(6, 182, 212, 0.8)",
    description: "Pure brilliance that shines at the absolute pinnacle.",
    perk: "Prismatic Diamond Shimmer",
  },
];

export interface StudentAvatarData {
  coins: number;
  unlockedAvatars: string[];
  equippedAvatar: string;
  topOneWins: number;
}

export const DEFAULT_STARTER_IDS = ["shield", "fox", "owl", "robot", "lightning", "rocket"];
const AVATAR_IDS = new Set(AVATAR_CATALOG.map((avatar) => avatar.id));

function boundedWholeNumber(value: unknown, fallback: number, maximum = 1_000_000_000) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(0, Math.trunc(value)));
}

export function parseStudentAvatarData(profileImageField: string | null | undefined): StudentAvatarData {
  if (!profileImageField) {
    return {
      coins: 100, // Welcome gift coins!
      unlockedAvatars: DEFAULT_STARTER_IDS,
      equippedAvatar: "shield",
      topOneWins: 0,
    };
  }

  // If already a JSON avatar config string:
  if (profileImageField.startsWith("{") && profileImageField.endsWith("}")) {
    try {
      const parsed: unknown = JSON.parse(profileImageField);
      if (!parsed || typeof parsed !== "object") throw new Error("Invalid legacy avatar data");
      const record = parsed as Record<string, unknown>;
      const purchased = Array.isArray(record.unlockedAvatars)
        ? record.unlockedAvatars.filter(
            (avatarId): avatarId is string => typeof avatarId === "string" && AVATAR_IDS.has(avatarId),
          )
        : [];
      const unlocked = Array.from(new Set([...DEFAULT_STARTER_IDS, ...purchased]));
      const requestedAvatar = typeof record.equippedAvatar === "string" ? record.equippedAvatar : "shield";

      return {
        coins: boundedWholeNumber(record.coins, 100),
        unlockedAvatars: unlocked,
        equippedAvatar: unlocked.includes(requestedAvatar) ? requestedAvatar : "shield",
        topOneWins: boundedWholeNumber(record.topOneWins, 0),
      };
    } catch {
      // Fallback
    }
  }

  // If plain avatar id string (e.g. "fox")
  if (AVATAR_CATALOG.some((a) => a.id === profileImageField)) {
    return {
      coins: 100,
      unlockedAvatars: Array.from(new Set([...DEFAULT_STARTER_IDS, profileImageField])),
      equippedAvatar: profileImageField,
      topOneWins: 0,
    };
  }

  return {
    coins: 100,
    unlockedAvatars: DEFAULT_STARTER_IDS,
    equippedAvatar: "shield",
    topOneWins: 0,
  };
}

export function serializeStudentAvatarData(data: StudentAvatarData): string {
  return JSON.stringify(data);
}

// Calculate coins reward for finishing a quiz based on rank & integrity
export function calculateQuizCoinReward(params: {
  rank: number;
  score: number;
  violationsCount: number;
  isInvalidated: boolean;
  attemptMode?: string;
}): {
  coins: number;
  rankTitle: string;
  isTopOne: boolean;
  breakdown: string[];
} {
  const { rank, score, violationsCount, isInvalidated, attemptMode } = params;
  const isArena = attemptMode === "arena";

  if (!isArena && isInvalidated) {
    return {
      coins: 0,
      rankTitle: "Invalidated Result",
      isTopOne: false,
      breakdown: ["0 coins awarded due to integrity policy violation"],
    };
  }

  let totalCoins = 0;
  const breakdown: string[] = [];
  let isTopOne = false;
  let rankTitle = `Rank #${rank}`;

  if (rank === 1) {
    totalCoins += 250;
    isTopOne = true;
    rankTitle = "🥇 Top 1 Leaderboard Champion";
    breakdown.push("+250 Coins for Top 1 Leaderboard Champion");
  } else if (rank === 2) {
    totalCoins += 150;
    rankTitle = "🥈 Rank 2 Runner-up";
    breakdown.push("+150 Coins for Rank 2");
  } else if (rank === 3) {
    totalCoins += 100;
    rankTitle = "🥉 Rank 3 Bronze Finish";
    breakdown.push("+100 Coins for Rank 3");
  } else if (rank <= 10) {
    totalCoins += 60;
    breakdown.push("+60 Coins for Top 10 Finish");
  } else {
    totalCoins += 40;
    breakdown.push(isArena ? "+40 Coins for Arena Match Completion" : "+40 Coins for Quiz Completion");
  }

  // Performance bonus for high score
  if (score >= 90) {
    totalCoins += 30;
    breakdown.push("+30 Coins for 90%+ Mastery");
  }

  // Clean integrity bonus for proctored or arena match completion bonus
  if (isArena) {
    totalCoins += 25;
    breakdown.push("+25 Coins for Arena Combat Finish");
  } else if (violationsCount === 0) {
    totalCoins += 25;
    breakdown.push("+25 Coins for Zero-Violation Clean Proctor Shield");
  }

  return {
    coins: totalCoins,
    rankTitle,
    isTopOne,
    breakdown,
  };
}
