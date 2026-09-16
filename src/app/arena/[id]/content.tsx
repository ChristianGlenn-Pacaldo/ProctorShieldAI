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
  X,
  Crosshair,
  Award,
  Check,
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
import type { ArenaParticipant, ArenaState } from "@/lib/arena";

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

interface IncomingAttackAlert {
  attackId: string;
  attackerId: string;
  attackerName: string;
  targetStudentId?: string;
  targetName?: string;
  powerType: string;
  scorePenalty: number;
  damage?: number;
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

  // ── Match Phase: Strictly lobby until teacher starts ──────────
  const [phase, setPhase] = useState<"lobby" | "in_wave" | "podium">("lobby");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // ── Automatic Question Progression ────────────────────────────
  const initialUnansweredIndex = questions.findIndex(
    (q) => !savedAnswers.some((ans) => ans.questionId === q.id)
  );
  const startingQuestionIndex =
    initialUnansweredIndex >= 0
      ? initialUnansweredIndex
      : Math.max(0, questions.length - 1);

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(startingQuestionIndex);
  const [questionsCompleted, setQuestionsCompleted] = useState(
    savedAnswers.length >= questions.length && questions.length > 0
  );

  // ── Overall Server-Authoritative Match Timer ──────────────────
  const [matchEndsAt, setMatchEndsAt] = useState<string | null>(null);
  const [matchTimeLeft, setMatchTimeLeft] = useState<number>(1800); // 30 minutes default

  // ── Score, Ranking & Participants ─────────────────────────────
  const [score, setScore] = useState(() => {
    return savedAnswers.reduce((sum, ans) => {
      if (!ans.isCorrect) return sum;
      const q = questions.find((item) => item.id === ans.questionId);
      return sum + (q?.points || 100);
    }, 0);
  });
  const [studentRank, setStudentRank] = useState<number>(1);
  const [totalParticipants, setTotalParticipants] = useState<number>(1);
  const [streak, setStreak] = useState(0);
  const [highestStreak, setHighestStreak] = useState(0);
  const [coinsEarned, setCoinsEarned] = useState(0);

  // ── Rivals (Ranked by score descending, NO HP) ────────────────
  const [rivals, setRivals] = useState<ArenaParticipant[]>([]);
  const [targetPickerPower, setTargetPickerPower] = useState<BattlePowerType | null>(null);
  const [incomingAttack, setIncomingAttack] = useState<IncomingAttackAlert | null>(null);
  const [reactionTimeLeftMs, setReactionTimeLeftMs] = useState<number>(0);

  // ── Answers State & Feedback ──────────────────────────────────
  const [lockedAnswers, setLockedAnswers] = useState<Map<number, { choiceId: number; isCorrect: boolean }>>(() => {
    const map = new Map<number, { choiceId: number; isCorrect: boolean }>();
    savedAnswers.forEach((ans) => {
      map.set(ans.questionId, { choiceId: ans.choiceId, isCorrect: ans.isCorrect });
    });
    return map;
  });
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [answerFeedback, setAnswerFeedback] = useState<{ isCorrect: boolean; choiceId: number } | null>(null);

  // ── Once-Per-Match Battle Powers ──────────────────────────────
  const [usedPowers, setUsedPowers] = useState<Record<string, boolean>>({
    meteor: false,
    earthquake: false,
    blizzard: false,
    shield: false,
  });
  const battlePowerInventory = usedPowers;
  const [hasGuardianShield, setHasGuardianShield] = useState(false);
  const [isLaunchingPower, setIsLaunchingPower] = useState<string | null>(null);
  const [enabledPowers, setEnabledPowers] = useState<string[]>(["meteor", "earthquake", "blizzard", "shield"]);

  // ── Attack Animations, Popups & Overlays ──────────────────────
  const [activeAttackEffect, setActiveAttackEffect] = useState<{
    type: "meteor" | "earthquake" | "blizzard" | "deflected";
    attackerName: string;
    penalty: number;
    message: string;
  } | null>(null);
  const [scoreDeductionPopup, setScoreDeductionPopup] = useState<number | null>(null);
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

  // ── Sync Leaderboard and Personal Rank ─────────────────────────
  const updateRankingsFromParticipants = useCallback(
    (list: ArenaParticipant[]) => {
      if (!Array.isArray(list) || list.length === 0) return;
      setTotalParticipants(list.length);

      // Sort by rank ascending
      const sorted = [...list].sort((a, b) => (a.rank || 0) - (b.rank || 0));

      // Personal student rank
      const me = sorted.find((p) => p.studentId === studentId);
      if (me) {
        setStudentRank(me.rank);
        if (typeof me.score === "number") {
          setScore(me.score);
        }
      }

      // Filter rivals (everyone except me) sorted #1 first
      const rivalList = sorted.filter((p) => p.studentId !== studentId);
      setRivals(rivalList);

      // Podium preparation
      const podiumList: PodiumParticipant[] = sorted.map((p) => ({
        studentId: p.studentId,
        studentName: p.studentName,
        avatar: p.avatar || "🎓",
        score: p.score,
        rank: p.rank,
      }));
      setAllParticipants(podiumList);
      setPodium(podiumList.slice(0, 3));
    },
    [studentId]
  );

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
          updateRankingsFromParticipants(arenaData.participants);
        }
      }
    } catch {}
  }, [quizId, lockedAnswers, updateRankingsFromParticipants]);

  // ── Explicit Arena Join on Mount ──────────────────────────────
  useEffect(() => {
    let isMounted = true;
    async function joinArena() {
      try {
        const res = await fetch(`/api/arena/${quizId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "join" }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;

        const sessId = data?.sessionId || data?.arena?.sessionId;
        if (sessId) {
          setCurrentSessionId(sessId);
        }

        const currentStatus = data?.status || data?.arena?.status;
        if (currentStatus === "active") {
          setPhase("in_wave");
          if (data.arena?.matchEndsAt) {
            setMatchEndsAt(data.arena.matchEndsAt);
            const endsAt = Date.parse(data.arena.matchEndsAt);
            if (Number.isFinite(endsAt)) {
              setMatchTimeLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
            }
          }
        } else if (currentStatus === "ended" || data?.quizStatus === "ended") {
          setPhase("podium");
        } else {
          setPhase("lobby");
        }

        if (Array.isArray(data?.participants)) {
          updateRankingsFromParticipants(data.participants);
        }
      } catch (err) {
        console.error("Failed to join arena lobby:", err);
      }
    }

    void joinArena();
    return () => {
      isMounted = false;
    };
  }, [quizId, updateRankingsFromParticipants]);

  // ── Fetch Initial / Reconciled Arena State ─────────────────────
  const refreshArenaState = useCallback(async () => {
    try {
      const res = await fetch(`/api/arena/${quizId}`);
      if (!res.ok) return;
      const data = await res.json();

      const sessId = data?.sessionId || data?.arena?.sessionId;
      if (sessId) {
        setCurrentSessionId(sessId);
      }

      // Authoritative finished state from server
      const currentStatus = data?.status || data?.arena?.status;
      if (currentStatus === "ended" || data?.quizStatus === "ended") {
        setIncomingAttack(null);
        setPhase("podium");
        void finalizeMatch();
        return;
      }

      if (currentStatus === "active") {
        setPhase("in_wave");
        if (Array.isArray(data.arena?.enabledPowers)) {
          setEnabledPowers(data.arena.enabledPowers);
        }

        // Authoritative matchEndsAt countdown
        if (data.arena?.matchEndsAt) {
          setMatchEndsAt(data.arena.matchEndsAt);
          const endsAt = Date.parse(data.arena.matchEndsAt);
          if (Number.isFinite(endsAt)) {
            const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
            setMatchTimeLeft(remaining);
            if (remaining <= 0) {
              void finalizeMatch();
              return;
            }
          }
        }
      } else if (currentStatus === "lobby") {
        setPhase("lobby");
      }

      // Restore usedPowers from server
      if (data?.usedPowers && typeof data.usedPowers === "object") {
        setUsedPowers((prev) => ({ ...prev, ...data.usedPowers }));
        if (data.usedPowers.shield) {
          setHasGuardianShield(false);
        }
      }

      // Reconcile participants and rankings
      if (Array.isArray(data?.participants)) {
        updateRankingsFromParticipants(data.participants);
      }
    } catch {}
  }, [quizId, finalizeMatch, updateRankingsFromParticipants]);

  // Periodic background state reconciliation
  useEffect(() => {
    if (phase === "podium") return;
    void refreshArenaState();
    const interval = setInterval(() => {
      void refreshArenaState();
    }, 3000);
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

      // ── Student Joined Event in Realtime ─────────────────────────
      arenaChannel.bind("arena-student-joined", (data?: {
        participants?: ArenaParticipant[];
      }) => {
        if (Array.isArray(data?.participants)) {
          updateRankingsFromParticipants(data.participants);
        }
      });

      // ── Match Started by Teacher ─────────────────────────────────
      arenaChannel.bind("arena-start", (data?: {
        arena?: ArenaState;
        sessionId?: string;
        matchEndsAt?: string;
        matchDuration?: number;
        participants?: ArenaParticipant[];
      }) => {
        setPhase("in_wave");
        if (data?.sessionId || data?.arena?.sessionId) {
          setCurrentSessionId(data.sessionId || data?.arena?.sessionId || null);
        }
        setCurrentQuestionIndex(0);
        if (data?.matchEndsAt || data?.arena?.matchEndsAt) {
          const ends = (data.matchEndsAt || data?.arena?.matchEndsAt)!;
          setMatchEndsAt(ends);
          const endsAtMs = Date.parse(ends);
          if (Number.isFinite(endsAtMs)) {
            setMatchTimeLeft(Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000)));
          }
        } else if (data?.matchDuration) {
          setMatchTimeLeft(data.matchDuration);
        }
        if (Array.isArray(data?.participants)) {
          updateRankingsFromParticipants(data.participants);
        }
      });

      // ── Match Ended by Teacher / Server ──────────────────────────
      arenaChannel.bind("arena-end", () => {
        setIncomingAttack(null);
        setPhase("podium");
        void finalizeMatch();
      });

      // ── Host Airdrop ─────────────────────────────────────────────
      arenaChannel.bind("arena-airdrop", () => {
        setHasGuardianShield(true);
        setUsedPowers((prev) => ({ ...prev, shield: false })); // Re-arm shield
        setScore((prev) => prev + 50);
        if (soundEnabled) playShieldDeflectSound();
        setCelebrationMessage("🎁 HOST AIRDROP! +50 Bonus Points & Guardian Shield Armed!");
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
      const handleIncomingAttack = handleIncomingAttackEvent;
      arenaChannel.bind("arena-incoming-attack", handleIncomingAttack);
      arenaChannel.bind("incoming-attack", handleIncomingAttack);
      arenaChannel.bind("battle-attack", handleIncomingAttack);
      arenaChannel.bind("arena-wave", () => {});

      // ── Attack Hit Event (Authoritative Score Deduction) ─────────
      const handleAttackHitEvent = (data: {
        attackId: string;
        attackerId: string;
        attackerName: string;
        targetStudentId: string;
        targetName: string;
        powerType: string;
        scorePenalty?: number;
        damage?: number;
        targetCurrentScore: number;
        targetRank: number;
        participants?: ArenaParticipant[];
      }) => {
        const penalty = data.scorePenalty || data.damage || 40;

        if (data.targetStudentId === studentId) {
          setIncomingAttack(null);
          setScore(data.targetCurrentScore);
          setStudentRank(data.targetRank);
          setScoreDeductionPopup(penalty);

          if (soundEnabled) {
            if (data.powerType === "meteor") playMeteorSound();
            else if (data.powerType === "earthquake") playEarthquakeSound();
            else if (data.powerType === "blizzard") playBlizzardSound();
          }

          setActiveAttackEffect({
            type: (data.powerType as "meteor" | "earthquake" | "blizzard") || "meteor",
            attackerName: data.attackerName,
            penalty,
            message: `💥 ${data.attackerName}'s ${data.powerType.toUpperCase()} HIT YOU FOR -${penalty} PTS!`,
          });

          setTimeout(() => {
            setActiveAttackEffect(null);
            setScoreDeductionPopup(null);
          }, 4000);
        } else if (data.attackerId === studentId) {
          setCelebrationMessage(`🎯 DIRECT HIT on ${data.targetName}! -${penalty} PTS deducted!`);
          setTimeout(() => setCelebrationMessage(null), 3000);
        }

        if (Array.isArray(data.participants)) {
          updateRankingsFromParticipants(data.participants);
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
          setUsedPowers((prev) => ({ ...prev, shield: true }));
          if (soundEnabled) playShieldDeflectSound();
          setActiveAttackEffect({
            type: "deflected",
            attackerName: data.attackerName,
            penalty: 0,
            message: `🛡️ DEFLECTED! Guardian Shield protected your score from ${data.attackerName}'s ${data.powerType.toUpperCase()}! (0 PTS lost)`,
          });
          setTimeout(() => setActiveAttackEffect(null), 4000);
        } else if (data.attackerId === studentId) {
          setCelebrationMessage(`🛡️ ${data.targetName} blocked your ${data.powerType.toUpperCase()} with Guardian Shield! (0 PTS deducted)`);
          setTimeout(() => setCelebrationMessage(null), 3000);
        }
      };
      arenaChannel.bind("arena-attack-blocked", handleAttackBlockedEvent);
      arenaChannel.bind("attack-blocked", handleAttackBlockedEvent);

      // ── Live Score / Leaderboard Update ──────────────────────────
      arenaChannel.bind("arena-score-updated", (data: {
        studentId: string;
        score: number;
        rank: number;
        totalCount: number;
      }) => {
        if (data.studentId === studentId) {
          setScore(data.score);
          setStudentRank(data.rank);
        }
        if (data.totalCount) setTotalParticipants(data.totalCount);
      });

      arenaChannel.bind("arena-leaderboard-updated", (data: { participants?: ArenaParticipant[] }) => {
        if (Array.isArray(data?.participants)) {
          updateRankingsFromParticipants(data.participants);
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
    studentId,
    soundEnabled,
    finalizeMatch,
    updateRankingsFromParticipants,
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

  // ── Overall Match Timer Countdown ─────────────────────────────
  useEffect(() => {
    if (phase !== "in_wave") return;

    const timer = setInterval(() => {
      if (matchEndsAt) {
        const remaining = Math.max(0, Math.ceil((Date.parse(matchEndsAt) - Date.now()) / 1000));
        setMatchTimeLeft(remaining);
        if (remaining <= 0) {
          void finalizeMatch();
        }
      } else {
        setMatchTimeLeft((prev) => {
          if (prev <= 1) {
            void finalizeMatch();
            return 0;
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [phase, matchEndsAt, finalizeMatch]);

  // ── Automatic Student Question Progression ────────────────────
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
      setAnswerFeedback({ isCorrect, choiceId });
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

      if (typeof data.rank === "number") setStudentRank(data.rank);
      if (typeof data.totalCount === "number") setTotalParticipants(data.totalCount);

      // Automatic progression to next question after short 1s feedback
      setTimeout(() => {
        setSelectedChoice(null);
        setAnswerFeedback(null);
        setIsSubmittingAnswer(false);

        if (currentQuestionIndex + 1 < questions.length) {
          setCurrentQuestionIndex((prev) => prev + 1);
        } else {
          setQuestionsCompleted(true);
        }
      }, 1000);
    } catch {
      setErrorMessage("Network error submitting answer.");
      setIsSubmittingAnswer(false);
    }
  };

  // ── Launch Arena Battle Power (Once-Per-Match) ─────────────────
  const handleUsePower = (powerType: BattlePowerType) => {
    if (usedPowers[powerType] || isLaunchingPower !== null) return;

    if (powerType === "shield") {
      // Guardian Shield is self-targeted
      void executeBattlePower("shield");
    } else {
      // Offensive powers require explicit rival selection
      setTargetPickerPower(powerType);
    }
  };

  const executeBattlePower = async (powerType: BattlePowerType, targetStudentId?: string) => {
    if (isLaunchingPower !== null || usedPowers[powerType]) return;
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
          sessionId: currentSessionId,
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

      // Mark power as USED permanently for this match
      setUsedPowers((prev) => ({ ...prev, [powerType]: true }));

      if (powerType === "shield") {
        setHasGuardianShield(true);
        if (soundEnabled) playShieldDeflectSound();
        setCelebrationMessage("🛡️ GUARDIAN SHIELD ARMED! Defense ready against incoming attacks!");
      } else {
        const names: Record<string, string> = {
          meteor: "☄️ METEOR STRIKE (-100 PTS)",
          earthquake: "🌋 EARTHQUAKE TREMOR (-60 PTS)",
          blizzard: "❄️ BLIZZARD FROST (-40 PTS)",
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

  // ── Defend Incoming Attack with Guardian Shield ───────────────
  const handleDefendIncomingAttack = async () => {
    if (!incomingAttack) return;
    try {
      const res = await fetch("/api/arena/battle-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId,
          sessionId: currentSessionId,
          powerType: "shield",
          defendAttackId: incomingAttack.attackId,
        }),
      });

      const data = await res.json();
      if (data.deflected) {
        setIncomingAttack(null);
        setHasGuardianShield(false);
        setUsedPowers((prev) => ({ ...prev, shield: true }));
        if (soundEnabled) playShieldDeflectSound();
        setActiveAttackEffect({
          type: "deflected",
          attackerName: incomingAttack.attackerName,
          penalty: 0,
          message: `🛡️ GUARDIAN SHIELD DEFLECTED ${incomingAttack.attackerName}'s ${incomingAttack.powerType.toUpperCase()}! 0 PTS LOST!`,
        });
        setTimeout(() => setActiveAttackEffect(null), 4000);
      }
    } catch {}
  };

  // Format MM:SS for overall timer
  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
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

  // ── Render: Game Station Lobby (Waiting for Teacher to Start) ──
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
            <span>Waiting for teacher to start Power Arena...</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-2">
            Power Arena Lobby
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-sm mb-4">
            {quizTitle} • {totalParticipants} {totalParticipants === 1 ? "player" : "players"} joined
          </p>

          {/* Display currently joined fighters in lobby */}
          {allParticipants.length > 0 && (
            <div className="w-full mb-4 p-3 rounded-xl bg-[#12182b]/70 border border-slate-800">
              <div className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>Joined Fighters ({allParticipants.length})</span>
                <span className="text-emerald-400 font-mono text-[10px]">● Connected</span>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-h-24 overflow-y-auto">
                {allParticipants.map((p) => (
                  <span
                    key={p.studentId}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                      p.studentId === studentId
                        ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-200"
                        : "bg-slate-800/60 border-slate-700/60 text-slate-300"
                    }`}
                  >
                    <span>{p.avatar || "🎓"}</span>
                    <span>{p.studentName}{p.studentId === studentId ? " (You)" : ""}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="w-full bg-[#12182b]/80 border border-slate-800 rounded-2xl p-4 text-left">
            <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">
              Score-Based Battle Arsenal (1x Per Match)
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-[#182035]/60 border border-slate-800 flex items-center gap-2">
                <span className="text-lg">☄️</span>
                <div>
                  <div className="font-black text-rose-300">Meteor Strike</div>
                  <div className="text-[10px] text-slate-400">-100 PTS to Rival</div>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-[#182035]/60 border border-slate-800 flex items-center gap-2">
                <span className="text-lg">🌋</span>
                <div>
                  <div className="font-black text-amber-300">Earthquake</div>
                  <div className="text-[10px] text-slate-400">-60 PTS to Rival</div>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-[#182035]/60 border border-slate-800 flex items-center gap-2">
                <span className="text-lg">❄️</span>
                <div>
                  <div className="font-black text-cyan-300">Blizzard Frost</div>
                  <div className="text-[10px] text-slate-400">-40 PTS to Rival</div>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-[#182035]/60 border border-slate-800 flex items-center gap-2">
                <span className="text-lg">🛡️</span>
                <div>
                  <div className="font-black text-indigo-300">Guardian Shield</div>
                  <div className="text-[10px] text-slate-400">Blocks one incoming attack</div>
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

  // ── Render: Active Gameplay Screen ────────────────────────────
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
                {incomingAttack.attackerName} is attacking you! (-{incomingAttack.scorePenalty || incomingAttack.damage || 40} PTS)
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
              disabled={usedPowers.shield}
              className={`w-full py-2.5 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg transition-all ${
                usedPowers.shield
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                  : "bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 hover:brightness-110 active:scale-98 cursor-pointer"
              }`}
            >
              <Shield className="w-4 h-4" />
              {usedPowers.shield ? "GUARDIAN SHIELD ALREADY USED" : "ACTIVATE GUARDIAN SHIELD (DEFLECT)"}
            </button>
          </div>
        </div>
      )}

      {/* Manual Target Selection Modal for Offensive Battle Powers */}
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
                      ? "Meteor Strike: -100 PTS Deduction"
                      : targetPickerPower === "earthquake"
                      ? "Earthquake Tremor: -60 PTS Deduction"
                      : "Blizzard Frost: -40 PTS Deduction"}
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
                  Waiting for rivals to join the arena...
                </div>
              ) : (
                rivals.map((rival) => {
                  return (
                    <button
                      key={rival.studentId}
                      type="button"
                      onClick={() => void executeBattlePower(targetPickerPower, rival.studentId)}
                      className="w-full p-3 rounded-2xl border flex items-center justify-between transition-all cursor-pointer bg-[#161d33] hover:bg-indigo-900/40 border-slate-800 hover:border-indigo-500 text-white"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{rival.avatar}</span>
                        <div className="text-left">
                          <div className="text-xs font-black flex items-center gap-1.5">
                            <span className="text-amber-400 font-mono">#{rival.rank}</span>
                            <span>{rival.studentName}</span>
                            {rival.hasShield && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
                                🛡️ SHIELD
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-300 font-mono font-bold">
                            Score: {rival.score} pts
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-rose-400 uppercase tracking-wider px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20">
                          ATTACK
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

      {/* Score Deduction Popup */}
      {scoreDeductionPopup !== null && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[92] text-3xl sm:text-4xl font-black text-rose-400 font-mono drop-shadow-[0_0_20px_rgba(244,63,94,0.8)] animate-bounce pointer-events-none">
          -{scoreDeductionPopup} PTS!
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
              {questionsCompleted
                ? `Completed (${questions.length}/${questions.length})`
                : `Question ${currentQuestionIndex + 1} of ${questions.length}`}
            </div>
            <div className="text-xs sm:text-sm font-black text-white truncate max-w-[140px] sm:max-w-xs">
              {quizTitle}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* PERSONAL RANK BADGE (#X of N) */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#141828] border border-slate-800 shadow-md">
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <div className="text-[11px] font-mono font-black">
              <span className="text-slate-400">Rank </span>
              <span className="text-amber-300">#{studentRank}</span>
              <span className="text-slate-500"> of {totalParticipants}</span>
            </div>
          </div>

          {/* OVERALL MATCH TIMER */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-black text-xs sm:text-sm shadow-md border transition-all ${
              matchTimeLeft <= 30
                ? "bg-rose-500/20 border-rose-500/50 text-rose-300 animate-pulse"
                : "bg-[#141828] border-slate-800 text-amber-300"
            }`}
            title="Overall Arena Match Time Remaining"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{formatTimer(matchTimeLeft)}</span>
          </div>

          {/* PERSONAL SCORE BADGE */}
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-mono font-black text-xs sm:text-sm">
            <Zap className="w-3.5 h-3.5 text-indigo-400" />
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

      {/* Rivals Rank & Score Strip (Sorted #1 first, NO HP) */}
      {rivals.length > 0 && (
        <div className="max-w-4xl w-full mx-auto mb-3 p-2 rounded-2xl bg-[#0f1527]/90 border border-slate-800/80 flex items-center gap-2 overflow-x-auto no-scrollbar shadow-inner">
          <span className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-wider shrink-0 px-2 flex items-center gap-1">
            <Users className="w-3 h-3 text-indigo-400" />
            RIVALS ({rivals.length}):
          </span>
          {rivals.map((rival) => {
            return (
              <div
                key={rival.studentId}
                className="shrink-0 flex items-center gap-2 px-2.5 py-1 rounded-xl border text-xs bg-[#141b30] border-slate-700/80 text-white shadow-sm"
              >
                <span className="text-base">{rival.avatar || "🎓"}</span>
                <div className="flex flex-col min-w-[70px]">
                  <div className="flex items-center gap-1 font-bold text-[11px] truncate max-w-[95px]">
                    <span className="text-amber-400 font-mono">#{rival.rank}</span>
                    <span>{rival.studentName}</span>
                    {rival.hasShield && <span title="Shield Armed">🛡️</span>}
                  </div>
                  <div className="text-[10px] font-mono font-bold text-slate-300">
                    {rival.score} pts
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Question / Early Finish Area */}
      <main className="max-w-4xl w-full mx-auto my-auto flex flex-col justify-center">
        {questionsCompleted ? (
          <div className="bg-gradient-to-br from-[#12182b] to-[#0d1222] border border-indigo-500/30 rounded-3xl p-6 sm:p-10 shadow-2xl text-center space-y-4 animate-in zoom-in-95">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-slate-950 mx-auto shadow-lg">
              <Check className="w-8 h-8 stroke-[3]" />
            </div>

            <h2 className="text-2xl sm:text-3xl font-black text-white">
              All Questions Completed!
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
              Your questions are finished and your current score of <span className="text-amber-300 font-bold font-mono">{score} PTS</span> is locked in.
              Use your remaining battle powers, track rivals, and wait for the match timer to conclude!
            </p>

            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-mono font-bold">
              <span>Overall Match Countdown: </span>
              <span className="text-amber-300 font-black">{formatTimer(matchTimeLeft)}</span>
            </div>
          </div>
        ) : currentQ ? (
          <div className="bg-gradient-to-br from-[#12182b] to-[#0d1222] border border-indigo-500/20 rounded-3xl p-5 sm:p-8 shadow-2xl">
            {/* Progress indicator */}
            <div className="w-full h-1.5 bg-slate-800 rounded-full mb-6 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 via-rose-500 to-indigo-500 transition-all duration-300"
                style={{
                  width: `${Math.max(5, ((currentQuestionIndex + 1) / questions.length) * 100)}%`,
                }}
              />
            </div>

            <div className="mb-6 sm:mb-8">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-mono font-black px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Question {currentQuestionIndex + 1} of {questions.length}
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
                const wasCorrect = answerFeedback?.choiceId === choice.id
                  ? answerFeedback.isCorrect
                  : currentAnswer?.isCorrect;

                let cardStyle = "bg-[#161d33]/80 hover:bg-[#1c2542] border-slate-800 text-slate-200 hover:border-slate-700";
                if (isSelected) {
                  if (answerFeedback || isQuestionAnswered) {
                    cardStyle = wasCorrect
                      ? "bg-emerald-500/20 border-emerald-500/60 text-emerald-200 font-bold shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                      : "bg-rose-500/20 border-rose-500/60 text-rose-200 font-bold shadow-[0_0_20px_rgba(244,63,94,0.3)]";
                  } else {
                    cardStyle = "bg-indigo-600/30 border-indigo-500 text-white font-bold";
                  }
                }

                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => void handleSelectChoice(choice.id)}
                    disabled={isQuestionAnswered || isSubmittingAnswer}
                    className={`relative p-4 sm:p-5 rounded-2xl border text-left flex items-center justify-between transition-all duration-200 cursor-pointer shadow-md ${cardStyle} ${
                      !isQuestionAnswered && !isSubmittingAnswer ? "hover:scale-[1.01] active:scale-[0.99]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-xl bg-black/30 border border-white/10 flex items-center justify-center font-mono font-bold text-xs text-slate-300">
                        {String.fromCharCode(65 + cIndex)}
                      </span>
                      <span className="text-sm sm:text-base font-semibold">{choice.choiceText}</span>
                    </div>

                    {isSelected && (answerFeedback || isQuestionAnswered) && (
                      <span className="text-lg">
                        {wasCorrect ? (
                          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                        ) : (
                          <XCircle className="w-6 h-6 text-rose-400" />
                        )}
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

      {/* Bottom Battle Arsenal Dock (1x per match) */}
      <footer className="max-w-4xl w-full mx-auto mt-4">
        <ArenaBattleDock
          inventory={usedPowers}
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
