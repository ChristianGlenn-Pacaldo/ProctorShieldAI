// Web Audio API lightweight sound effects and gamification helpers for ProctorShieldAI

export const MASCOTS = [
  { id: "shield", name: "Guardian Shield", emoji: "🛡️", color: "from-blue-500 to-indigo-600", desc: "Integrity Specialist" },
  { id: "fox", name: "Swift Fox", emoji: "🦊", color: "from-amber-500 to-orange-600", desc: "Quick Thinker" },
  { id: "owl", name: "Wise Owl", emoji: "🦉", color: "from-purple-500 to-violet-600", desc: "Deep Knowledge" },
  { id: "robot", name: "Cyber Bot", emoji: "🤖", color: "from-cyan-500 to-blue-600", desc: "AI Powered" },
  { id: "lightning", name: "Sparky", emoji: "⚡", color: "from-yellow-400 to-amber-500", desc: "Speed Master" },
  { id: "rocket", name: "Astro Jet", emoji: "🚀", color: "from-rose-500 to-pink-600", desc: "Sky High Scorer" },
];

export const ACHIEVEMENTS = [
  { id: "clean_shield", title: "Iron Shield", desc: "Completed a quiz with 100% clean AI proctor record", icon: "🛡️", unlocked: true },
  { id: "focus_streak", title: "Focus Beast", desc: "Maintained a 3+ day quiz activity streak", icon: "🔥", unlocked: true },
  { id: "high_scorer", title: "Century Master", desc: "Achieved 90%+ score on an exam", icon: "⭐", unlocked: true },
  { id: "speed_demon", title: "Swift Reflexes", desc: "Submitted quiz in the top 20% fastest time", icon: "⚡", unlocked: false },
  { id: "early_bird", title: "Front Row Cadet", desc: "Joined quiz room before starting bell", icon: "🎯", unlocked: true },
  { id: "unshakable", title: "Zen Prodigy", desc: "Zero tab switches or face deviations recorded", icon: "🧘", unlocked: false },
];

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass();
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const saved = localStorage.getItem("proctor_sfx_enabled");
  return saved === null ? true : saved === "true";
}

export function toggleSoundEnabled(): boolean {
  const current = isSoundEnabled();
  const next = !current;
  if (typeof window !== "undefined") {
    localStorage.setItem("proctor_sfx_enabled", String(next));
  }
  return next;
}

export function playBloop(frequency = 520, duration = 0.07): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(frequency * 1.5, ctx.currentTime + duration);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Audio context may be restricted before user interaction
  }
}

export function playSuccessFanfare(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const notes = [440, 554.37, 659.25, 880]; // A major chord arpeggio
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startTime = ctx.currentTime + idx * 0.08;
      const duration = 0.25;

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.1, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    });
  } catch {
    // Ignore audio playback failure
  }
}

export function playErrorBuzz(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(160, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(120, ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    // Ignore audio playback failure
  }
}

export function calculateStudentLevel(completedQuizzesCount: number, avgScore: number) {
  const baseXP = completedQuizzesCount * 180 + Math.round(avgScore * 4);
  const xpPerLevel = 500;
  const level = Math.max(1, Math.floor(baseXP / xpPerLevel) + 1);
  const currentLevelXP = baseXP % xpPerLevel;
  const progressPercent = Math.min(100, Math.round((currentLevelXP / xpPerLevel) * 100));

  const titles = [
    "Novice Cadet",
    "Quiz Runner",
    "Focus Adept",
    "Shield Scholar",
    "Grand Sentinel",
    "Legendary Proctor",
  ];
  const title = titles[Math.min(titles.length - 1, level - 1)];

  return {
    level,
    title,
    totalXP: baseXP,
    currentLevelXP,
    xpPerLevel,
    progressPercent,
  };
}
