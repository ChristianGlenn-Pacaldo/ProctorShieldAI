"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Swords,
  Crown,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Copy,
  Check,
  Play,
  Users,
  Gift,
  SkipForward,
  Flame,
  Shield,
  ArrowLeft,
  RotateCcw,
  Bot,
  Trash2,
  Heart,
  Link2,
  AlertCircle,
} from "lucide-react";
import PusherClient from "pusher-js";

interface Choice {
  id: number;
  choiceText: string;
  isCorrect: boolean;
}

interface Question {
  id: number;
  questionText: string;
  points: number;
  choices: Choice[];
}

interface QuizData {
  id: number;
  title: string;
  description: string;
  accessCode: string;
  duration: number;
  passingScore: number;
  subjectName: string;
  subjectCode: string;
  questions: Question[];
}

interface Battler {
  id: string;
  name: string;
  avatar: string;
  hp: number;
  maxHp: number;
  hasShield: boolean;
  score: number;
  streak: number;
  isAi: boolean;
  isAlive: boolean;
  lastAction?: string;
}

interface BattleEvent {
  id: string;
  timestamp: string;
  text: string;
  type: "attack" | "shield" | "airdrop" | "elimination" | "info";
}

interface LiveArenaState {
  status: "active" | "ended";
  currentWave: number;
  currentQuestionId: number;
  waveDuration: number;
  waveStartedAt?: string;
}

interface ArenaHostContentProps {
  quiz: QuizData;
  mode: "battle_royale" | "wave_sprint";
  waveDuration: number;
  coinBounty: number;
  enabledPowers: string[];
  teacherId: string;
}

// Default AI Challenger Pool
const BOT_NAMES = [
  { name: "Nova", avatar: "⚡" },
  { name: "Blaze", avatar: "🔥" },
  { name: "Viper", avatar: "🐉" },
  { name: "Zephyr", avatar: "🌪️" },
  { name: "Apex", avatar: "👑" },
  { name: "Titan", avatar: "🛡️" },
  { name: "Frostbite", avatar: "❄️" },
  { name: "Shadow", avatar: "🥷" },
];

export default function ArenaHostContent({
  quiz,
  mode,
  waveDuration,
  coinBounty,
  enabledPowers,
  teacherId,
}: ArenaHostContentProps) {
  // Arena Phase: 'lobby' | 'wave' | 'intermission' | 'podium'
  const [phase, setPhase] = useState<"lobby" | "wave" | "intermission" | "podium">("lobby");
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<number>(waveDuration);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(true);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [arenaError, setArenaError] = useState("");
  const [isActionPending, setIsActionPending] = useState(false);
  const actionPendingRef = useRef(false);

  // Battlers State
  const [battlers, setBattlers] = useState<Battler[]>([
    {
      id: "bot-1",
      name: "Nova",
      avatar: "⚡",
      hp: 100,
      maxHp: 100,
      hasShield: true,
      score: 0,
      streak: 0,
      isAi: true,
      isAlive: true,
    },
    {
      id: "bot-2",
      name: "Blaze",
      avatar: "🔥",
      hp: 100,
      maxHp: 100,
      hasShield: false,
      score: 0,
      streak: 0,
      isAi: true,
      isAlive: true,
    },
    {
      id: "bot-3",
      name: "Viper",
      avatar: "🐉",
      hp: 100,
      maxHp: 100,
      hasShield: false,
      score: 0,
      streak: 0,
      isAi: true,
      isAlive: true,
    },
  ]);

  // Live Combat Events
  const [battleEvents, setBattleEvents] = useState<BattleEvent[]>([
    {
      id: "ev-0",
      timestamp: "Just now",
      text: "Arena Lobby initialized. Waiting for fighters.",
      type: "info",
    },
  ]);

  // Player Choice Distribution (Live count per choice)
  const [choiceVotes, setChoiceVotes] = useState<Record<number, number>>({});

  // Audio Context Ref
  const audioCtxRef = useRef<AudioContext | null>(null);

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  // Sound Synthesizers
  const playGongSound = () => {
    if (!sfxEnabled) return;
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 1.2);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1.2);
    } catch {
      // Audio fallback
    }
  };

  const playFanfareSound = () => {
    if (!sfxEnabled) return;
    try {
      const ctx = getAudioContext();
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, ctx.currentTime + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.12 + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.12);
        osc.stop(ctx.currentTime + idx * 0.12 + 0.4);
      });
    } catch {
      // Audio fallback
    }
  };

  const playAirdropSound = () => {
    if (!sfxEnabled) return;
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // Audio fallback
    }
  };

  const playJoinChime = () => {
    if (!sfxEnabled) return;
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      // Audio fallback
    }
  };

  const currentQuestionIdRef = useRef(quiz.questions[0]?.id ?? 0);
  useEffect(() => {
    currentQuestionIdRef.current = quiz.questions[currentQuestionIndex]?.id ?? 0;
  }, [currentQuestionIndex, quiz.questions]);

  const handleCombatEvent = useCallback((
    attackerName: string,
    targetName: string,
    power: string,
    attackerId?: string,
    targetId?: string,
  ) => {
    setBattlers((prev) =>
      prev.map((b) => {
        const isTarget = power === "shield"
          ? (targetId ? b.id === targetId : b.name === attackerName)
          : targetId === "all"
            ? (attackerId ? b.id !== attackerId : b.name !== attackerName)
            : (targetId ? b.id === targetId : b.name === targetName);
        if (isTarget && b.isAlive) {
          if (power === "shield") {
            return { ...b, hasShield: true };
          }
          if (b.hasShield) {
            return { ...b, hasShield: false }; // Shield breaks, deflects hit
          }
          // Take damage from attack
          const damage = power === "meteor" ? 25 : power === "earthquake" ? 15 : 10;
          const nextHp = Math.max(0, b.hp - damage);
          return {
            ...b,
            hp: nextHp,
            isAlive: nextHp > 0,
          };
        }
        return b;
      })
    );

    let eventText = "";
    let eventType: BattleEvent["type"] = "attack";

    if (power === "shield") {
      eventText = `🛡️ ${attackerName} raised a Guardian Shield!`;
      eventType = "shield";
    } else if (power === "meteor") {
      eventText = `☄️ ${attackerName} struck ${targetName} with a Meteor (-25 HP)!`;
    } else if (power === "earthquake") {
      eventText = `🌋 ${attackerName} triggered an Earthquake on ${targetName} (-15 HP)!`;
    } else if (power === "blizzard") {
      eventText = `❄️ ${attackerName} froze ${targetName} with Blizzard Frost!`;
    } else {
      eventText = `⚡ ${attackerName} attacked ${targetName}!`;
    }

    setBattleEvents((prev) => [
      {
        id: `ev-${Date.now()}-${Math.random()}`,
        timestamp: "Just now",
        text: eventText,
        type: eventType,
      },
      ...prev.slice(0, 20),
    ]);
  }, []);

  const handleTimeUp = useCallback(() => {
    setIsTimerRunning(false);

    // Real students are scored from validated server answer events. Only bots
    // need a simulated result when the wave closes.
    const currentQ = quiz.questions[currentQuestionIndex];
    const correctChoice = currentQ?.choices.find((c) => c.isCorrect);

    if (correctChoice) {
      setBattlers((prev) =>
        prev.map((b) => {
          if (!b.isAi) return b;
          const isCorrect = Math.random() < 0.75;
          if (isCorrect) {
            const nextStreak = b.streak + 1;
            const pointsAwarded = 100 * nextStreak;
            return {
              ...b,
              score: b.score + pointsAwarded,
              streak: nextStreak,
            };
          }
          return { ...b, streak: 0 };
        })
      );
    }

    setPhase("intermission");
  }, [currentQuestionIndex, quiz.questions]);

  const addParticipant = useCallback((data: { studentId: string; studentName?: string; name?: string; avatar?: string }) => {
    const sId = data.studentId;
    const sName = data.studentName || data.name || "Student Fighter";
    const sAvatar = data.avatar || "🎓";
    if (!sId) return;

    setBattlers((prev) => {
      if (prev.some((b) => b.id === sId)) return prev;
      return [...prev, {
        id: sId,
        name: sName,
        avatar: sAvatar,
        hp: 100,
        maxHp: 100,
        hasShield: false,
        score: 0,
        streak: 0,
        isAi: false,
        isAlive: true,
      }];
    });
  }, []);

  const broadcastArenaAction = async (action: string, payload?: Record<string, unknown>) => {
    if (actionPendingRef.current) return false;
    actionPendingRef.current = true;
    setArenaError("");
    setIsActionPending(true);
    try {
      const response = await fetch(`/api/arena/${quiz.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setArenaError(data.error || "Arena action failed. Please try again.");
        return false;
      }
      return true;
    } catch {
      setArenaError("Network error. The arena action was not delivered.");
      return false;
    } finally {
      actionPendingRef.current = false;
      setIsActionPending(false);
    }
  };

  // Load enrolled students and subscribe only to authenticated channels.
  useEffect(() => {
    void fetch(`/api/arena/${quiz.id}`)
      .then(async (response) => response.ok ? response.json() : null)
      .then((data: { participants?: Array<{ studentId: string; studentName: string; avatar?: string }>; arena?: LiveArenaState | null } | null) => {
        if (Array.isArray(data?.participants)) data.participants.forEach(addParticipant);
        const liveArena = data?.arena;
        if (liveArena?.status === "active") {
          const questionIndex = quiz.questions.findIndex(
            (question) => question.id === liveArena.currentQuestionId,
          );
          const safeIndex = questionIndex >= 0
            ? questionIndex
            : Math.min(Math.max(liveArena.currentWave, 0), Math.max(quiz.questions.length - 1, 0));
          const startedAt = Date.parse(liveArena.waveStartedAt || "");
          const duration = Number.isFinite(liveArena.waveDuration)
            ? liveArena.waveDuration
            : waveDuration;
          const elapsed = Number.isFinite(startedAt)
            ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
            : 0;
          const remaining = Math.max(0, duration - elapsed);
          if (remaining > 0) {
            setCurrentQuestionIndex(safeIndex);
            setTimeLeft(remaining);
            setChoiceVotes({});
            setIsTimerRunning(true);
            setPhase("wave");
          }
        }
      })
      .catch(() => setArenaError("Could not load the current arena participants."));

    const pusher = new PusherClient(
      process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
      {
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1",
        authEndpoint: "/api/pusher/auth",
      },
    );
    const arenaChannel = pusher.subscribe(`private-arena-${quiz.id}`);
    const teacherChannel = pusher.subscribe(`private-teacher-${teacherId}`);

    const handleStudentJoined = (data: { studentId: string; studentName?: string; name?: string; avatar?: string }) => {
      addParticipant(data);
      playJoinChime();
      const displayName = data.studentName || data.name || "A fighter";
      setBattleEvents((prev) => [{
        id: `ev-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        timestamp: "Just now",
        text: `🎮 ${displayName} entered the Arena!`,
        type: "info",
      }, ...prev.slice(0, 20)]);
    };

    arenaChannel.bind("arena-student-joined", handleStudentJoined);
    teacherChannel.bind("arena-student-joined", handleStudentJoined);

    const handleAnswerEvent = (data: {
      studentId: string;
      studentName: string;
      questionId: number;
      choiceId: number;
      isCorrect: boolean;
    }) => {
      if (data.questionId !== currentQuestionIdRef.current) return;
      addParticipant(data);
      setChoiceVotes((prev) => ({ ...prev, [data.choiceId]: (prev[data.choiceId] || 0) + 1 }));
      setBattlers((prev) => prev.map((b) => {
        if (b.id !== data.studentId) return b;
        const nextStreak = data.isCorrect ? b.streak + 1 : 0;
        return {
          ...b,
          streak: nextStreak,
          score: data.isCorrect ? b.score + 100 * nextStreak : b.score,
        };
      }));
    };

    arenaChannel.bind("arena-answer", handleAnswerEvent);
    teacherChannel.bind("arena-answer", handleAnswerEvent);

    const handleAttackEvent = (data: {
      attackerId?: string;
      attackerName: string;
      targetId?: string;
      targetName: string;
      powerType: string;
    }) => handleCombatEvent(
      data.attackerName,
      data.targetName,
      data.powerType,
      data.attackerId,
      data.targetId,
    );

    arenaChannel.bind("battle-attack", handleAttackEvent);
    teacherChannel.bind("battle-attack", handleAttackEvent);

    arenaChannel.bind("arena-start", (data?: { arena?: { waveDuration?: number }; waveDuration?: number }) => {
      setPhase("wave");
      setCurrentQuestionIndex(0);
      setTimeLeft(data?.arena?.waveDuration || data?.waveDuration || waveDuration);
      setIsTimerRunning(true);
      setChoiceVotes({});
    });

    arenaChannel.bind("arena-wave", (data: { waveIndex?: number }) => {
      if (typeof data.waveIndex === "number") {
        setCurrentQuestionIndex(data.waveIndex);
        setTimeLeft(waveDuration);
        setIsTimerRunning(true);
        setChoiceVotes({});
        setPhase("wave");
      }
    });

    arenaChannel.bind("arena-airdrop", () => {
      playAirdropSound();
      setBattlers((prev) =>
        prev.map((b) => ({
          ...b,
          hasShield: true,
          hp: Math.min(b.maxHp, b.hp + 15),
        }))
      );
    });

    arenaChannel.bind("arena-end", () => {
      playFanfareSound();
      setPhase("podium");
    });

    return () => {
      arenaChannel.unbind_all();
      teacherChannel.unbind_all();
      pusher.unsubscribe(`private-arena-${quiz.id}`);
      pusher.unsubscribe(`private-teacher-${teacherId}`);
      pusher.disconnect();
    };
  }, [addParticipant, handleCombatEvent, quiz.id, quiz.questions, teacherId, waveDuration]);

  // Periodic background sync while waiting in lobby so joined students appear seamlessly
  useEffect(() => {
    if (phase !== "lobby") return;
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/arena/${quiz.id}`);
        if (!response.ok) return;
        const data = await response.json();
        if (Array.isArray(data?.participants)) {
          data.participants.forEach(addParticipant);
        }
      } catch {
        // Silently ignore background polling errors
      }
    }, 3500);

    return () => clearInterval(interval);
  }, [phase, quiz.id, addParticipant]);

  useEffect(() => {
    if (phase !== "wave" || !isTimerRunning) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          handleTimeUp();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [handleTimeUp, phase, isTimerRunning]);

  // Bots are optional practice opponents; their votes never overwrite real votes.
  useEffect(() => {
    if (phase !== "wave" || !isTimerRunning) return;
    const currentQ = quiz.questions[currentQuestionIndex];
    if (!currentQ || currentQ.choices.length === 0) return;
    const bots = battlers.filter((b) => b.isAi && b.isAlive);
    const timeout = setTimeout(() => {
      setChoiceVotes((prev) => {
        const next = { ...prev };
        bots.forEach(() => {
          const choice = currentQ.choices[Math.floor(Math.random() * currentQ.choices.length)];
          next[choice.id] = (next[choice.id] || 0) + 1;
        });
        return next;
      });
      if (bots.length >= 2 && enabledPowers.length > 0) {
        const attacker = bots[Math.floor(Math.random() * bots.length)];
        const target = bots.find((b) => b.id !== attacker.id) || bots[0];
        const power = enabledPowers[Math.floor(Math.random() * enabledPowers.length)];
        handleCombatEvent(attacker.name, target.name, power);
      }
    }, Math.min(5_000, Math.max(3_000, waveDuration * 150)));
    return () => clearTimeout(timeout);
  }, [battlers, currentQuestionIndex, enabledPowers, handleCombatEvent, isTimerRunning, phase, quiz.questions, waveDuration]);

  const handleStartMatch = async () => {
    const started = await broadcastArenaAction("start", {
      mode,
      waveDuration,
      coinBounty,
      enabledPowers,
    });
    if (!started) return;
    playGongSound();
    setCurrentQuestionIndex(0);
    setTimeLeft(waveDuration);
    setIsTimerRunning(true);
    setChoiceVotes({});
    setPhase("wave");
  };

  const handleNextWave = async () => {
    if (currentQuestionIndex + 1 < quiz.questions.length) {
      const advanced = await broadcastArenaAction("wave", { waveIndex: currentQuestionIndex + 1 });
      if (!advanced) return;
      playGongSound();
      setCurrentQuestionIndex((prev) => prev + 1);
      setTimeLeft(waveDuration);
      setIsTimerRunning(true);
      setChoiceVotes({});
      setPhase("wave");
    } else {
      await handleEndArena();
    }
  };

  const handleEndArena = async () => {
    if (!(await broadcastArenaAction("end"))) return;
    playFanfareSound();
    setPhase("podium");
  };

  const handleDropAirdrop = async () => {
    if (!(await broadcastArenaAction("airdrop"))) return;
    playAirdropSound();
    setBattlers((prev) =>
      prev.map((b) => ({
        ...b,
        hasShield: true,
        hp: Math.min(b.maxHp, b.hp + 15),
      }))
    );
    setBattleEvents((prev) => [
      {
        id: `ev-${Date.now()}`,
        timestamp: "Just now",
        text: `🎁 HOST AIRDROP DELIVERED! All battlers granted Shields and +15 HP!`,
        type: "airdrop",
      },
      ...prev.slice(0, 20),
    ]);
  };

  const handleAddBot = () => {
    const available = BOT_NAMES.filter((b) => !battlers.some((x) => x.name === b.name));
    if (available.length === 0) return;
    const bot = available[0];
    setBattlers((prev) => [
      ...prev,
      {
        id: `bot-${Date.now()}`,
        name: bot.name,
        avatar: bot.avatar,
        hp: 100,
        maxHp: 100,
        hasShield: false,
        score: 0,
        streak: 0,
        isAi: true,
        isAlive: true,
      },
    ]);
  };

  const handleClearBots = () => {
    setBattlers((prev) => prev.filter((b) => !b.isAi));
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(quiz.accessCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  const handleCopyLink = () => {
    const url = `${window.location.origin}/join?code=${quiz.accessCode}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const sortedLeaderboard = [...battlers].sort((a, b) => b.score - a.score);
  const podiumLeaderboard = sortedLeaderboard.filter((battler) => !battler.isAi);
  const currentQ = quiz.questions[currentQuestionIndex];

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col font-sans select-none overflow-x-hidden">
      {/* ─────────────────────────────────────────────────────────────
          ARENA PROJECTOR TOPBAR
      ───────────────────────────────────────────────────────────── */}
      <header className="h-16 px-4 sm:px-8 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/teacher/playground"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
            title="Exit Arena"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center text-slate-950 font-black shadow-sm">
              <Swords className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-black tracking-tight text-white flex items-center gap-2">
                <span>{quiz.title}</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-[10px] font-extrabold uppercase">
                  PROCTORSHIELD ARENA
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                {quiz.subjectName} • {battlers.length} Battlers
              </div>
            </div>
          </div>
        </div>

        {/* Join PIN Pill for Classroom Display */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700">
            <span className="text-[11px] font-bold text-slate-400">JOIN CODE:</span>
            <span className="text-sm font-mono font-black text-amber-400 tracking-wider">
              {quiz.accessCode}
            </span>
            <button
              onClick={handleCopyCode}
              className="p-1 rounded-md hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
              title="Copy Code"
              aria-label="Copy Code"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={handleCopyLink}
              className="p-1 rounded-md hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
              title="Copy Link"
              aria-label="Copy Link"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Link2 className="w-3.5 h-3.5" />}
            </button>
          </div>

          <button
            onClick={() => setSfxEnabled(!sfxEnabled)}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
            title={sfxEnabled ? "Mute Audio" : "Unmute Audio"}
          >
            {sfxEnabled ? <Volume2 className="w-5 h-5 text-amber-400" /> : <VolumeX className="w-5 h-5" />}
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
            title="Toggle Projector Fullscreen"
          >
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {arenaError && (
        <div role="alert" className="mx-4 mt-3 rounded-xl border border-rose-500/50 bg-rose-950/80 px-4 py-3 text-sm font-semibold text-rose-100">
          {arenaError}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          PHASE 1: LOBBY (WAITING FOR PLAYERS)
      ───────────────────────────────────────────────────────────── */}
      {phase === "lobby" && (
        <main className="flex-1 p-6 sm:p-12 flex flex-col justify-between max-w-6xl mx-auto w-full space-y-8">
          {/* Instructions Showcase */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-bold tracking-wider uppercase">
              <Users className="w-4 h-4" />
              LOBBY OPEN • READY TO FIGHT
            </div>
            <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tight font-[family-name:var(--font-display)]">
              Join the ProctorShield Arena
            </h1>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-base sm:text-xl text-slate-300 pt-2">
              <span>1. Go to <strong className="text-white font-mono underline decoration-amber-400">/join</strong></span>
              <span className="text-slate-600 hidden sm:inline">•</span>
              <span>2. Enter PIN: <strong className="text-amber-400 font-mono text-2xl font-black">{quiz.accessCode}</strong></span>
            </div>
          </div>

          {/* Battler Cards Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-400 px-1">
              <span>FIGHTERS READY ({battlers.length})</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAddBot}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-all cursor-pointer"
                >
                  <Bot className="w-3.5 h-3.5 text-blue-400" />
                  + Add AI Challenger
                </button>
                {battlers.some((b) => b.isAi) && (
                  <button
                    onClick={handleClearBots}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 text-xs transition-all cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear Bots
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 min-h-40">
              {battlers.map((b) => (
                <div
                  key={b.id}
                  className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col items-center text-center space-y-2 animate-in zoom-in-95 duration-200"
                >
                  <div className="w-12 h-12 rounded-full bg-slate-800 border-2 border-amber-400/40 flex items-center justify-center text-2xl shadow-inner">
                    {b.avatar}
                  </div>
                  <div className="font-bold text-xs text-white truncate max-w-full">
                    {b.name}
                  </div>
                  <div className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    READY
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Lobby Actions */}
          <div className="flex flex-col items-center justify-center gap-4 pt-6 border-t border-slate-800">
            {arenaError && (
              <div
                role="alert"
                className="w-full max-w-xl mx-auto rounded-xl border border-rose-500/50 bg-rose-950/90 px-4 py-3 text-sm font-semibold text-rose-200 flex items-center justify-center gap-2 shadow-lg animate-in fade-in"
              >
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{arenaError}</span>
              </div>
            )}
            <button
              onClick={handleStartMatch}
              disabled={battlers.length === 0 || isActionPending}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-10 py-5 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-500 text-slate-950 font-black text-lg shadow-xl shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all cursor-pointer"
            >
              {isActionPending ? (
                <>
                  <span className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  Starting Arena...
                </>
              ) : (
                <>
                  <Swords className="w-6 h-6 text-slate-950" />
                  Start Arena Match ({quiz.questions.length} Waves)
                </>
              )}
            </button>
          </div>
        </main>
      )}

      {/* ─────────────────────────────────────────────────────────────
          PHASE 2: QUESTION WAVE (ACTIVE BATTLE)
      ───────────────────────────────────────────────────────────── */}
      {phase === "wave" && currentQ && (
        <main className="flex-1 p-4 sm:p-8 flex flex-col lg:flex-row gap-6 max-w-7xl mx-auto w-full">
          {/* Left: Big Projector Question & Choices */}
          <div className="flex-1 flex flex-col justify-between space-y-6">
            {/* Wave Header & Timer */}
            <div className="flex items-center justify-between bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
              <div className="space-y-1">
                <span className="px-2.5 py-1 rounded-md bg-amber-400/20 text-amber-300 text-xs font-black uppercase">
                  WAVE {currentQuestionIndex + 1} OF {quiz.questions.length}
                </span>
                <div className="text-xs text-slate-400">
                  Worth {currentQ.points * 100} Points
                </div>
              </div>

              {/* Live Countdown Ring */}
              <div className="flex items-center gap-3">
                <div
                  className={`text-3xl sm:text-4xl font-mono font-black ${
                    timeLeft <= 5 ? "text-rose-400 animate-ping" : "text-amber-400"
                  }`}
                >
                  {timeLeft}s
                </div>
              </div>
            </div>

            {/* Question Text */}
            <div className="p-6 sm:p-10 rounded-3xl bg-slate-900 border-2 border-slate-800 shadow-xl min-h-48 flex items-center justify-center text-center">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-white leading-tight font-[family-name:var(--font-display)]">
                {currentQ.questionText}
              </h2>
            </div>

            {/* Choices Grid with Live Vote Counters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {currentQ.choices.map((choice, idx) => {
                const colors = [
                  "border-rose-500/40 bg-rose-950/20 text-rose-200",
                  "border-blue-500/40 bg-blue-950/20 text-blue-200",
                  "border-amber-500/40 bg-amber-950/20 text-amber-200",
                  "border-emerald-500/40 bg-emerald-950/20 text-emerald-200",
                ];
                const badgeLetters = ["A", "B", "C", "D"];
                const votes = choiceVotes[choice.id] || 0;

                return (
                  <div
                    key={choice.id}
                    className={`p-4 sm:p-5 rounded-2xl border-2 flex items-center justify-between ${
                      colors[idx % colors.length]
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center font-black text-white text-sm">
                        {badgeLetters[idx]}
                      </span>
                      <span className="font-bold text-sm sm:text-base text-white">
                        {choice.choiceText}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/80 text-xs font-bold text-slate-300">
                      <Users className="w-3 h-3 text-slate-400" />
                      {votes}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Host Wave Controls */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                onClick={handleDropAirdrop}
                disabled={isActionPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
              >
                <Gift className="w-4 h-4" />
                Drop Airdrop 🎁
              </button>

              <button
                onClick={handleTimeUp}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs transition-all cursor-pointer"
              >
                <SkipForward className="w-4 h-4" />
                Reveal Answer ⏭️
              </button>
            </div>
          </div>

          {/* Right: Live Battle Telemetry & Telemetry Feed */}
          <div className="w-full lg:w-80 flex flex-col gap-4">
            {/* Battlers HP & Shield Status */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
              <div className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>ARENA FIGHTERS</span>
                <span className="text-amber-400">{battlers.filter((b) => b.isAlive).length} Alive</span>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {battlers.map((b) => (
                  <div
                    key={b.id}
                    className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
                      b.isAlive
                        ? "bg-slate-950 border-slate-800"
                        : "bg-rose-950/20 border-rose-900/40 opacity-50"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg">{b.avatar}</span>
                      <div className="min-w-0">
                        <div className="font-bold text-white truncate text-[11px]">
                          {b.name}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                          <span>{b.score} pts</span>
                          {b.streak > 1 && (
                            <span className="text-amber-400 font-bold">🔥x{b.streak}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* HP Bar */}
                    <div className="w-20 space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="text-rose-400 flex items-center gap-0.5">
                          <Heart className="w-2.5 h-2.5 fill-rose-500" /> {b.hp}
                        </span>
                        {b.hasShield && <Shield className="w-3 h-3 text-blue-400 fill-blue-400/20" />}
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            b.hp > 50 ? "bg-emerald-400" : b.hp > 25 ? "bg-amber-400" : "bg-rose-500"
                          }`}
                          style={{ width: `${(b.hp / b.maxHp) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Real-Time Combat Event Feed */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5 flex-1 flex flex-col">
              <div className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                Live Combat Feed
              </div>
              <div className="flex-1 max-h-56 overflow-y-auto space-y-2 text-xs text-slate-300 pr-1">
                {battleEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-2 rounded-lg bg-slate-950 border border-slate-800/80 text-[11px] leading-relaxed animate-in fade-in slide-in-from-top-1 duration-150"
                  >
                    {ev.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      )}

      {/* ─────────────────────────────────────────────────────────────
          PHASE 3: INTERMISSION & WAVE LEADERBOARD
      ───────────────────────────────────────────────────────────── */}
      {phase === "intermission" && currentQ && (
        <main className="flex-1 p-6 sm:p-12 flex flex-col justify-between max-w-4xl mx-auto w-full space-y-6">
          <div className="text-center space-y-2">
            <span className="px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-black uppercase">
              WAVE {currentQuestionIndex + 1} COMPLETE
            </span>
            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight font-[family-name:var(--font-display)]">
              Wave Leaderboard
            </h2>
            <div className="text-sm text-slate-400">
              Correct Answer:{" "}
              <span className="text-emerald-400 font-bold">
                {currentQ.choices.find((c) => c.isCorrect)?.choiceText}
              </span>
            </div>
          </div>

          {/* Leaderboard Table */}
          <div className="rounded-3xl bg-slate-900 border border-slate-800 overflow-hidden shadow-2xl">
            <div className="p-4 bg-slate-800/60 border-b border-slate-800 flex items-center justify-between text-xs font-bold text-slate-400 px-6">
              <span>RANK & BATTLER</span>
              <span>SCORE & STREAK</span>
            </div>
            <div className="divide-y divide-slate-800/80">
              {sortedLeaderboard.map((b, idx) => (
                <div
                  key={b.id}
                  className={`p-4 px-6 flex items-center justify-between transition-all ${
                    idx === 0
                      ? "bg-amber-400/10"
                      : idx === 1
                      ? "bg-slate-800/30"
                      : idx === 2
                      ? "bg-amber-700/10"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${
                        idx === 0
                          ? "bg-amber-400 text-slate-950 shadow-md"
                          : idx === 1
                          ? "bg-slate-300 text-slate-950"
                          : idx === 2
                          ? "bg-amber-700 text-white"
                          : "text-slate-500 font-mono"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span className="text-xl">{b.avatar}</span>
                    <span className="font-bold text-white text-sm sm:text-base">
                      {b.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-4">
                    {b.streak > 1 && (
                      <span className="text-xs font-bold text-amber-400">
                        🔥 x{b.streak}
                      </span>
                    )}
                    <span className="font-mono font-black text-white text-base sm:text-lg">
                      {b.score} <span className="text-xs text-slate-400 font-normal">pts</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Next Wave Button */}
          <div className="flex justify-center pt-4">
            <button
              onClick={handleNextWave}
              disabled={isActionPending}
              className="inline-flex items-center justify-center gap-2.5 px-10 py-4 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-400 text-slate-950 font-black text-base shadow-xl shadow-amber-400/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
            >
              {currentQuestionIndex + 1 < quiz.questions.length ? (
                <>
                  <Play className="w-5 h-5 fill-slate-950" />
                  Next Wave ({currentQuestionIndex + 2} / {quiz.questions.length})
                </>
              ) : (
                <>
                  <Crown className="w-5 h-5 text-slate-950" />
                  Grand Championship Podium 🏁
                </>
              )}
            </button>
          </div>
        </main>
      )}

      {/* ─────────────────────────────────────────────────────────────
          PHASE 4: GRAND CHAMPIONSHIP PODIUM
      ───────────────────────────────────────────────────────────── */}
      {phase === "podium" && (
        <main className="flex-1 p-6 sm:p-12 flex flex-col justify-between max-w-4xl mx-auto w-full space-y-8 animate-in zoom-in-95 duration-300">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-400/20 border border-amber-400/30 text-amber-300 text-xs font-extrabold uppercase tracking-wider">
              <Crown className="w-4 h-4 text-amber-400" />
              ARENA MATCH FINISHED
            </div>
            <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tight font-[family-name:var(--font-display)]">
              Championship Podium
            </h1>
            <p className="text-sm sm:text-base text-slate-400">
              Prizes awarded to top battlers to spend in the Avatar Shop.
            </p>
          </div>

          {/* 3D Podium Display */}
          <div className="flex items-end justify-center gap-3 sm:gap-6 pt-12 pb-6">
            {podiumLeaderboard.length === 0 && (
              <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-6 py-8 text-center text-sm text-slate-300">
                No eligible student submission was available, so no coin bounty was awarded.
              </div>
            )}
            {/* 2nd Place */}
            {podiumLeaderboard[1] && (
              <div className="flex flex-col items-center space-y-2 w-28 sm:w-36">
                <div className="text-2xl sm:text-4xl">{podiumLeaderboard[1].avatar}</div>
                <div className="font-bold text-xs sm:text-sm text-white truncate max-w-full">
                  {podiumLeaderboard[1].name}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  {podiumLeaderboard[1].score} pts
                </div>
                <div className="w-full h-32 sm:h-40 rounded-t-2xl bg-gradient-to-b from-slate-700 to-slate-900 border-2 border-slate-600 flex flex-col items-center justify-center p-2 shadow-xl">
                  <span className="text-2xl font-black text-slate-300">2nd</span>
                  <span className="text-[11px] font-bold text-amber-300 mt-1">
                    +{Math.round(coinBounty * 0.6)} 🪙
                  </span>
                </div>
              </div>
            )}

            {/* 1st Place Champion */}
            {podiumLeaderboard[0] && (
              <div className="flex flex-col items-center space-y-2 w-32 sm:w-44 -mt-8">
                <div className="relative">
                  <Crown className="w-8 h-8 text-amber-400 absolute -top-8 left-1/2 -translate-x-1/2 animate-bounce" />
                  <div className="text-4xl sm:text-6xl">{podiumLeaderboard[0].avatar}</div>
                </div>
                <div className="font-black text-sm sm:text-base text-amber-300 truncate max-w-full">
                  {podiumLeaderboard[0].name}
                </div>
                <div className="text-xs text-amber-200/80 font-mono font-bold">
                  {podiumLeaderboard[0].score} pts
                </div>
                <div className="w-full h-44 sm:h-56 rounded-t-2xl bg-gradient-to-b from-amber-400 via-yellow-500 to-amber-600 border-2 border-amber-300 flex flex-col items-center justify-center p-2 shadow-2xl shadow-amber-500/30">
                  <span className="text-3xl font-black text-slate-950">1st</span>
                  <span className="text-xs font-black text-slate-950 mt-1 bg-white/60 px-2 py-0.5 rounded-full">
                    +{coinBounty} 🪙
                  </span>
                </div>
              </div>
            )}

            {/* 3rd Place */}
            {podiumLeaderboard[2] && (
              <div className="flex flex-col items-center space-y-2 w-28 sm:w-36">
                <div className="text-2xl sm:text-4xl">{podiumLeaderboard[2].avatar}</div>
                <div className="font-bold text-xs sm:text-sm text-white truncate max-w-full">
                  {podiumLeaderboard[2].name}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  {podiumLeaderboard[2].score} pts
                </div>
                <div className="w-full h-24 sm:h-32 rounded-t-2xl bg-gradient-to-b from-amber-800 to-amber-950 border-2 border-amber-700 flex flex-col items-center justify-center p-2 shadow-xl">
                  <span className="text-2xl font-black text-amber-200">3rd</span>
                  <span className="text-[11px] font-bold text-amber-300 mt-1">
                    +{Math.round(coinBounty * 0.4)} 🪙
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6 border-t border-slate-800">
            <button
              onClick={() => {
                void broadcastArenaAction("reset");
                setPhase("lobby");
                setCurrentQuestionIndex(0);
                setTimeLeft(waveDuration);
                setIsTimerRunning(false);
                setChoiceVotes({});
                setBattlers((prev) =>
                  prev.map((b) => ({ ...b, hp: 100, score: 0, streak: 0, isAlive: true, hasShield: false }))
                );
              }}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-all cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Play Again
            </button>

            <Link
              href="/dashboard/teacher/playground"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-black text-sm shadow-md transition-all cursor-pointer"
            >
              Exit to Playground Studio
            </Link>
          </div>
        </main>
      )}
    </div>
  );
}
