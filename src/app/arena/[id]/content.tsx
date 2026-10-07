"use client";

import { ArenaEffects } from "@/components/arena/arena-effects";

import { acceptArenaRevision, acceptArenaEventRevision, guardArenaChannel, hasTerminalArenaFeedback } from "@/lib/arena-feedback";
import { beginArenaGameplayAction, fetchArenaSnapshot, isTerminalArenaSnapshot, startArenaReconciliation, type ArenaSnapshot } from "@/lib/arena-client-reconciliation";

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
  ArrowRight,
  ArrowLeft,
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
import { ArenaIdentity } from "@/components/arena/arena-identity";
import type { ArenaQuestionWork } from "@/lib/arena-question-work";
import type { ArenaParticipant, ArenaState } from "@/lib/arena";
import { getStudentInitials } from "@/lib/student-identity";
import { claimArenaFeedback, getShieldTerminalOutcome, type ArenaFeedbackOutcome } from "@/lib/arena-feedback";

function playAttackSound(powerType: string) {
  if (powerType === "meteor") playMeteorSound();
  else if (powerType === "earthquake") playEarthquakeSound();
  else if (powerType === "blizzard") playBlizzardSound();
  else if (powerType === "shield") playShieldDeflectSound();
}

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
  initialQuestionWork?: ArenaQuestionWork;
  savedAnswers: SavedAnswer[];
}

interface IncomingAttackAlert {
  attackId: string;
  sessionId?: string;
  attackerId: string;
  attackerName: string;
  targetStudentId?: string;
  targetId?: string;
  targetName?: string;
  powerType: string;
  scorePenalty: number;
  damage?: number;
  createdAt?: number;
  expiresAt?: number;
  warningExpiry: string;
  reactionWindowMs: number;
  status?: "pending" | "deflected" | "hit" | "cancelled";
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
  initialQuestionWork,
}: ArenaContentProps) {
  const arenaRevisionRef = useRef(0);
  const router = useRouter();

  const isAlreadyEnded = initialQuizStatus === "ended" || initialStudentStatus === "completed";
  const [phase, setPhase] = useState<"lobby" | "in_wave" | "finalizing" | "podium">(
    isAlreadyEnded ? "finalizing" : "lobby"
  );
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizationError, setFinalizationError] = useState<string | null>(null);
  const finalizationAttemptedRef = useRef(false);
  const finalizationInFlightRef = useRef(false);
  const finalizationConfirmedRef = useRef(false);
  const finalizationGenerationRef = useRef(0);
  const arenaCompletedRef = useRef(isAlreadyEnded);
  const [arenaCompleted, setArenaCompleted] = useState(isAlreadyEnded);
  const terminalResultReconciledRef = useRef(false);
  const reconciliationRef = useRef<ReturnType<typeof startArenaReconciliation> | null>(null);
  const snapshotSessionRef = useRef<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const gameplayTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const gameplayRequestsRef = useRef(new Map<AbortController, ReturnType<typeof setTimeout>>());
  const clearGameplayTimers = useCallback(() => {
    for (const timer of gameplayTimersRef.current) clearTimeout(timer);
    gameplayTimersRef.current.clear();
    for (const [controller, timer] of gameplayRequestsRef.current) {
      clearTimeout(timer);
      controller.abort();
    }
    gameplayRequestsRef.current.clear();
  }, []);
  const readGameplayResponse = useCallback(async (url: string, options: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    gameplayRequestsRef.current.set(controller, timer);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const data = await response.json();
      return { ok: response.ok, data };
    } finally {
      clearTimeout(timer);
      gameplayRequestsRef.current.delete(controller);
    }
  }, []);
  useEffect(() => {
    const generation = finalizationGenerationRef;
    arenaRevisionRef.current = 0;
    generation.current++;
    return () => { generation.current++; clearGameplayTimers(); };
  }, [quizId, clearGameplayTimers]);
  const captureGameplayAction = useCallback(() => beginArenaGameplayAction(() => ({
    revision: arenaRevisionRef.current, sessionId: snapshotSessionRef.current,
    generation: finalizationGenerationRef.current,
    terminal: terminalResultReconciledRef.current || arenaCompletedRef.current,
  })), []);
  const readRealtimeIdentity = useCallback(() => ({ quizId, sessionId: snapshotSessionRef.current,
    terminal: terminalResultReconciledRef.current || arenaCompletedRef.current }), [quizId]);
  const scheduleGameplayCallback = useCallback((action: ReturnType<typeof beginArenaGameplayAction>, run: () => void, delay: number) => {
    const timer = setTimeout(() => {
      gameplayTimersRef.current.delete(timer);
      if (action.isSameView()) run();
    }, delay);
    gameplayTimersRef.current.add(timer);
  }, []);

  // ── Automatic Question Progression ────────────────────────────
  const initialUnansweredIndex = questions.findIndex(
    (q) => !savedAnswers.some((ans) => ans.questionId === q.id)
  );
  const startingQuestionIndex =
    initialUnansweredIndex >= 0
      ? initialUnansweredIndex
      : Math.max(0, questions.length - 1);

  const [questionWork, setQuestionWork] = useState<ArenaQuestionWork | null>(initialQuestionWork ?? null);
  const initialWorkIndex = initialQuestionWork?.nextWork ? questions.findIndex(q => q.id === initialQuestionWork.nextWork!.questionId) : startingQuestionIndex;
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(Math.max(0, initialWorkIndex));
  const [questionsCompleted, setQuestionsCompleted] = useState(
    (initialQuestionWork?.isFinished ?? (savedAnswers.length >= questions.length && questions.length > 0)) || isAlreadyEnded
  );
  const [isSpectating, setIsSpectating] = useState(false);
  const [battleLogs, setBattleLogs] = useState<string[]>([]);
  const [expEarned, setExpEarned] = useState(100);

  // ── Overall Server-Authoritative Match Timer ──────────────────
  const [matchEndsAt, setMatchEndsAt] = useState<string | null>(null);
  const [matchTimeLeft, setMatchTimeLeft] = useState<number>(1800); // 30 minutes default

  // ── Score, Ranking & Participants ─────────────────────────────
  const [score, setScore] = useState(0); // Reconciliation supplies authoritative Arena points.
  const [studentRank, setStudentRank] = useState<number>(1);
  const [totalParticipants, setTotalParticipants] = useState<number>(1);
  const [streak, setStreak] = useState(0);
  const [highestStreak, setHighestStreak] = useState(0);

  // ── Rivals (Ranked by score descending, NO HP) ────────────────
  const [rivals, setRivals] = useState<ArenaParticipant[]>([]);
  const [targetPickerPower, setTargetPickerPower] = useState<BattlePowerType | null>(null);
  const [incomingAttack, setIncomingAttack] = useState<IncomingAttackAlert | null>(null);
  const [reactionTimeLeftMs, setReactionTimeLeftMs] = useState<number>(0);
  const [isShieldActivating, setIsShieldActivating] = useState(false);
  const incomingAttackRef = useRef<IncomingAttackAlert | null>(null);
  const serverTimeOffsetRef = useRef(0);

  useEffect(() => {
    incomingAttackRef.current = incomingAttack;
  }, [incomingAttack]);

  const getServerAdjustedNow = useCallback(() => Date.now() + serverTimeOffsetRef.current, []);
  const clearIncomingAttack = useCallback((attackId?: string) => {
    if (attackId && incomingAttackRef.current?.attackId !== attackId) return;
    setIncomingAttack((current) => {
      if (attackId && current?.attackId !== attackId) return current;
      return null;
    });
    incomingAttackRef.current = null;
    setIsShieldActivating(false);
  }, []);

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
    visualId?: string;
    blockedPower?: "meteor" | "earthquake" | "blizzard";
    penalty: number;
    message: string;
  } | null>(null);
  const [scoreDeductionPopup, setScoreDeductionPopup] = useState<number | null>(null);
  const [celebrationMessage, setCelebrationMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const displayedAttackFeedbackRef = useRef(new Set<string>());
  const attackFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const claimAttackFeedback = useCallback((attackId: string, outcome: ArenaFeedbackOutcome) =>
    claimArenaFeedback(displayedAttackFeedbackRef.current, attackId, outcome), []);
  const showAttackFeedback = useCallback((
    attackId: string,
    outcome: ArenaFeedbackOutcome,
    effect: NonNullable<typeof activeAttackEffect>,
    scoreDeduction?: number,
  ) => {
    if (!claimAttackFeedback(attackId, outcome)) return false;
    if (attackFeedbackTimerRef.current) clearTimeout(attackFeedbackTimerRef.current);
    setActiveAttackEffect({ ...effect, visualId: attackId });
    setScoreDeductionPopup(scoreDeduction ?? null);
    attackFeedbackTimerRef.current = setTimeout(() => {
      setActiveAttackEffect(null);
      setScoreDeductionPopup(null);
      attackFeedbackTimerRef.current = null;
    }, 4000);
    return true;
  }, [claimAttackFeedback]);

  useEffect(() => () => {
    if (attackFeedbackTimerRef.current) clearTimeout(attackFeedbackTimerRef.current);
  }, []);

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
        initials: p.initials || getStudentInitials(p.studentName, "ST"),
        score: p.score,
        rank: p.rank,
      }));
      setAllParticipants(podiumList);
      setPodium(podiumList.slice(0, 3));
    },
    [studentId]
  );

  const applyGameplayState = useCallback((data: ArenaSnapshot) => {
    if (!captureGameplayAction().isCurrent(data) || !acceptArenaEventRevision(arenaRevisionRef, data, readRealtimeIdentity())) return false;
    if (Array.isArray(data.participants)) updateRankingsFromParticipants(data.participants);
    else {
      if (typeof data.score === "number" && Number.isFinite(data.score)) setScore(data.score);
      if (typeof data.rank === "number") setStudentRank(data.rank);
    }
    if (typeof data.totalCount === "number") setTotalParticipants(data.totalCount);
    const me = data.participants?.find((p) => p.studentId === studentId);
    if (me) setHasGuardianShield(Boolean(me.hasShield));
    const powers = data.usedPowers ?? data.arena?.usedPowers?.[studentId];
    if (powers) setUsedPowers({ ...powers });
    return true;
  }, [captureGameplayAction, readRealtimeIdentity, studentId, updateRankingsFromParticipants]);

  // ── Conclude Match & Finalize Results ─────────────────────────
  const finalizeMatch = useCallback(async (retry = false) => {
    if (finalizationConfirmedRef.current || finalizationInFlightRef.current || (finalizationAttemptedRef.current && !retry)) return;
    finalizationAttemptedRef.current = true;
    finalizationInFlightRef.current = true;
    const generation = finalizationGenerationRef.current;
    setIsFinalizing(true);
    setFinalizationError(null);
    setIncomingAttack(null);
    setTargetPickerPower(null);
    setIsLaunchingPower(null);
    setPhase("finalizing");

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
      const submitData = await submitRes.json().catch(() => null);
      if (generation !== finalizationGenerationRef.current) return;
      if (!submitRes.ok || submitData?.success !== true) {
        throw new Error(submitData?.error || "Could not finalize your Arena result.");
      }
      const accepted = acceptArenaRevision(arenaRevisionRef, submitData);
      if (accepted && typeof submitData.result?.score === "number" && Number.isFinite(submitData.result.score)) {
        setScore(submitData.result.score);
      }
      if (accepted && typeof submitData.expEarned === "number") {
        setExpEarned(submitData.expEarned);
      } else if (accepted && typeof submitData.result?.expEarned === "number") {
        setExpEarned(submitData.result.expEarned);
      }
      if (accepted && typeof submitData.rank === "number") {
        setStudentRank(submitData.rank);
      }
      finalizationConfirmedRef.current = true;
      arenaCompletedRef.current = true;
      setArenaCompleted(true);
      // Completion and a reconciled final leaderboard are different facts.
      // Keep reading committed results even if the first read fails.
      void reconciliationRef.current?.refresh();
    } catch (error) {
      if (generation !== finalizationGenerationRef.current) return;
      setFinalizationError(error instanceof Error ? error.message : "Network error finalizing your Arena result.");
      return;
    } finally {
      if (generation === finalizationGenerationRef.current) {
        finalizationInFlightRef.current = false;
        setIsFinalizing(false);
      }
    }

  }, [quizId, lockedAnswers]);

  // ── Explicit Arena Join on Mount ──────────────────────────────
  useEffect(() => {
    if (isAlreadyEnded) return; // Completed reloads use only the snapshot reader.
    const generation = finalizationGenerationRef.current;
    let isMounted = true;
    async function joinArena() {
      try {
        const timerRequestStartedAt = Date.now();
        const res = await fetch(`/api/arena/${quizId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "join" }),
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => null);
          if (!isMounted) return;
          if (res.status === 409 && ["ARENA_QUIZ_ALREADY_COMPLETED", "ARENA_ENDED"].includes(errorData?.code)) {
            arenaCompletedRef.current = true;
            setArenaCompleted(true);
            void reconciliationRef.current?.refresh();
          }
          return;
        }
        const data = await res.json();
        if (generation !== finalizationGenerationRef.current || arenaCompletedRef.current) return;
        if (!acceptArenaRevision(arenaRevisionRef, data)) return;
        if (!isMounted) return;
        if (finalizationAttemptedRef.current) return;

        if (typeof data.serverTime === "number") {
          serverTimeOffsetRef.current = data.serverTime - ((timerRequestStartedAt + Date.now()) / 2);
        }
        const sessId = data?.sessionId || data?.arena?.sessionId;
        if (sessId) {
          snapshotSessionRef.current = sessId;
          setCurrentSessionId(sessId);
        }

        const currentStatus = data?.status || data?.arena?.status;
        if (currentStatus === "active") {
          setPhase("in_wave");
          if (data.arena?.matchEndsAt) {
            setMatchEndsAt(data.arena.matchEndsAt);
            const endsAt = Date.parse(data.arena.matchEndsAt);
            if (Number.isFinite(endsAt)) {
              setMatchTimeLeft(Math.max(0, Math.ceil((endsAt - getServerAdjustedNow()) / 1000)));
            }
          }
        } else if (currentStatus === "ended" || data?.quizStatus === "ended") {
          arenaCompletedRef.current = true;
          setArenaCompleted(true);
          void reconciliationRef.current?.refresh();
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
  }, [quizId, isAlreadyEnded, updateRankingsFromParticipants, getServerAdjustedNow]);

  // ── Fetch Initial / Reconciled Arena State ─────────────────────
  const applyArenaSnapshot = useCallback((data: ArenaSnapshot) => {
      if ([data.quizId, data.arena?.quizId].some(id => id !== undefined && id !== quizId)) return false;
      if (!acceptArenaRevision(arenaRevisionRef, data)) return false;
      const snapshotSession = data.sessionId ?? data.arena?.sessionId;
      if (snapshotSession && snapshotSessionRef.current && snapshotSession !== snapshotSessionRef.current) {
        clearGameplayTimers();
        finalizationGenerationRef.current++;
        finalizationInFlightRef.current = false;
        setIsFinalizing(false);
        finalizationAttemptedRef.current = false; finalizationConfirmedRef.current = false;
        arenaCompletedRef.current = false; terminalResultReconciledRef.current = false;
        setArenaCompleted(false);
        setFinalizationError(null);
        setIncomingAttack(null); setTargetPickerPower(null);
        setCurrentQuestionIndex(0); setQuestionsCompleted(false); setIsSpectating(false);
        setSelectedChoice(null); setAnswerFeedback(null); setLockedAnswers(new Map());
        setScore(0); setUsedPowers({}); setHasGuardianShield(false);
        setIsSubmittingAnswer(false); setIsLaunchingPower(null); setBattleLogs([]);
      }
      if (snapshotSession) { snapshotSessionRef.current = snapshotSession; setCurrentSessionId(snapshotSession); }
      if (data.questionWork && data.questionWork.attemptId === studentQuizId) {
        setQuestionWork(data.questionWork); setQuestionsCompleted(data.questionWork.isFinished);
        if (data.questionWork.nextWork) setCurrentQuestionIndex(Math.max(0, questions.findIndex(q => q.id === data.questionWork!.nextWork!.questionId)));
      }
      if (isTerminalArenaSnapshot(data) && data.result && Number.isFinite(data.result.score)
        && data.participants?.some((p) => p.studentId === studentId)) {
        clearGameplayTimers();
        updateRankingsFromParticipants(data.participants);
        setScore(data.result.score); setStudentRank(data.result.rank); setExpEarned(data.result.expEarned);
        setHasGuardianShield(Boolean(data.participants.find((p) => p.studentId === studentId)?.hasShield));
        setUsedPowers({ ...(data.usedPowers ?? data.arena?.usedPowers?.[studentId] ?? {}) });
        arenaCompletedRef.current = true; terminalResultReconciledRef.current = true;
        setArenaCompleted(true);
        finalizationConfirmedRef.current = true; finalizationAttemptedRef.current = true;
        setIncomingAttack(null); setTargetPickerPower(null); setFinalizationError(null);
        setIsSubmittingAnswer(false); setIsLaunchingPower(null);
        setPhase("podium");
        return true;
      }
      const responseReceivedAt = Date.now();
      if (typeof data?.serverTime === "number") {
        serverTimeOffsetRef.current = data.serverTime - (((data.clientRequestStartedAt ?? responseReceivedAt) + responseReceivedAt) / 2);
      }

      const sessId = data?.sessionId || data?.arena?.sessionId;
      if (sessId) {
        setCurrentSessionId(sessId);
      }

      // Authoritative finished state from server
      const currentStatus = data?.status || data?.arena?.status;
      if (currentStatus === "ended" || data?.quizStatus === "ended") {
        arenaCompletedRef.current = true;
        setArenaCompleted(true);
        setIncomingAttack(null);
        if (!terminalResultReconciledRef.current) setPhase("finalizing");
        return false;
      }
      if (finalizationAttemptedRef.current) return false;

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
            const remaining = Math.max(0, Math.ceil((endsAt - getServerAdjustedNow()) / 1000));
            setMatchTimeLeft(remaining);
          }
        }
      } else if (currentStatus === "lobby") {
        setPhase("lobby");
      }

      // Restore usedPowers from server
      if (data?.usedPowers && typeof data.usedPowers === "object") {
        setUsedPowers({ ...data.usedPowers });
      }

      // Reconcile participants and rankings
      if (Array.isArray(data?.participants)) {
        updateRankingsFromParticipants(data.participants);
        const me = data.participants.find((p) => p.studentId === studentId);
        if (me) setHasGuardianShield(Boolean(me.hasShield));
      }

      const activeIncomingAttack = incomingAttackRef.current;
      if (activeIncomingAttack) {
        const authoritativeAttack = data?.arena?.pendingAttacks?.[activeIncomingAttack.attackId];
        if (!authoritativeAttack || authoritativeAttack.status !== "pending") {
          clearIncomingAttack(activeIncomingAttack.attackId);
          if (authoritativeAttack?.status === "deflected") {
            showAttackFeedback(activeIncomingAttack.attackId, "deflected", {
              type: "deflected",
              blockedPower: activeIncomingAttack.powerType as "meteor" | "earthquake" | "blizzard",
              attackerName: activeIncomingAttack.attackerName,
              penalty: 0,
              message: `DEFLECTED! Guardian Shield protected your score from ${activeIncomingAttack.attackerName}'s ${activeIncomingAttack.powerType.toUpperCase()}! (0 PTS lost)`,
            });
            setErrorMessage(null);
          } else if (authoritativeAttack?.status === "hit") {
            const penalty = authoritativeAttack.scorePenalty || activeIncomingAttack.scorePenalty || 40;
            showAttackFeedback(activeIncomingAttack.attackId, "hit", {
              type: activeIncomingAttack.powerType as "meteor" | "earthquake" | "blizzard",
              attackerName: activeIncomingAttack.attackerName,
              penalty,
              message: `${activeIncomingAttack.attackerName}'s ${activeIncomingAttack.powerType.toUpperCase()} HIT YOU FOR -${penalty} PTS!`,
            }, penalty);
            setErrorMessage(null);
          }
        }
      }
      return false;
  }, [quizId, studentId, studentQuizId, questions, updateRankingsFromParticipants, clearIncomingAttack, showAttackFeedback, clearGameplayTimers, getServerAdjustedNow]);

  const refreshArenaState = useCallback(async () => { await reconciliationRef.current?.refresh(); }, []);

  // Periodic background state reconciliation
  useEffect(() => {
    const worker = startArenaReconciliation({ read: (signal) => fetchArenaSnapshot(quizId, signal),
      apply: (data) => applyArenaSnapshot(data) === true });
    reconciliationRef.current = worker;
    const refresh = () => { if (!document.hidden) void worker.refresh(); };
    window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => {
      worker.stop(); reconciliationRef.current = null;
      window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh);
    };
  }, [quizId, applyArenaSnapshot]);

  // ── Realtime Pusher Subscription (private-arena-${quizId} ONLY) ──
  useEffect(() => {
    let pusher: PusherClient | null = null;
    let subscribed = true;

    try {
      pusher = new PusherClient(
        process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
        {
          cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1",
          authEndpoint: "/api/pusher/auth",
        }
      );

      const arenaChannel = guardArenaChannel(pusher.subscribe(`private-arena-${quizId}`), arenaRevisionRef, {
        getIdentity: readRealtimeIdentity,
        isLive: () => subscribed,
        onStateHint: () => reconciliationRef.current?.hint(),
        onSessionHint: () => reconciliationRef.current?.hint({ allowTerminal: true }),
      });
      pusher.connection.bind("connected", () => { void reconciliationRef.current?.refresh(); });

      // ── Student Joined Event in Realtime ─────────────────────────
      arenaChannel.bind("arena-student-joined", (data?: ArenaSnapshot & { quizId?: number }) => {
        if (arenaCompletedRef.current || terminalResultReconciledRef.current) return;
        if (data?.quizId !== undefined && data.quizId !== quizId) return;
        const sessionId = data?.sessionId ?? data?.arena?.sessionId;
        if (sessionId && sessionId !== snapshotSessionRef.current) return;
        reconciliationRef.current?.hint();
      });

      // ── Match Started by Teacher ─────────────────────────────────
      arenaChannel.bind("arena-start", (data?: {
        arena?: ArenaState;
        sessionId?: string;
        matchEndsAt?: string;
        matchDuration?: number;
        serverTime?: number;
        participants?: ArenaParticipant[];
      }) => {
        if (finalizationAttemptedRef.current || arenaCompletedRef.current) return;
        if (typeof data?.serverTime === "number") serverTimeOffsetRef.current = data.serverTime - Date.now();
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
            setMatchTimeLeft(Math.max(0, Math.ceil((endsAtMs - getServerAdjustedNow()) / 1000)));
          }
        } else if (data?.matchDuration) {
          setMatchTimeLeft(data.matchDuration);
        }
        if (Array.isArray(data?.participants)) {
          updateRankingsFromParticipants(data.participants);
        }
      });

      // ── Dedicated Session Reset / Fresh Session Event ─────────────
      const handleSessionCreated = () => {
        // Session adoption/reset occurs only in applyArenaSnapshot.
        reconciliationRef.current?.hint({ allowTerminal: true });
      };
      arenaChannel.bind("arena-session-created", handleSessionCreated);
      arenaChannel.bind("arena-reset", handleSessionCreated);

      // ── Match Ended by Teacher / Server ──────────────────────────
      arenaChannel.bind("arena-end", (data?: ArenaSnapshot) => {
        if (terminalResultReconciledRef.current) return;
        if (Array.isArray(data?.participants)) updateRankingsFromParticipants(data.participants);
        arenaCompletedRef.current = true;
        setArenaCompleted(true);
        setIncomingAttack(null);
        setPhase("finalizing");
        void reconciliationRef.current?.refresh();
      });

      // ── Host Airdrop ─────────────────────────────────────────────
      arenaChannel.bind("arena-airdrop", (data: ArenaSnapshot) => {
        if (!applyGameplayState(data)) { void refreshArenaState(); return; }
        if (soundEnabled) playShieldDeflectSound();
        setCelebrationMessage("🎁 HOST AIRDROP! +50 Bonus Points & Guardian Shield Armed!");
        scheduleGameplayCallback(captureGameplayAction(), () => setCelebrationMessage(null), 4000);
      });

      // ── Incoming Attack Warning Event ────────────────────────────
      const handleIncomingAttackEvent = (data: IncomingAttackAlert) => {
        if (arenaCompletedRef.current || terminalResultReconciledRef.current) return;
        if (hasTerminalArenaFeedback(displayedAttackFeedbackRef.current, data.attackId)) return;
        if (data.sessionId && currentSessionId && data.sessionId !== currentSessionId) return;
        if (data.targetStudentId === studentId) {
          if (incomingAttackRef.current?.attackId === data.attackId) return;
          incomingAttackRef.current = data;
          setIncomingAttack(data);
          setIsShieldActivating(false);
          setErrorMessage(null);
          const expiry = typeof data.expiresAt === "number"
            ? data.expiresAt
            : (data.warningExpiry ? Date.parse(data.warningExpiry) : getServerAdjustedNow() + 2500);
          setReactionTimeLeftMs(Math.max(0, expiry - getServerAdjustedNow()));
        } else if (data.attackerId === studentId) {
          if (claimAttackFeedback(data.attackId, "launched")) {
            setCelebrationMessage(`🚀 STRIKE LAUNCHED at ${data.targetName}! Strike in progress...`);
            scheduleGameplayCallback(captureGameplayAction(), () => setCelebrationMessage(null), 2500);
          }
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
        targetId?: string;
        targetName: string;
        powerType: string;
        scorePenalty?: number;
        damage?: number;
        targetCurrentScore: number;
        targetRank: number;
        participants?: ArenaParticipant[];
        sessionId?: string;
        status?: string;
      }) => {
        if (arenaCompletedRef.current || terminalResultReconciledRef.current) return;
        if (data.sessionId && currentSessionId && data.sessionId !== currentSessionId) return;
        const applySnapshot = applyGameplayState(data);
        if (!applySnapshot) void refreshArenaState();
        const penalty = data.scorePenalty || data.damage || 40;
        const isStaleForModal = Boolean(
          incomingAttackRef.current && incomingAttackRef.current.attackId !== data.attackId,
        );

        if (data.targetStudentId === studentId) {
          if (applySnapshot) {
            setScore(data.targetCurrentScore);
            setStudentRank(data.targetRank);
          }
          if (isStaleForModal) {
            claimAttackFeedback(data.attackId, "hit");
            if (applySnapshot && Array.isArray(data.participants)) updateRankingsFromParticipants(data.participants);
            return;
          }
          clearIncomingAttack(data.attackId);
          const feedbackShown = showAttackFeedback(data.attackId, "hit", {
            type: (data.powerType as "meteor" | "earthquake" | "blizzard") || "meteor",
            attackerName: data.attackerName,
            penalty,
            message: `${data.attackerName}'s ${data.powerType.toUpperCase()} HIT YOU FOR -${penalty} PTS!`,
          }, penalty);
          if (feedbackShown && soundEnabled) {
            if (data.powerType === "meteor") playMeteorSound();
            else if (data.powerType === "earthquake") playEarthquakeSound();
            else if (data.powerType === "blizzard") playBlizzardSound();
          }
        } else if (data.attackerId === studentId) {
          if (claimAttackFeedback(data.attackId, "hit")) {
            setCelebrationMessage(`🎯 DIRECT HIT on ${data.targetName}! -${penalty} PTS deducted!`);
            scheduleGameplayCallback(captureGameplayAction(), () => setCelebrationMessage(null), 3000);
          }
        }

        if (applySnapshot && Array.isArray(data.participants)) {
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
        targetId?: string;
        targetName: string;
        powerType: string;
        message?: string;
        sessionId?: string;
        status?: string;
      }) => {
        if (arenaCompletedRef.current || terminalResultReconciledRef.current) return;
        if (data.sessionId && currentSessionId && data.sessionId !== currentSessionId) return;
        applyGameplayState(data);
        // This event describes the outcome, not the full current protection state.
        // Read committed state instead of inferring a Shield mutation from it.
        void refreshArenaState();
        if (data.targetStudentId === studentId) {
          if (incomingAttackRef.current && incomingAttackRef.current.attackId !== data.attackId) {
            claimAttackFeedback(data.attackId, "deflected");
            return;
          }
          clearIncomingAttack(data.attackId);
          const feedbackShown = showAttackFeedback(data.attackId, "deflected", {
            type: "deflected",
            blockedPower: data.powerType as "meteor" | "earthquake" | "blizzard",
            attackerName: data.attackerName,
            penalty: 0,
            message: `DEFLECTED! Guardian Shield protected your score from ${data.attackerName}'s ${data.powerType.toUpperCase()}! (0 PTS lost)`,
          });
          if (feedbackShown && soundEnabled) playShieldDeflectSound();
        } else if (data.attackerId === studentId) {
          if (claimAttackFeedback(data.attackId, "deflected")) {
            setCelebrationMessage(`🛡️ ${data.targetName} blocked your ${data.powerType.toUpperCase()} with Guardian Shield! (0 PTS deducted)`);
            scheduleGameplayCallback(captureGameplayAction(), () => setCelebrationMessage(null), 3000);
          }
        }
      };
      arenaChannel.bind("arena-attack-blocked", handleAttackBlockedEvent);
      arenaChannel.bind("attack-blocked", handleAttackBlockedEvent);

      // ── Live Score / Leaderboard Update ──────────────────────────
      arenaChannel.bind("arena-score-updated", (data: ArenaSnapshot & {
        studentId: string;
        score: number;
        rank: number;
        totalCount: number;
      }) => {
        if (arenaCompletedRef.current || terminalResultReconciledRef.current) return;
        if (data.studentId === studentId) {
          if (!applyGameplayState(data)) void refreshArenaState();
        }
      });

      arenaChannel.bind("arena-leaderboard-updated", (data: ArenaSnapshot) => {
        if (arenaCompletedRef.current || terminalResultReconciledRef.current) return;
        if (!applyGameplayState(data)) void refreshArenaState();
      });

      // ── Authoritative Arena End Event ────────────────────────────
      arenaChannel.bind("arena-end", (data?: ArenaSnapshot) => {
        if (terminalResultReconciledRef.current) return;
        if (Array.isArray(data?.participants)) updateRankingsFromParticipants(data.participants);
        arenaCompletedRef.current = true;
        setArenaCompleted(true);
        setIncomingAttack(null);
        setTargetPickerPower(null);
        setPhase("finalizing");
        void reconciliationRef.current?.refresh();
      });
    } catch (e) {
      console.error("Arena Pusher connection error:", e);
    }

    return () => {
      subscribed = false;
      if (pusher) {
        pusher.unsubscribe(`private-arena-${quizId}`);
        pusher.disconnect();
      }
    };
  }, [
    quizId,
    studentId,
    currentSessionId,
    soundEnabled,
    finalizeMatch,
    updateRankingsFromParticipants,
    clearIncomingAttack,
    getServerAdjustedNow,
    claimAttackFeedback,
    showAttackFeedback,
    applyGameplayState, captureGameplayAction, clearGameplayTimers, scheduleGameplayCallback, refreshArenaState, readRealtimeIdentity,
  ]);

  // ── Reaction Countdown Interval for Incoming Attack ───────────
  useEffect(() => {
    if (!incomingAttack) return;
    const action = captureGameplayAction();
    const expiry = typeof incomingAttack.expiresAt === "number"
      ? incomingAttack.expiresAt
      : (incomingAttack.warningExpiry ? Date.parse(incomingAttack.warningExpiry) : getServerAdjustedNow() + 2500);

    setReactionTimeLeftMs(Math.max(0, expiry - getServerAdjustedNow()));

    const interval = setInterval(() => {
      if (!action.isSameView()) { clearInterval(interval); return; }
      const remaining = Math.max(0, expiry - getServerAdjustedNow());
      setReactionTimeLeftMs(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        void refreshArenaState();
      }
    }, 50);
    const staleSafeguard = setTimeout(() => {
      if (!action.isSameView()) return;
      if (incomingAttackRef.current?.attackId === incomingAttack.attackId) {
        clearIncomingAttack(incomingAttack.attackId);
        void refreshArenaState();
      }
    }, Math.max(0, expiry - getServerAdjustedNow()) + 10_000);
    return () => {
      clearInterval(interval);
      clearTimeout(staleSafeguard);
    };
  }, [incomingAttack, getServerAdjustedNow, refreshArenaState, clearIncomingAttack, captureGameplayAction]);

  // ── Overall Match Timer Countdown ─────────────────────────────
  useEffect(() => {
    if (phase !== "in_wave") return;

    const timer = setInterval(() => {
      if (matchEndsAt) {
        const remaining = Math.max(0, Math.ceil((Date.parse(matchEndsAt) - getServerAdjustedNow()) / 1000));
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
  }, [phase, matchEndsAt, finalizeMatch, getServerAdjustedNow]);

  // ── Automatic Student Question Progression ────────────────────
  const handleSelectChoice = async (choiceId: number) => {
    const action = captureGameplayAction();
    if (!action.isSameView()) return;
    const currentQ = questions[currentQuestionIndex];
    const isRetry = questionWork?.nextWork?.kind === "retry" && questionWork.nextWork.questionId === currentQ?.id;
    if (!currentQ || (!isRetry && lockedAnswers.has(currentQ.id)) || isSubmittingAnswer) return;

    setSelectedChoice(choiceId);
    setIsSubmittingAnswer(true);
    setErrorMessage(null);

    try {
      const { ok, data } = await readGameplayResponse("/api/quizzes/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId,
          studentQuizId,
          answerKind: isRetry ? "retry" : "initial",
          questionId: currentQ.id,
          sessionId: currentSessionId,
          choiceId,
        }),
      });

      if (!ok) {
        if (action.isCurrent()) setErrorMessage(data.error || "Failed to submit answer.");
        void refreshArenaState();
        return;
      }
      if (!action.isCurrent(data)) { void refreshArenaState(); return; }

      const isCorrect = Boolean(data.isCorrect);
      applyGameplayState(data);
      if (!isRetry) setLockedAnswers((prev) => new Map(prev).set(currentQ.id, { choiceId, isCorrect }));
      setAnswerFeedback({ isCorrect, choiceId });
      playFeedbackChime(isCorrect);

      if (isCorrect) {
        const nextStreak = streak + 1;
        setStreak(nextStreak);
        if (nextStreak > highestStreak) setHighestStreak(nextStreak);
      } else {
        setStreak(0);
      }

      if (typeof data.rank === "number") setStudentRank(data.rank);
      if (typeof data.totalCount === "number") setTotalParticipants(data.totalCount);

      // Automatic progression to next question after short 1s feedback
      scheduleGameplayCallback(captureGameplayAction(), () => {
        setSelectedChoice(null);
        setAnswerFeedback(null);
        setIsSubmittingAnswer(false);

        if (data.questionWork) {
          setQuestionWork(data.questionWork); setQuestionsCompleted(data.questionWork.isFinished);
          if (data.questionWork.nextWork) setCurrentQuestionIndex(() => Math.max(0, questions.findIndex(q => q.id === data.questionWork.nextWork.questionId)));
        } else if (currentQuestionIndex + 1 < questions.length) {
          setCurrentQuestionIndex((prev) => prev + 1);
        } else {
          setQuestionsCompleted(true);
        }
      }, 1000);
    } catch {
      if (action.isCurrent()) setErrorMessage("Network error submitting answer.");
    } finally {
      if (action.isSameView()) setIsSubmittingAnswer(false);
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
    const action = captureGameplayAction();
    if (!action.isSameView()) return;
    if (usedPowers[powerType]) return;
    setErrorMessage(null);
    setTargetPickerPower(null);

    const names: Record<string, string> = {
      meteor: "☄️ METEOR STRIKE (-100 PTS)",
      earthquake: "🌋 EARTHQUAKE TREMOR (-60 PTS)",
      blizzard: "❄️ BLIZZARD FROST (-40 PTS)",
      shield: "🛡️ GUARDIAN SHIELD",
    };
    const targetRival = rivals.find((r) => r.studentId === targetStudentId);
    const targetLabel = targetRival?.studentName || "Rival";

    setIsLaunchingPower(powerType);

    try {
      const currentQ = questions[currentQuestionIndex];
      const { ok, data } = await readGameplayResponse("/api/arena/battle-action", {
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

      if (!ok && data.arenaRevision === undefined) {
        if (action.isCurrent()) { setErrorMessage(data.error || "Failed to cast battle power."); setCelebrationMessage(null); }
        void refreshArenaState(); return;
      }
      if (!action.isCurrent(data)) { void refreshArenaState(); return; }
      applyGameplayState(data);
      if (!ok) {
        setErrorMessage(data.error || "Failed to cast battle power.");
        setCelebrationMessage(null);
        return;
      }

      // Visual and sound feedback follows the accepted server action.
      if (powerType === "shield") {
        if (soundEnabled) playShieldDeflectSound();
        setCelebrationMessage("🛡️ GUARDIAN SHIELD ARMED! Defense ready against incoming attacks!");
        setBattleLogs((prev) => ["🛡️ You armed Guardian Shield!", ...prev].slice(0, 15));
      } else {
        setCelebrationMessage(`🚀 Attack Launched! ${names[powerType]} targeting ${targetLabel.toUpperCase()}!`);
        if (soundEnabled) playAttackSound(powerType);
        setBattleLogs((prev) => [`🚀 Launched ${names[powerType]} at ${targetLabel}!`, ...prev].slice(0, 15));
      }

      scheduleGameplayCallback(captureGameplayAction(), () => setCelebrationMessage(null), 3000);
    } catch {
      if (action.isCurrent()) {
        setErrorMessage("Network error launching battle power."); setCelebrationMessage(null);
      }
      void refreshArenaState();
    } finally {
      if (action.isSameView()) setIsLaunchingPower(null);
    }
  };

  // ── Defend Incoming Attack with Guardian Shield ───────────────
  const handleDefendIncomingAttack = async () => {
    const action = captureGameplayAction();
    if (!action.isSameView()) return;
    if (!incomingAttack || isShieldActivating || usedPowers.shield || reactionTimeLeftMs <= 0) return;
    const attackToDefend = incomingAttack;
    setIsShieldActivating(true);
    setErrorMessage(null);
    try {
      const { ok, data } = await readGameplayResponse("/api/arena/battle-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId,
          sessionId: currentSessionId,
          powerType: "shield",
          defendAttackId: attackToDefend.attackId,
        }),
      });

      if (!ok && data.arenaRevision === undefined) {
        if (action.isCurrent()) setErrorMessage(data.error || "Guardian Shield could not be activated.");
        void refreshArenaState(); return;
      }
      if (!action.isCurrent(data)) { void refreshArenaState(); return; }
      applyGameplayState(data);
      const terminalOutcome = getShieldTerminalOutcome(data);
      const hasNewerIncomingAttack = Boolean(
        incomingAttackRef.current && incomingAttackRef.current.attackId !== attackToDefend.attackId,
      );
      if (hasNewerIncomingAttack) {
        if (terminalOutcome === "deflected") {
          claimAttackFeedback(attackToDefend.attackId, "deflected");
        }
        return;
      }
      if (terminalOutcome === "deflected") {
        clearIncomingAttack(attackToDefend.attackId);
        setErrorMessage(null);
        const feedbackShown = showAttackFeedback(attackToDefend.attackId, "deflected", {
          type: "deflected",
          blockedPower: attackToDefend.powerType as "meteor" | "earthquake" | "blizzard",
          attackerName: attackToDefend.attackerName,
          penalty: 0,
          message: `GUARDIAN SHIELD DEFLECTED ${attackToDefend.attackerName}'s ${attackToDefend.powerType.toUpperCase()}! 0 PTS LOST!`,
        });
        if (feedbackShown && soundEnabled) playShieldDeflectSound();
        return;
      }

      if (terminalOutcome === "hit") {
        if (!displayedAttackFeedbackRef.current.has(`${attackToDefend.attackId}:hit`)) {
          setErrorMessage("Guardian Shield was too late; the attack hit.");
        }
        void refreshArenaState();
        return;
      }

      if (data.attackStatus === "cancelled") clearIncomingAttack(attackToDefend.attackId);

      if (data.code === "too_late") {
        setErrorMessage("Guardian Shield was too late; the attack already resolved.");
      } else if (data.code === "already_resolved") {
        setErrorMessage("That attack already resolved.");
      } else if (data.code === "shield_already_used") {
        setErrorMessage("Guardian Shield has already been used in this match.");
      } else if (!ok) {
        setErrorMessage(data.error || "Guardian Shield could not be activated.");
      }
      void refreshArenaState();
    } catch {
      if (action.isCurrent() && !displayedAttackFeedbackRef.current.has(`${attackToDefend.attackId}:deflected`)) {
        setErrorMessage("Network error activating Guardian Shield.");
      }
      void refreshArenaState();
    } finally {
      if (action.isSameView()) setIsShieldActivating(false);
    }
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
        {questionWork && <div className="flex flex-wrap justify-center gap-4 px-4 pb-4" aria-label="Arena result summary">
          <span>Your Points: {score}</span><span>Correct: {questionWork.correctCount}</span><span>Wrong: {questionWork.wrongCount}</span>
          <span>Retries corrected: {questionWork.retryCorrectCount}</span>
        </div>}
        <ArenaPodium
          quizTitle={quizTitle}
          subjectName={subjectName}
          podium={podium}
          allParticipants={allParticipants}
          currentStudentId={studentId}
          studentScore={score}
          studentRank={studentRank}
          expEarned={expEarned}
          highestStreak={highestStreak}
          onExit={() => router.push("/dashboard/student")}
        />
      </div>
    );
  }

  if (phase === "finalizing") {
    return (
      <div className="min-h-screen bg-[#070a14] text-white flex flex-col items-center justify-center gap-4 p-6 text-center">
        <Trophy className="w-12 h-12 text-amber-400" />
        <h1 className="text-2xl font-bold">Match Ended</h1>
        <p className="text-slate-300">{isFinalizing ? "Submitting your Arena result..." : arenaCompleted ? "Loading your final Arena results..." : "Your Arena result is not confirmed yet."}</p>
        {finalizationError && <p role="alert" className="text-rose-400">{finalizationError}</p>}
        {!isFinalizing && !arenaCompleted && finalizationError && (
          <button type="button" onClick={() => void finalizeMatch(true)} className="rounded-xl bg-indigo-600 px-6 py-3 font-bold hover:bg-indigo-500">
            Retry Submission
          </button>
        )}
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
                    <ArenaIdentity studentName={p.studentName} initials={p.initials} className="w-8 h-8 text-[10px]" />
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
          <ArenaIdentity studentName={studentName} className="w-7 h-7 text-[9px]" />
          Player: <span className="font-bold text-slate-300">{studentName}</span> • Zero Camera / Mic Requirements
        </footer>
      </div>
    );
  }

  // ── Render: Active Gameplay Screen ────────────────────────────
  const currentQ = questions[currentQuestionIndex];
  const isRetryQuestion = questionWork?.nextWork?.kind === "retry" && questionWork.nextWork.questionId === currentQ?.id;
  const currentAnswer = currentQ ? isRetryQuestion ? undefined : lockedAnswers.get(currentQ.id) : undefined;
  const isQuestionAnswered = Boolean(currentAnswer);

  return (
    <div
      className="min-h-screen bg-[#070a14] text-white flex flex-col justify-between p-3 sm:p-6 overflow-x-hidden"
    >
      <ArenaEffects key={activeAttackEffect?.visualId ?? "armed"} effect={activeAttackEffect} shieldArmed={hasGuardianShield} />

      {/* Incoming Attack Warning Dialog with Reaction Bar & Shield Button */}
      {incomingAttack && (
        <div className="fixed inset-x-4 top-16 sm:top-20 z-[96] max-w-lg mx-auto bg-rose-950/95 border-2 border-rose-500 rounded-3xl p-4 sm:p-5 shadow-[0_0_50px_rgba(244,63,94,0.6)] text-white">
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
              disabled={usedPowers.shield || isShieldActivating || reactionTimeLeftMs <= 0}
              className={`w-full py-2.5 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg transition-all ${
                usedPowers.shield || isShieldActivating || reactionTimeLeftMs <= 0
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                  : "bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 hover:brightness-110 active:scale-98 cursor-pointer"
              }`}
            >
              <Shield className="w-4 h-4" />
              {isShieldActivating
                ? "ACTIVATING SHIELD..."
                : usedPowers.shield
                  ? "GUARDIAN SHIELD ALREADY USED"
                  : reactionTimeLeftMs <= 0
                    ? "REACTION WINDOW CLOSED"
                    : "ACTIVATE GUARDIAN SHIELD (DEFLECT)"}
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
                        <ArenaIdentity studentName={rival.studentName} initials={rival.initials} className="w-10 h-10 text-xs" />
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
          role="status"
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[90] px-6 py-3.5 rounded-2xl shadow-2xl border-2 flex items-center gap-3 max-w-lg w-[92%] text-center justify-center pointer-events-none"
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
                : `${isRetryQuestion ? "Retry" : "Question"} ${currentQuestionIndex + 1} of ${questions.length}`}
            </div>
            <div className="text-xs sm:text-sm font-black text-white truncate max-w-[140px] sm:max-w-xs">
              {quizTitle}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <ArenaIdentity studentName={studentName} className="w-9 h-9 text-[10px]" />
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
                <ArenaIdentity studentName={rival.studentName} initials={rival.initials} className="w-8 h-8 text-[10px]" />
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
          isSpectating ? (
            /* ── Spectator Lobby / Waiting View ── */
            <div className="bg-gradient-to-br from-[#12182b] to-[#0d1222] border border-indigo-500/30 rounded-3xl p-5 sm:p-8 shadow-2xl space-y-5 animate-in fade-in">
              {/* Header */}
              <div className="flex items-center justify-between flex-wrap gap-3 pb-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                      Active Match • Spectator View
                    </div>
                    <h3 className="text-base sm:text-lg font-black text-white">Power Arena Live Spectator Lobby</h3>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-amber-300 font-mono font-bold text-xs flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>{formatTimer(matchTimeLeft)} left</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsSpectating(false)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-colors cursor-pointer"
                  >
                    View Summary Card
                  </button>
                </div>
              </div>

              {/* Player Score & Match Status HUD */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800 text-center">
                  <div className="text-[10px] font-mono uppercase font-bold text-slate-400">Your Locked Score</div>
                  <div className="text-xl sm:text-2xl font-black text-amber-300 font-mono mt-0.5">{score} PTS</div>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800 text-center">
                  <div className="text-[10px] font-mono uppercase font-bold text-slate-400">Your Current Rank</div>
                  <div className="text-xl sm:text-2xl font-black text-indigo-300 font-mono mt-0.5">#{studentRank} of {totalParticipants}</div>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800 text-center">
                  <div className="text-[10px] font-mono uppercase font-bold text-slate-400">Match Status</div>
                  <div className="text-xs sm:text-sm font-black text-emerald-400 uppercase mt-1">In Progress</div>
                </div>
              </div>

              {/* Full Live Leaderboard */}
              <div className="rounded-2xl bg-slate-900/90 border border-slate-800/90 p-4 space-y-2">
                <div className="flex items-center justify-between mb-2 px-1">
                  <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider">
                    Full Live Leaderboard ({totalParticipants} Players)
                  </h4>
                  <span className="text-[10px] font-mono text-slate-400">Questions Locked (Completed)</span>
                </div>
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {[
                    {
                      studentId,
                      studentName: studentName || "You",
                      initials: getStudentInitials(studentName, "ST"),
                      score,
                      rank: studentRank,
                      hasShield: hasGuardianShield,
                    },
                    ...rivals.map((r) => ({
                      studentId: r.studentId,
                      studentName: r.studentName,
                      initials: r.initials,
                      score: r.score,
                      rank: r.rank,
                      hasShield: r.hasShield,
                    })),
                  ]
                    .sort((a, b) => b.score - a.score || a.studentName.localeCompare(b.studentName))
                    .map((p, idx) => {
                      const isMe = p.studentId === studentId;
                      return (
                        <div
                          key={p.studentId}
                          className={`flex items-center justify-between p-2.5 rounded-xl border text-xs ${
                            isMe
                              ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-200 font-bold"
                              : "bg-slate-950/60 border-slate-800/80 text-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="font-mono font-black text-slate-400 w-5">#{idx + 1}</span>
                            <ArenaIdentity studentName={p.studentName} initials={p.initials} className="w-8 h-8 text-[10px]" />
                            <span className="font-medium text-white truncate max-w-[150px]">
                              {p.studentName} {isMe && "(You)"}
                            </span>
                            {p.hasShield && <span title="Shield Armed">🛡️</span>}
                          </div>
                          <div className="font-mono font-black text-amber-300">{p.score} pts</div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Live Battle Activity Feed */}
              {battleLogs.length > 0 && (
                <div className="rounded-2xl bg-slate-900/60 border border-slate-800/60 p-3 space-y-1.5">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 px-1">
                    Live Combat Activity
                  </div>
                  <div className="space-y-1 max-h-24 overflow-y-auto text-xs">
                    {battleLogs.slice(0, 4).map((log, idx) => (
                      <div key={idx} className="text-slate-300 text-[11px] truncate flex items-center gap-1.5">
                        <span className="text-indigo-400">•</span>
                        <span>{log}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Navigation in Spectator Mode */}
              <div className="pt-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => router.push("/dashboard/student")}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 transition-all cursor-pointer hover:scale-105 active:scale-95"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Dashboard</span>
                </button>
              </div>
            </div>
          ) : (
            /* ── Completion Summary Card ── */
            <div className="bg-gradient-to-br from-[#12182b] to-[#0d1222] border border-indigo-500/30 rounded-3xl p-6 sm:p-10 shadow-2xl text-center space-y-5 animate-in zoom-in-95">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-slate-950 mx-auto shadow-lg">
                <Check className="w-8 h-8 stroke-[3]" />
              </div>

              <div className="space-y-1">
                <h2 className="text-2xl sm:text-3xl font-black text-white">
                  All Questions Completed!
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                  Your questions and eligible retries are finished. Waiting for match to conclude — enter the spectator view to watch live standings, battle activity, and countdown!
                </p>
              </div>

              {questionWork && <div className="flex flex-wrap justify-center gap-4 py-2" aria-label="Original answer summary">
              <span>Correct: {questionWork.correctCount}</span><span>Wrong: {questionWork.wrongCount}</span>
              <span>Retries corrected: {questionWork.retryCorrectCount}</span>
            </div>}
            {/* Stats Grid: Questions Completed, Your Points, Current Rank, Total Players */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-lg mx-auto">
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-center">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Questions Completed</div>
                  <div className="text-lg font-black text-white font-mono mt-0.5">{questions.length} / {questions.length}</div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-center">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Your Points</div>
                  <div className="text-lg font-black text-amber-300 font-mono mt-0.5">{score} PTS</div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-center">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Your Current Rank</div>
                  <div className="text-lg font-black text-indigo-300 font-mono mt-0.5">#{studentRank}</div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-center">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Total Players</div>
                  <div className="text-lg font-black text-slate-300 font-mono mt-0.5">{totalParticipants}</div>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  id="btn-back-to-arena-lobby"
                  onClick={() => setIsSpectating(true)}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-black text-sm shadow-lg shadow-indigo-600/30 transition-all cursor-pointer hover:scale-105 active:scale-95"
                >
                  <Users className="w-4 h-4" />
                  <span>Back to Arena Lobby</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/dashboard/student")}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm border border-slate-700 transition-all cursor-pointer hover:scale-105 active:scale-95"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to Dashboard</span>
                </button>
              </div>

              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-mono font-bold">
                <span>Match Time Remaining: </span>
                <span className="text-amber-300 font-black">{formatTimer(matchTimeLeft)}</span>
              </div>
            </div>
          )
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
                  {isRetryQuestion ? "Retry" : "Question"} {currentQuestionIndex + 1} of {questions.length}
                </span>
                <span className="text-[11px] font-mono font-bold text-slate-400">
                  {isRetryQuestion ? "Practice retry • no extra points" : `${currentQ.points} Points`}
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
                    data-arena-choice={choice.id}
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
