// Battle Power Arena engine & audio synthesizers for ProctorShieldAI

export type BattlePowerType = "meteor" | "earthquake" | "blizzard" | "shield";

export interface BattlePower {
  id: BattlePowerType;
  name: string;
  emoji: string;
  type: "attack" | "defense" | "special";
  title: string;
  description: string;
  color: string;
  border: string;
  badge: string;
}

export const BATTLE_POWERS: BattlePower[] = [
  {
    id: "meteor",
    name: "Meteor Strike",
    emoji: "☄️",
    type: "attack",
    title: "Blazing Meteor Storm",
    description: "Rains blazing meteors down on a rival's screen to shake and obstruct their desk!",
    color: "from-rose-600 via-orange-600 to-amber-600",
    border: "rgba(239, 68, 68, 0.6)",
    badge: "ATTACK",
  },
  {
    id: "earthquake",
    name: "Earthquake Tremor",
    emoji: "🌋",
    type: "attack",
    title: "Seismic Ground Rumble",
    description: "Triggers a violent seismic tremor that rumbles and vibrates the rival's quiz arena!",
    color: "from-amber-600 via-yellow-600 to-stone-800",
    border: "rgba(217, 119, 6, 0.6)",
    badge: "ATTACK",
  },
  {
    id: "blizzard",
    name: "Blizzard Frost",
    emoji: "❄️",
    type: "attack",
    title: "Glacial Deep Freeze",
    description: "Freezes the opponent's view in crackling ice frost crystals for 4 seconds!",
    color: "from-cyan-500 via-blue-600 to-indigo-700",
    border: "rgba(6, 182, 212, 0.6)",
    badge: "ATTACK",
  },
  {
    id: "shield",
    name: "Guardian Shield",
    emoji: "🛡️",
    type: "defense",
    title: "Absolute Integrity Barrier",
    description: "Deploys a glowing energy barrier that completely deflects the next incoming attack!",
    color: "from-indigo-600 via-violet-600 to-blue-700",
    border: "rgba(99, 102, 241, 0.8)",
    badge: "DEFENSE",
  },
];

export interface QuizRival {
  id: string;
  name: string;
  emoji: string;
  score: number;
  isBot?: boolean;
}

export const DEFAULT_RIVALS: QuizRival[] = [
  { id: "rival_fox", name: "Alex (Swift Fox)", emoji: "🦊", score: 88, isBot: true },
  { id: "rival_bot", name: "Jordan (Cyber Bot)", emoji: "🤖", score: 92, isBot: true },
  { id: "rival_owl", name: "Taylor (Wise Owl)", emoji: "🦉", score: 85, isBot: true },
  { id: "rival_sparky", name: "Morgan (Sparky)", emoji: "⚡", score: 79, isBot: true },
];

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
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

// ☄️ Meteor Strike Sound (Deep rumbling explosion with whistle)
export function playMeteorSound(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    // Whistle descent
    const whistle = ctx.createOscillator();
    const whistleGain = ctx.createGain();
    whistle.type = "sawtooth";
    whistle.frequency.setValueAtTime(880, ctx.currentTime);
    whistle.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.35);

    whistleGain.gain.setValueAtTime(0.08, ctx.currentTime);
    whistleGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    whistle.connect(whistleGain);
    whistleGain.connect(ctx.destination);
    whistle.start();
    whistle.stop(ctx.currentTime + 0.35);

    // Boom impact
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = "triangle";
    boom.frequency.setValueAtTime(120, ctx.currentTime + 0.28);
    boom.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.75);

    boomGain.gain.setValueAtTime(0.2, ctx.currentTime + 0.28);
    boomGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75);

    boom.connect(boomGain);
    boomGain.connect(ctx.destination);
    boom.start(ctx.currentTime + 0.28);
    boom.stop(ctx.currentTime + 0.75);
  } catch {}
}

// 🌋 Earthquake Sound (Subterranean rumbling oscillation)
export function playEarthquakeSound(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(65, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(45, ctx.currentTime + 0.6);
    osc.frequency.linearRampToValueAtTime(35, ctx.currentTime + 1.2);

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.2);
  } catch {}
}

// 🛡️ Guardian Shield Deflection Sound (Crisp metallic energy chime)
export function playShieldDeflectSound(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const freqs = [784, 1046, 1318, 1568]; // G-C-E-G high chime
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.04;
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, start);

      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch {}
}

// ❄️ Blizzard Sound (Freezing wind whoosh)
export function playBlizzardSound(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(320, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(680, ctx.currentTime + 0.3);
    osc.frequency.linearRampToValueAtTime(240, ctx.currentTime + 0.8);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  } catch {}
}
