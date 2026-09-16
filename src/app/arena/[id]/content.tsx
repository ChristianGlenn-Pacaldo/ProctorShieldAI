"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import PusherClient from "pusher-js";
import {
  Flame,
  Zap,
  Clock,
  Volume2,
  VolumeX,
  Shield,
  Sparkles,
  Trophy,
  Swords,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Users,
  Radio,
  Gamepad2,
  Heart,
  X,
  Crosshair,
} from "lucide-react";
import {
  playMeteorSound,
  playEarthquakeSound,
  playShieldDeflectSound,
  playBlizzardSound,
  type BattlePowerType,
} from "@/lib/student-battle";
import { ArenaBattleDock } from "@/components/arena/arena-battle-dock";
import { ArenaPodium, type PodiumParticipant } from "@/components/arena/arena-podium";
import type { ArenaState, PlayerHealth } from "@/lib/arena";

interface Choice {
  id: number;
  choiceText: string;
}

interface Question {
  id: number;
  questionText: string;
  points: number;
  choices: Choice[];
}

interface SavedAnswer {
  questionId: number;
  choiceId: number;
  isCorrect: boolean;
}

interface ArenaContentProps {
  quizId: number;
  quizTitle: string;
  subjectName: string;
  teacherId: string;
  questions: Question[];
  studentId: string;
  studentName: string;
  studentQuizId: string;
  initialQuizStatus: string;
  initialStudentStatus: string;
  savedAnswers: SavedAnswer[];
}

interface RivalPlayer {
  studentId: string;
  studentName: string;
  avatar: string;
  currentHp: number;
  maxHp: number;
  isAlive: boolean;
  hasShield: boolean;
}

interface IncomingAttackAlert {
  attackId: string;
  attackerId: string;
  attackerName: string;
  targetStudentId?: string;
  targetName?: string;
  powerType: string;
  damage: number;
  warningExpiry: string;
  reactionWindowMs: number;
}

export function ArenaContent({
  quizId,
  quizTitle,
  subjectName,
  teacherId,
  questions,
  studentId,
  studentName,
  studentQuizId,
  initialQuizStatus,
  initialStudentStatus,
  savedAnswers,
}: ArenaContentProps) {
  const router = useRouter();

  // ── Match Phase ──────────────────────────────────────────────
  const [phase, setPhase] = useState<"lobby" | "in_wave" | "podium">(
    initialQuizStatus === "in_progress" ? "in_wave" : initialQuizStatus === "ended" ? "podium" : "lobby"
  );

  // ── Questions & Waves ─────────────────────────────────────────
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [waveTimeLeft, setWaveTimeLeft] = useState(30);
  const [waveDuration, setWaveDuration] = useState(30);

  // ── Health & Rivals State ─────────────────────────────────────
  const [myHp, setMyHp] = useState<number>(100);
  const [myMaxHp, setMyMaxHp] = useState<number>(100);
  const [isMyAlive, setIsMyAlive] = useState<boolean>(true);
  const [rivals, setRivals] = useState<RivalPlayer[]>([]);
  const [targetPickerPower, setTargetPickerPower] = useState<BattlePowerType | null>(null);
  const [incomingAttack, setIncomingAttack] = useState<IncomingAttackAlert | null>(null);
  const [reactionTimeLeftMs, setReactionTimeLeftMs] = useState<number>(0);

  // ── Answers & Scoring ─────────────────────────────────────────
  const [lockedAnswers, setLockedAnswers] = useState<Map<number, { choiceId: number; isCorrect: boolean }>>(() => {
    const map = new Map<number, { choiceId: number; isCorrect: boolean }>();
    savedAnswers.forEach((ans) => {
      map.set(ans.questionId, { choiceId: ans.choiceId, isCorrect: ans.isCorrect });
    });
    return map;
  });
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [score, setScore] = useState(() => {
    return savedAnswers.reduce((sum, ans) => {
      if (!ans.isCorrect) return sum;
      const q = questions.find((item) => item.id === ans.questionId);
      return sum + (q?.points || 100);
    }, 0);
  });
  const [streak, setStreak] = useState(0);
  const [highestStreak, setHighestStreak] = useState(0);
  const [coinsEarned, setCoinsEarned] = useState(0);

  // ── Battle Arsenal & Defenses ─────────────────────────────────
  const [hasGuardianShield, setHasGuardianShield] = useState(false);
  const hasGuardianShieldRef = useRef(false);
  useEffect(() => {
    hasGuardianShieldRef.current = hasGuardianShield;
  }, [hasGuardianShield]);

  const [battlePowerInventory, setBattlePowerInventory] = useState<Record<string, boolean>>({
    meteor: false,
    earthquake: false,
    blizzard: false,
    shield: false,
  });
  const [isLaunchingPower, setIsLaunchingPower] = useState<string | null>(null);
  const [enabledPowers, setEnabledPowers] = useState<string[]>(["meteor", "earthquake", "blizzard", "shield"]);

  // ── Attack Animations & Overlays ──────────────────────────────
  const [activeAttackEffect, setActiveAttackEffect] = useState<{
    type: "meteor" | "earthquake" | "blizzard" | "deflected";
    attackerName: string;
    message: string;
  } | null>(null);
  const [celebrationMessage, setCelebrationMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Sound & Audio ─────────────────────────────────────────────
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const getAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;
    try {
      if (!audioCtxRef.current) {
        const AudioClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioClass) audioCtxRef.current = new AudioClass();
      }
      if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
        void audioCtxRef.current.resume();
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  const playFeedbackChime = useCallback((correct: boolean) => {
    if (!soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      if (correct) {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
          gain.gain.setValueAtTime(0.12, ctx.currentTime + idx * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.3);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + idx * 0.08);
          osc.stop(ctx.currentTime + idx * 0.08 + 0.3);
        });
      } else {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(160, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch {}
  }, [soundEnabled, getAudioContext]);

  // ── Podium & Leaderboard ──────────────────────────────────────
  const [podium, setPodium] = useState<PodiumParticipant[]>([]);
  const [allParticipants, setAllParticipants] = useState<PodiumParticipant[]>([]);
  const [studentRank, setStudentRank] = useState(1);

  // ── Health Synchronization ────────────────────────────────────
  const syncPlayerHealth = useCallback((playerHealth?: Record<string, PlayerHealth>) => {
    if (!playerHealth) return;
    const me = playerHealth[studentId];
    if (me) {
      if (typeof me.currentHp === "number") setMyHp(me.currentHp);
      if (typeof me.maxHp === "number") setMyMaxHp(me.maxHp);
      if (typeof me.isAlive === "boolean") setIsMyAlive(me.isAlive);
      if (typeof me.hasShield === "boolean") {
        setHasGuardianShield(me.hasShield);
        hasGuardianShieldRef.current = me.hasShield;
      }
    }
    setRivals((prev) => {
      return prev.map((r) => {
        const updated = playerHealth[r.studentId];
        if (updated) {
          return {
            ...r,
            currentHp: typeof updated.currentHp === "number" ? updated.currentHp : r.currentHp,
            maxHp: typeof updated.maxHp === "number" ? updated.maxHp : r.maxHp,
            isAlive: typeof updated.isAlive === "boolean" ? updated.isAlive : r.isAlive,
            hasShield: typeof updated.hasShield === "boolean" ? updated.hasShield : r.hasShield,
          };
        }
        return r;
      });
    });
  }, [studentId]);

  // ── Conclude Match & Finalize Results ─────────────────────────
  const finalizeMatch = useCallback(async () => {
    setIncomingAttack(null);
    setTargetPickerPower(null);
    setIsLaunchingPower(null);
    setPhase("podium");

    try {
      const answerPayload: Record<number, number> = {};
      lockedAnswers.forEach((val, qId) => {
        answerPayload[qId] = val.choiceId;
      });

      const submitRes = await fetch("/api/quizzes/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId,
          answers: answerPayload,
        }),
      });
      const submitData = await submitRes.json();
      if (submitData?.success) {
        if (typeof submitData.coinsEarned === "number") {
          setCoinsEarned(submitData.coinsEarned);
        }
        if (typeof submitData.rank === "number") {
          setStudentRank(submitData.rank);
        }
      }
    } catch {}

    try {
      const arenaRes = await fetch(`/api/arena/${quizId}`);
      if (arenaRes.ok) {
        const arenaData = await arenaRes.json();
        if (Array.isArray(arenaData?.participants)) {
          const list: PodiumParticipant[] = arenaData.participants.map(
            (p: { studentId: string; studentName: string; avatar?: string }, idx: number) => ({
              studentId: p.studentId,
              studentName: p.studentName,
              avatar: p.avatar || "🎓",
              score: p.studentId === studentId ? score : Math.max(50, 100 * (idx + 1)),
              rank: idx + 1,
            })
          );
          setAllParticipants(list);
          setPodium(list.slice(0, 3));
        }
      }
    } catch {}
  }, [quizId, lockedAnswers, studentId, score]);

  // ── Fetch Initial / Reconciled Arena State ─────────────────────
  const refreshArenaState = useCallback(async () => {
    try {
      const res = await fetch(`/api/arena/${quizId}`);
      if (!res.ok) return;
      const data = await res.json();

      // Authoritative finished state from server
      if (data?.arena?.status === "ended" || data?.quizStatus === "ended") {
        setIncomingAttack(null);
        setPhase("podium");
        void finalizeMatch();
        return;
      }

      if (data?.arena?.status === "active") {
        setPhase("in_wave");
        setWaveDuration(data.arena.waveDuration || 30);
        if (Array.isArray(data.arena.enabledPowers)) {
          setEnabledPowers(data.arena.enabledPowers);
        }

        // Authoritative currentWave synchronization
        const waveIdx = Number(data.arena.currentWave);
        if (Number.isInteger(waveIdx) && waveIdx >= 0 && waveIdx < questions.length) {
          setCurrentQuestionIndex((prev) => {
            if (prev !== waveIdx) {
              setSelectedChoice(null);
              setIsSubmittingAnswer(false);
              return waveIdx;
            }
            return prev;
          });
        }

        // Authoritative remaining time calculation from server waveEndsAt
        if (data.arena.waveEndsAt) {
          const endsAt = Date.parse(data.arena.waveEndsAt);
          if (Number.isFinite(endsAt)) {
            const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
            setWaveTimeLeft(remaining);
          }
        }

        // Sync health
        if (data.arena.players) {
          syncPlayerHealth(data.arena.players);
        }
      }

      // Populate rivals from enrolled participants
      if (Array.isArray(data?.participants)) {
        setRivals((prev) => {
          return data.participants
            .filter((p: { studentId: string }) => p.studentId !== studentId)
            .map((p: { studentId: string; studentName: string; avatar?: string }) => {
              const existing = prev.find((r) => r.studentId === p.studentId);
              const playerHp = data.arena?.players?.[p.studentId];
              return {
                studentId: p.studentId,
                studentName: p.studentName,
                avatar: p.avatar || "🎓",
                currentHp: playerHp ? playerHp.currentHp : existing ? existing.currentHp : 100,
                maxHp: playerHp ? playerHp.maxHp : existing ? existing.maxHp : 100,
                isAlive: playerHp ? playerHp.isAlive : existing ? existing.isAlive : true,
                hasShield: playerHp ? playerHp.hasShield : existing ? existing.hasShield : false,
              };
            });
        });
      }
    } catch {}
  }, [quizId, questions.length, studentId, finalizeMatch, syncPlayerHealth]);

  // Periodic background state reconciliation
  useEffect(() => {
    if (phase === "podium") return;
    void refreshArenaState();
    const interval = setInterval(() => {
      void refreshArenaState();
    }, 2500);
    return () => clearInterval(interval);
  }, [phase, refreshArenaState]);

  // ── Realtime Pusher Subscription (private-arena-${quizId} ONLY) ──
  useEffect(() => {
    let pusher: PusherClient | null = null;

    try {
      pusher = new PusherClient(
        process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
        {
          cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1",
          authEndpoint: "/api/pusher/auth",
        }
      );

      const arenaChannel = pusher.subscribe(`private-arena-${quizId}`);

      arenaChannel.bind("arena-start", (data?: { arena?: ArenaState; waveDuration?: number }) => {
        setPhase("in_wave");
        const duration = data?.arena?.waveDuration || data?.waveDuration || 30;
        setWaveDuration(duration);
        setWaveTimeLeft(duration);
        if (Array.isArray(data?.arena?.enabledPowers)) {
          setEnabledPowers(data.arena.enabledPowers);
        }
        if (data?.arena?.players) {
          syncPlayerHealth(data.arena.players);
        }
        setCurrentQuestionIndex(0);
      });

      arenaChannel.bind("arena-wave", (data: { arena?: ArenaState; waveIndex?: number }) => {
        setPhase("in_wave");
        setIncomingAttack(null);
        setSelectedChoice(null);
        setIsSubmittingAnswer(false);
        const idx = typeof data.waveIndex === "number" ? data.waveIndex : data.arena?.currentWave ?? 0;
        if (idx >= 0 && idx < questions.length) {
          setCurrentQuestionIndex(idx);
          const duration = data.arena?.waveDuration || waveDuration || 30;
          setWaveTimeLeft(duration);
        }
        if (data.arena?.players) {
          syncPlayerHealth(data.arena.players);
        }
      });

      arenaChannel.bind("arena-airdrop", () => {
        setHasGuardianShield(true);
        hasGuardianShieldRef.current = true;
        setMyHp((prev) => Math.min(myMaxHp, prev + 15));
        if (soundEnabled) playShieldDeflectSound();
        setCelebrationMessage("🎁 HOST AIRDROP! Guardian Shield armed and +15 HP restored!");
        setTimeout(() => setCelebrationMessage(null), 4000);
      });

      // ── Incoming Attack Warning Event ────────────────────────────
      const handleIncomingAttackEvent = (data: IncomingAttackAlert) => {
        if (data.targetStudentId === studentId) {
          setIncomingAttack(data);
          setReactionTimeLeftMs(data.reactionWindowMs || 2500);
        } else if (data.attackerId === studentId) {
          setCelebrationMessage(`🚀 STRIKE LAUNCHED at ${data.targetName}! Strike in progress...`);
          setTimeout(() => setCelebrationMessage(null), 2500);
        }
      };
      arenaChannel.bind("arena-incoming-attack", handleIncomingAttackEvent);
      arenaChannel.bind("incoming-attack", handleIncomingAttackEvent);
      arenaChannel.bind("battle-attack", handleIncomingAttackEvent);

      // ── Attack Hit Event ─────────────────────────────────────────
      const handleAttackHitEvent = (data: {
        attackId: string;
        attackerId: string;
        attackerName: string;
        targetStudentId: string;
        targetName: string;
        powerType: string;
        damage: number;
        targetCurrentHp: number;
        targetMaxHp: number;
        isAlive: boolean;
        playerHealth?: Record<string, PlayerHealth>;
      }) => {
        if (data.targetStudentId === studentId) {
          setMyHp(data.targetCurrentHp);
          setIsMyAlive(data.isAlive);
          setIncomingAttack(null);

          if (soundEnabled) {
            if (data.powerType === "meteor") playMeteorSound();
            else if (data.powerType === "earthquake") playEarthquakeSound();
            else if (data.powerType === "blizzard") playBlizzardSound();
          }

          setActiveAttackEffect({
            type: (data.powerType as "meteor" | "earthquake" | "blizzard") || "meteor",
            attackerName: data.attackerName,
            message: `💥 ${data.attackerName}'s ${data.powerType.toUpperCase()} HIT YOU FOR -${data.damage} HP!`,
          });
          setTimeout(() => setActiveAttackEffect(null), 4000);
        } else {
          setRivals((prev) =>
            prev.map((r) => {
              if (r.studentId === data.targetStudentId) {
                return {
                  ...r,
                  currentHp: data.targetCurrentHp,
                  maxHp: data.targetMaxHp,
                  isAlive: data.isAlive,
                };
              }
              return r;
            })
          );
        }
        if (data.playerHealth) {
          syncPlayerHealth(data.playerHealth);
        }
      };
      arenaChannel.bind("arena-attack-hit", handleAttackHitEvent);
      arenaChannel.bind("attack-hit", handleAttackHitEvent);

      // ── Attack Blocked Event ─────────────────────────────────────
      const handleAttackBlockedEvent = (data: {
        attackId: string;
        attackerId: string;
        attackerName: string;
        targetStudentId: string;
        targetName: string;
        powerType: string;
        message?: string;
      }) => {
        if (data.targetStudentId === studentId) {
          setIncomingAttack(null);
          setHasGuardianShield(false);
          hasGuardianShieldRef.current = false;
          if (soundEnabled) playShieldDeflectSound();
          setActiveAttackEffect({
            type: "deflected",
            attackerName: data.attackerName,
            message: `🛡️ DEFLECTED! You blocked ${data.attackerName}'s ${data.powerType.toUpperCase()} with Guardian Shield!`,
          });
          setTimeout(() => setActiveAttackEffect(null), 4000);
        } else if (data.attackerId === studentId) {
          setCelebrationMessage(`🛡️ ${data.targetName} blocked your ${data.powerType.toUpperCase()} with Guardian Shield!`);
          setTimeout(() => setCelebrationMessage(null), 3000);
        }
      };
      arenaChannel.bind("arena-attack-blocked", handleAttackBlockedEvent);
      arenaChannel.bind("attack-blocked", handleAttackBlockedEvent);

      // ── Health Updated Event ─────────────────────────────────────
      arenaChannel.bind("arena-health-updated", (data: { playerHealth?: Record<string, PlayerHealth> }) => {
        if (data.playerHealth) {
          syncPlayerHealth(data.playerHealth);
        }
      });

      // ── Authoritative Arena End Event ────────────────────────────
      arenaChannel.bind("arena-end", () => {
        setIncomingAttack(null);
        setTargetPickerPower(null);
        void finalizeMatch();
      });
    } catch (e) {
      console.error("Arena Pusher connection error:", e);
    }

    return () => {
      if (pusher) {
        pusher.unsubscribe(`private-arena-${quizId}`);
        pusher.disconnect();
      }
    };
  }, [
    quizId,
    questions.length,
    studentId,
    soundEnabled,
    waveDuration,
    myMaxHp,
    finalizeMatch,
    syncPlayerHealth,
  ]);

  // ── Reaction Countdown Interval for Incoming Attack ───────────
  useEffect(() => {
    if (!incomingAttack) return;
    const expiry = Date.parse(incomingAttack.warningExpiry);
    const interval = setInterval(() => {
      const remaining = Math.max(0, expiry - Date.now());
      setReactionTimeLeftMs(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [incomingAttack]);

  // ── Wave Timer Countdown ──────────────────────────────────────
  useEffect(() => {
    if (phase !== "in_wave") return;

    const timer = setInterval(() => {
      setWaveTimeLeft((prev) => {
        if (prev <= 1) {
          void refreshArenaState();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [phase, currentQuestionIndex, refreshArenaState]);

  // ── Submit Answer for Current Question ────────────────────────
  const handleSelectChoice = async (choiceId: number) => {
    const currentQ = questions[currentQuestionIndex];
    if (!currentQ || lockedAnswers.has(currentQ.id) || isSubmittingAnswer) return;

    setSelectedChoice(choiceId);
    setIsSubmittingAnswer(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/quizzes/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId,
          questionId: currentQ.id,
          choiceId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Failed to submit answer.");
        setIsSubmittingAnswer(false);
        return;
      }

      const isCorrect = Boolean(data.isCorrect);
      setLockedAnswers((prev) => new Map(prev).set(currentQ.id, { choiceId, isCorrect }));
      playFeedbackChime(isCorrect);

      if (isCorrect) {
        const nextStreak = streak + 1;
        setStreak(nextStreak);
        if (nextStreak > highestStreak) setHighestStreak(nextStreak);
        const streakMultiplier = nextStreak;
        const pointsEarned = currentQ.points || 100;
        setScore((prev) => prev + pointsEarned * streakMultiplier);
      } else {
        setStreak(0);
      }
    } catch {
      setErrorMessage("Network error submitting answer.");
    } finally {
      setIsSubmittingAnswer(false);
    }
  };

  // ── Launch Arena Battle Power ─────────────────────────────────
  const handleUsePower = (powerType: BattlePowerType) => {
    if (battlePowerInventory[powerType] || isLaunchingPower !== null) return;

    if (powerType === "shield") {
      // Guardian Shield is self-targeted
      void executeBattlePower("shield");
    } else {
      // Offensive power requires choosing a rival target
      setTargetPickerPower(powerType);
    }
  };

  const executeBattlePower = async (powerType: BattlePowerType, targetStudentId?: string) => {
    if (isLaunchingPower !== null) return;
    setIsLaunchingPower(powerType);
    setErrorMessage(null);
    setTargetPickerPower(null);

    try {
      const currentQ = questions[currentQuestionIndex];
      const res = await fetch("/api/arena/battle-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId,
          powerType,
          questionId: currentQ?.id || 1,
          targetStudentId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Failed to cast battle power.");
        return;
      }

      setBattlePowerInventory((prev) => ({ ...prev, [powerType]: true }));

      if (powerType === "shield") {
        setHasGuardianShield(true);
        hasGuardianShieldRef.current = true;
        if (soundEnabled) playShieldDeflectSound();
        setCelebrationMessage("🛡️ GUARDIAN SHIELD ARMED! Defense ready against incoming attacks!");
      } else {
        const names: Record<string, string> = {
          meteor: "☄️ METEOR STRIKE",
          earthquake: "🌋 EARTHQUAKE TREMOR",
          blizzard: "❄️ BLIZZARD FROST",
        };
        const targetRival = rivals.find((r) => r.studentId === targetStudentId);
        const targetLabel = targetRival?.studentName || "Rival";
        setCelebrationMessage(`🚀 LAUNCHED ${names[powerType]} AT ${targetLabel.toUpperCase()}! Strike incoming!`);
      }
      setTimeout(() => setCelebrationMessage(null), 3000);
    } catch {
      setErrorMessage("Network error launching battle power.");
    } finally {
      setIsLaunchingPower(null);
    }
  };

  // ── Defend Incoming Attack with Shield ────────────────────────
  const handleDefendIncomingAttack = async () => {
    if (!incomingAttack) return;
    try {
      const res = await fetch("/api/arena/battle-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId,
          powerType: "shield",
          defendAttackId: incomingAttack.attackId,
        }),
      });

      const data = await res.json();
      if (data.deflected) {
        setIncomingAttack(null);
        setHasGuardianShield(false);
        hasGuardianShieldRef.current = false;
        if (soundEnabled) playShieldDeflectSound();
        setActiveAttackEffect({
          type: "deflected",
          attackerName: incomingAttack.attackerName,
          message: `🛡️ GUARDIAN SHIELD DEFLECTED ${incomingAttack.attackerName}'s ${incomingAttack.powerType.toUpperCase()}!`,
        });
        setTimeout(() => setActiveAttackEffect(null), 4000);
      }
    } catch {}
  };

  // ── Render: Podium / Match Concluded ──────────────────────────
  if (phase === "podium") {
    return (
      <div className="min-h-screen bg-[#070a14] text-white flex flex-col justify-center py-10">
        <ArenaPodium
          quizTitle={quizTitle}
          subjectName={subjectName}
          podium={podium}
          allParticipants={allParticipants}
          currentStudentId={studentId}
          studentScore={score}
          studentRank={studentRank}
          studentCoins={coinsEarned}
          highestStreak={highestStreak}
          onExit={() => router.push("/dashboard/student")}
        />
      </div>
    );
  }

  // ── Render: Game Station Lobby (Waiting for Host) ─────────────
  if (phase === "lobby") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#070a14] via-[#0d1222] to-[#070a14] text-white flex flex-col justify-between p-4 sm:p-8">
        <header className="flex items-center justify-between max-w-4xl w-full mx-auto">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 via-rose-500 to-indigo-600 flex items-center justify-center text-white shadow-[0_0_20px_rgba(244,63,94,0.4)]">
              <Gamepad2 className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-mono font-bold text-amber-400 tracking-wider uppercase">
                Power Arena Station
              </div>
              <h1 className="text-sm sm:text-base font-black text-white truncate max-w-[220px] sm:max-w-md">
                {quizTitle}
              </h1>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2.5 rounded-xl bg-[#141828] border border-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            title={soundEnabled ? "Mute Game Audio" : "Enable Game Audio"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
          </button>
        </header>

        <main className="max-w-md w-full mx-auto my-auto text-center flex flex-col items-center py-10">
          <div className="relative mb-6">
            <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-gradient-to-tr from-amber-500/20 via-rose-500/20 to-indigo-500/20 border-2 border-indigo-500/40 flex items-center justify-center animate-pulse shadow-[0_0_50px_rgba(99,102,241,0.3)]">
              <Swords className="w-12 h-12 text-indigo-400 animate-bounce" />
            </div>
            <div className="absolute inset-0 rounded-full border border-amber-400/30 animate-ping pointer-events-none" />
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono font-bold uppercase tracking-wider mb-3">
            <Radio className="w-3.5 h-3.5 animate-pulse text-rose-400" />
            <span>Station Ready • Awaiting Host</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-2">
            Waiting for Match Start
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-sm mb-6">
            Your teacher is assembling the lobby. Keep this station open — your match and battle arsenal will launch automatically!
          </p>

          <div className="w-full bg-[#12182b]/80 border border-slate-800 rounded-2xl p-4 text-left">
            <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">
              Arena Battle Powers Overview
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-xl bg-[#182035]/60 border border-slate-800 flex items-center gap-2">
                <span className="text-lg">☄️</span>
                <div>
                  <div className="font-black text-rose-300">Meteor Strike</div>
                  <div className="text-[10px] text-slate-400">-25 HP Rival Target</div>
                </div>
              </div>
              <div className="p-2 rounded-xl bg-[#182035]/60 border border-slate-800 flex items-center gap-2">
                <span className="text-lg">🌋</span>
                <div>
                  <div className="font-black text-amber-300">Earthquake</div>
                  <div className="text-[10px] text-slate-400">-15 HP Screen Shake</div>
                </div>
              </div>
              <div className="p-2 rounded-xl bg-[#182035]/60 border border-slate-800 flex items-center gap-2">
                <span className="text-lg">❄️</span>
                <div>
                  <div className="font-black text-cyan-300">Blizzard Frost</div>
                  <div className="text-[10px] text-slate-400">-10 HP Freeze Effect</div>
                </div>
              </div>
              <div className="p-2 rounded-xl bg-[#182035]/60 border border-slate-800 flex items-center gap-2">
                <span className="text-lg">🛡️</span>
                <div>
                  <div className="font-black text-indigo-300">Guardian Shield</div>
                  <div className="text-[10px] text-slate-400">Deflect Next Attack</div>
                </div>
              </div>
            </div>
          </div>
        </main>

        <footer className="text-center text-xs text-slate-500">
          Player: <span className="font-bold text-slate-300">{studentName}</span> • Zero Camera / Mic Requirements
        </footer>
      </div>
    );
  }

  // ── Render: Active Wave / Gameplay Screen ─────────────────────
  const currentQ = questions[currentQuestionIndex];
  const currentAnswer = currentQ ? lockedAnswers.get(currentQ.id) : undefined;
  const isQuestionAnswered = Boolean(currentAnswer);

  return (
    <div
      className={`min-h-screen bg-[#070a14] text-white flex flex-col justify-between p-3 sm:p-6 overflow-x-hidden ${
        activeAttackEffect?.type === "earthquake" ? "animate-[earthquake-rumble_0.5s_infinite]" : ""
      }`}
    >
      <style jsx global>{`
        @keyframes earthquake-rumble {
          0% { transform: translate(0px, 0px) rotate(0deg); }
          20% { transform: translate(-6px, 5px) rotate(-0.5deg); }
          40% { transform: translate(6px, -4px) rotate(0.5deg); }
          60% { transform: translate(-5px, 3px) rotate(-0.5deg); }
          80% { transform: translate(5px, -3px) rotate(0.5deg); }
          100% { transform: translate(0px, 0px) rotate(0deg); }
        }
        @keyframes meteor-fall {
          0% { transform: translateY(-80px) translateX(-40px); opacity: 0; }
          30% { opacity: 1; }
          100% { transform: translateY(700px) translateX(350px); opacity: 0; }
        }
      `}</style>

      {/* Incoming Attack Warning Dialog with Reaction Bar & Shield Button */}
      {incomingAttack && (
        <div className="fixed inset-x-4 top-16 sm:top-20 z-[96] max-w-lg mx-auto bg-rose-950/95 border-2 border-rose-500 rounded-3xl p-4 sm:p-5 shadow-[0_0_50px_rgba(244,63,94,0.6)] animate-bounce text-white">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-600 flex items-center justify-center text-2xl shadow-inner shrink-0 animate-pulse">
              {incomingAttack.powerType === "meteor" ? "☄️" : incomingAttack.powerType === "earthquake" ? "🌋" : "❄️"}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-black text-rose-300 uppercase tracking-wider">
                  ⚠️ INCOMING {incomingAttack.powerType.toUpperCase()} STRIKE!
                </span>
                <span className="text-xs font-mono font-black text-amber-300">
                  {(reactionTimeLeftMs / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="text-sm font-black text-white truncate">
                {incomingAttack.attackerName} is attacking you! (-{incomingAttack.damage} HP)
              </div>
              {/* Animated Countdown Progress Bar */}
              <div className="w-full h-2 bg-rose-900 rounded-full mt-2 overflow-hidden border border-rose-700/50">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-rose-400 transition-all duration-75"
                  style={{
                    width: `${Math.max(0, Math.min(100, (reactionTimeLeftMs / (incomingAttack.reactionWindowMs || 2500)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={() => void handleDefendIncomingAttack()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg hover:brightness-110 active:scale-98 cursor-pointer"
            >
              <Shield className="w-4 h-4" />
              ACTIVATE GUARDIAN SHIELD (DEFLECT)
            </button>
          </div>
        </div>
      )}

      {/* Target Selection Modal for Offensive Battle Powers */}
      {targetPickerPower && (
        <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0f1527] border border-indigo-500/40 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">
                  {targetPickerPower === "meteor" ? "☄️" : targetPickerPower === "earthquake" ? "🌋" : "❄️"}
                </span>
                <div>
                  <h3 className="text-base font-black text-white">Select Rival Target</h3>
                  <p className="text-xs text-slate-400">
                    {targetPickerPower === "meteor"
                      ? "Meteor Strike: -25 HP"
                      : targetPickerPower === "earthquake"
                      ? "Earthquake Tremor: -15 HP"
                      : "Blizzard Frost: -10 HP"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTargetPickerPower(null)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {rivals.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs font-semibold">
                  Waiting for rivals to enter the arena...
                </div>
              ) : rivals.filter((r) => r.isAlive && r.currentHp > 0).length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs font-semibold">
                  All rivals have been eliminated!
                </div>
              ) : (
                rivals.map((rival) => {
                  const isAlive = rival.isAlive && rival.currentHp > 0;
                  return (
                    <button
                      key={rival.studentId}
                      type="button"
                      disabled={!isAlive}
                      onClick={() => void executeBattlePower(targetPickerPower, rival.studentId)}
                      className={`w-full p-3 rounded-2xl border flex items-center justify-between transition-all cursor-pointer ${
                        isAlive
                          ? "bg-[#161d33] hover:bg-indigo-900/40 border-slate-800 hover:border-indigo-500 text-white"
                          : "bg-slate-900/40 border-slate-800 text-slate-500 opacity-40 cursor-not-allowed"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{rival.avatar}</span>
                        <div className="text-left">
                          <div className="text-xs font-black flex items-center gap-1.5">
                            <span>{rival.studentName}</span>
                            {rival.hasShield && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
                                🛡️ SHIELD
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {isAlive ? `HP: ${rival.currentHp} / ${rival.maxHp}` : "💀 ELIMINATED"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="w-20 sm:w-28 h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              rival.currentHp > 50
                                ? "bg-emerald-400"
                                : rival.currentHp > 25
                                ? "bg-amber-400"
                                : "bg-rose-500"
                            }`}
                            style={{ width: `${Math.max(0, Math.min(100, (rival.currentHp / rival.maxHp) * 100))}%` }}
                          />
                        </div>
                        <span className="text-xs font-black text-rose-400 uppercase tracking-wider px-2 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30">
                          STRIKE
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setTargetPickerPower(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hit / Deflection Alert Banner */}
      {activeAttackEffect && (
        <div
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[90] px-6 py-3.5 rounded-2xl shadow-2xl border-2 flex items-center gap-3 animate-bounce max-w-lg w-[92%] text-center justify-center pointer-events-none"
          style={{
            backgroundColor:
              activeAttackEffect.type === "deflected"
                ? "rgba(16, 185, 129, 0.95)"
                : activeAttackEffect.type === "earthquake"
                ? "rgba(217, 119, 6, 0.95)"
                : activeAttackEffect.type === "meteor"
                ? "rgba(225, 29, 72, 0.95)"
                : "rgba(6, 182, 212, 0.95)",
            borderColor: "#ffffff",
          }}
        >
          <span className="text-2xl">
            {activeAttackEffect.type === "deflected"
              ? "🛡️"
              : activeAttackEffect.type === "earthquake"
              ? "🌋"
              : activeAttackEffect.type === "meteor"
              ? "☄️"
              : "❄️"}
          </span>
          <span className="text-xs sm:text-sm font-black text-white">
            {activeAttackEffect.message}
          </span>
        </div>
      )}

      {/* Celebration Banner */}
      {celebrationMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[88] px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-600 text-white text-xs sm:text-sm font-black shadow-xl border border-white/20 animate-fade-in pointer-events-none">
          {celebrationMessage}
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[88] px-5 py-2.5 rounded-xl bg-rose-600 text-white text-xs sm:text-sm font-bold shadow-xl border border-rose-400 animate-fade-in">
          {errorMessage}
        </div>
      )}

      {/* Meteor Visual Overlay */}
      {activeAttackEffect?.type === "meteor" && (
        <div className="fixed inset-0 z-[85] pointer-events-none overflow-hidden">
          <div className="absolute top-10 left-1/4 w-12 h-12 rounded-full bg-gradient-to-tr from-amber-500 to-rose-600 blur-xs animate-ping" />
          <div
            className="absolute top-0 left-1/3 w-8 h-8 rounded-full bg-rose-500 shadow-[0_0_50px_#ef4444]"
            style={{ animation: "meteor-fall 1.5s infinite linear" }}
          />
          <div
            className="absolute top-0 left-2/3 w-10 h-10 rounded-full bg-amber-500 shadow-[0_0_60px_#f59e0b]"
            style={{ animation: "meteor-fall 1.8s infinite linear 0.4s" }}
          />
        </div>
      )}

      {/* Blizzard Frost Visual Overlay */}
      {activeAttackEffect?.type === "blizzard" && (
        <div className="fixed inset-0 z-[85] pointer-events-none bg-cyan-400/15 backdrop-blur-[2px] border-8 border-cyan-400/40 flex items-center justify-center">
          <div className="text-center font-black text-cyan-200 text-xl sm:text-2xl animate-pulse">
            ❄️ SCREEN FROZEN BY BLIZZARD! ❄️
          </div>
        </div>
      )}

      {/* Top Game Station HUD */}
      <header className="max-w-4xl w-full mx-auto flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-rose-600 flex items-center justify-center text-white shadow-md">
            <Flame className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-wider">
              Wave {currentQuestionIndex + 1} of {questions.length}
            </div>
            <div className="text-xs sm:text-sm font-black text-white truncate max-w-[140px] sm:max-w-xs">
              {quizTitle}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* MY HEALTH BAR BADGE */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#141828] border border-slate-800 shadow-md">
            <Heart className="w-4 h-4 fill-rose-500 text-rose-500 shrink-0" />
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5 text-[10px] font-mono font-black">
                <span className="text-slate-400">MY HP:</span>
                <span className={myHp > 50 ? "text-emerald-300" : myHp > 25 ? "text-amber-300" : "text-rose-400"}>
                  {myHp} / {myMaxHp}
                </span>
                {hasGuardianShield && <span title="Shield Equipped">🛡️</span>}
              </div>
              <div className="w-16 sm:w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden mt-0.5">
                <div
                  className={`h-full transition-all ${
                    myHp > 50 ? "bg-emerald-400" : myHp > 25 ? "bg-amber-400" : "bg-rose-500"
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, (myHp / myMaxHp) * 100))}%` }}
                />
              </div>
            </div>
          </div>

          {/* Wave Timer */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-black text-xs sm:text-sm shadow-md border transition-all ${
              waveTimeLeft <= 5
                ? "bg-rose-500/20 border-rose-500/50 text-rose-300 animate-pulse"
                : "bg-[#141828] border-slate-800 text-amber-300"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{waveTimeLeft}s</span>
          </div>

          {/* Streak Counter */}
          <div className="hidden sm:flex items-center gap-1 px-3 py-1.5 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-300 font-mono font-black text-xs sm:text-sm">
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            <span>{streak}X</span>
          </div>

          {/* Score Counter */}
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-mono font-black text-xs sm:text-sm">
            <Trophy className="w-3.5 h-3.5 text-indigo-400" />
            <span>{score} PTS</span>
          </div>

          {/* Sound Toggle */}
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 rounded-xl bg-[#141828] border border-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            title={soundEnabled ? "Mute" : "Unmute"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
          </button>
        </div>
      </header>

      {/* Rivals Health Strip */}
      {rivals.length > 0 && (
        <div className="max-w-4xl w-full mx-auto mb-3 p-2 rounded-2xl bg-[#0f1527]/90 border border-slate-800/80 flex items-center gap-2 overflow-x-auto no-scrollbar shadow-inner">
          <span className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-wider shrink-0 px-2 flex items-center gap-1">
            <Users className="w-3 h-3 text-indigo-400" />
            RIVALS ({rivals.filter((r) => r.isAlive && r.currentHp > 0).length}/{rivals.length}):
          </span>
          {rivals.map((rival) => {
            const isAlive = rival.isAlive && rival.currentHp > 0;
            return (
              <div
                key={rival.studentId}
                className={`shrink-0 flex items-center gap-2 px-2.5 py-1 rounded-xl border text-xs transition-all ${
                  isAlive
                    ? "bg-[#141b30] border-slate-700/80 text-white shadow-sm"
                    : "bg-slate-950/40 border-slate-800/50 text-slate-500 opacity-50"
                }`}
              >
                <span className="text-base">{rival.avatar}</span>
                <div className="flex flex-col min-w-[65px]">
                  <div className="flex items-center gap-1 font-bold text-[11px] truncate max-w-[85px]">
                    <span>{rival.studentName}</span>
                    {rival.hasShield && <span title="Shield Armed">🛡️</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="w-12 sm:w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          rival.currentHp > 50
                            ? "bg-emerald-400"
                            : rival.currentHp > 25
                            ? "bg-amber-400"
                            : "bg-rose-500"
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, (rival.currentHp / rival.maxHp) * 100))}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono font-bold text-slate-400">
                      {isAlive ? `${rival.currentHp}` : "💀"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Question Card Area */}
      <main className="max-w-4xl w-full mx-auto my-auto flex flex-col justify-center">
        {currentQ ? (
          <div className="bg-gradient-to-br from-[#12182b] to-[#0d1222] border border-indigo-500/20 rounded-3xl p-5 sm:p-8 shadow-2xl">
            <div className="w-full h-1.5 bg-slate-800 rounded-full mb-6 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 via-rose-500 to-indigo-500 transition-all duration-1000"
                style={{ width: `${Math.max(0, Math.min(100, (waveTimeLeft / (waveDuration || 30)) * 100))}%` }}
              />
            </div>

            <div className="mb-6 sm:mb-8">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-mono font-black px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Question {currentQuestionIndex + 1}
                </span>
                <span className="text-[11px] font-mono font-bold text-slate-400">
                  {currentQ.points} Points
                </span>
              </div>
              <h2 className="text-lg sm:text-2xl font-black text-white leading-snug">
                {currentQ.questionText}
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {currentQ.choices.map((choice, cIndex) => {
                const isSelected = selectedChoice === choice.id || currentAnswer?.choiceId === choice.id;
                const isAnswerLocked = isQuestionAnswered;
                const wasCorrect = currentAnswer?.isCorrect;

                let cardStyle = "bg-[#161d33]/80 hover:bg-[#1c2542] border-slate-800 text-slate-200 hover:border-slate-700";
                if (isAnswerLocked) {
                  if (isSelected) {
                    cardStyle = wasCorrect
                      ? "bg-emerald-500/20 border-emerald-500/60 text-emerald-200 font-bold shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                      : "bg-rose-500/20 border-rose-500/60 text-rose-200 font-bold shadow-[0_0_20px_rgba(244,63,94,0.3)]";
                  } else {
                    cardStyle = "bg-[#101424]/60 border-slate-800/40 text-slate-500 opacity-60";
                  }
                } else if (isSelected) {
                  cardStyle = "bg-indigo-600/30 border-indigo-500 text-white font-bold";
                }

                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => void handleSelectChoice(choice.id)}
                    disabled={isAnswerLocked || isSubmittingAnswer}
                    className={`relative p-4 sm:p-5 rounded-2xl border text-left flex items-center justify-between transition-all duration-200 cursor-pointer shadow-md ${cardStyle} ${
                      !isAnswerLocked ? "hover:scale-[1.01] active:scale-[0.99]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-xl bg-black/30 border border-white/10 flex items-center justify-center font-mono font-bold text-xs text-slate-300">
                        {String.fromCharCode(65 + cIndex)}
                      </span>
                      <span className="text-sm sm:text-base font-semibold">{choice.choiceText}</span>
                    </div>

                    {isAnswerLocked && isSelected && (
                      <span className="text-lg">
                        {wasCorrect ? <CheckCircle2 className="w-6 h-6 text-emerald-400" /> : <XCircle className="w-6 h-6 text-rose-400" />}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-slate-400 font-bold">
            No active question loaded.
          </div>
        )}
      </main>

      {/* Bottom Battle Arsenal Dock */}
      <footer className="max-w-4xl w-full mx-auto mt-4">
        <ArenaBattleDock
          inventory={battlePowerInventory}
          hasShield={hasGuardianShield}
          isLaunching={isLaunchingPower}
          enabledPowers={enabledPowers}
          onUsePower={handleUsePower}
          disabled={phase !== "in_wave"}
        />
      </footer>
    </div>
  );
}
