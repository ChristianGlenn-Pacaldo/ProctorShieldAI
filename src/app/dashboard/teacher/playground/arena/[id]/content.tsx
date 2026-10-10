"use client";

import AssessmentThemeControl from "@/components/assessment-theme-control";

import { acceptArenaRevision, acceptArenaEventRevision, guardArenaChannel } from "@/lib/arena-feedback";
import { fetchArenaSnapshot, isTerminalArenaSnapshot, startArenaReconciliation, type ArenaSnapshot } from "@/lib/arena-client-reconciliation";

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
  Flame,
  Shield,
  ArrowLeft,
  RotateCcw,
  Bot,
  Trash2,
  Link2,
  AlertCircle,
  Clock,
  StopCircle,
  Zap,
  Award,
} from "lucide-react";
import PusherClient from "pusher-js";
import { computeArenaRankings, type ArenaParticipant } from "@/lib/arena";
import { ArenaIdentity } from "@/components/arena/arena-identity";
import { getStudentInitials } from "@/lib/student-identity";
import { claimArenaFeedback, claimArenaJoinFeedback, getArenaJoinKey } from "@/lib/arena-feedback";

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
  initials: string;
  score: number;
  rank: number;
  questionsAnswered: number;
  totalQuestions: number;
  correctCount?: number;
  wrongCount?: number;
  retryCorrectCount?: number;
  isFinished: boolean;
  hasShield: boolean;
  isAi: boolean;
}

interface BattleEvent {
  id: string;
  timestamp: string;
  text: string;
  type: "attack" | "shield" | "airdrop" | "elimination" | "info";
}

interface ArenaHostContentProps {
  quiz: QuizData;
  mode?: string;
  matchDuration?: number;
  waveDuration?: number;
  enabledPowers: string[];
  teacherId: string;
}

// Default AI Challenger Pool
const BOT_NAMES = ["Nova", "Blaze", "Viper", "Zephyr", "Apex", "Titan", "Frostbite", "Shadow"];

export default function ArenaHostContent({
  quiz,
  mode = "score_arena",
  matchDuration = 1800,
  waveDuration,
  enabledPowers,
  teacherId,
}: ArenaHostContentProps) {
  // Arena Phase: 'lobby' | 'wave' | 'podium'
  const arenaRevisionRef = useRef(0);
  const [phase, setPhase] = useState<"lobby" | "wave" | "podium">("lobby");

  // Use the duration saved in the quiz editor.
  const initialDuration = matchDuration;
  const selectedMatchDuration = initialDuration;
  const [matchEndsAt, setMatchEndsAt] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(initialDuration);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);

  const [sfxEnabled, setSfxEnabled] = useState<boolean>(true);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [arenaError, setArenaError] = useState("");
  const [isActionPending, setIsActionPending] = useState(false);
  const actionPendingRef = useRef(false);
  const arenaSessionRef = useRef<string | null>(null);
  const actionGenerationRef = useRef(0);
  const terminalReconciledRef = useRef(false);
  const actionQuizRef = useRef(quiz.id);
  const retryActionRef = useRef<{ action: string; payload: string; id: string; sessionId: string | null } | null>(null);
  const displayedJoinFeedbackRef = useRef(new Set<string>());
  const readRealtimeIdentity = useCallback(() => ({ quizId: quiz.id, sessionId: arenaSessionRef.current,
    terminal: terminalReconciledRef.current }), [quiz.id]);
  useEffect(() => {
    actionQuizRef.current = quiz.id;
    arenaRevisionRef.current = 0;
    arenaSessionRef.current = null;
    terminalReconciledRef.current = false;
    retryActionRef.current = null;
    displayedJoinFeedbackRef.current.clear();
    actionGenerationRef.current++;
    return () => { actionGenerationRef.current++; };
  }, [quiz.id]);

  // Battlers State: Starts EMPTY (0 ghost participants). Populated only when students join current session.
  const [battlers, setBattlers] = useState<Battler[]>([]);
  const reconciliationRef = useRef<ReturnType<typeof startArenaReconciliation> | null>(null);

  // Live Combat Events Activity Feed
  const [battleEvents, setBattleEvents] = useState<BattleEvent[]>([
    {
      id: "ev-0",
      timestamp: "Just now",
      text: "Arena Lobby initialized. Waiting for fighters.",
      type: "info",
    },
  ]);
  const displayedCombatFeedbackRef = useRef(new Set<string>());

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
    } catch {}
  };

  const playFanfareSound = () => {
    if (!sfxEnabled) return;
    try {
      const ctx = getAudioContext();
      const notes = [523.25, 659.25, 783.99, 1046.5];
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
    } catch {}
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
    } catch {}
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
    } catch {}
  };

  // Synchronize participants list & ranks
  const syncRankedBattlers = useCallback((participants: ArenaParticipant[]) => {
    if (!Array.isArray(participants)) return;
    setBattlers((prev) => {
      const botList = prev.filter((b) => b.isAi);
      const studentList: Battler[] = participants.map((p, idx) => ({
        id: p.studentId,
        name: p.studentName,
        initials: p.initials || getStudentInitials(p.studentName, "ST"),
        score: p.score || 0,
        rank: p.rank || idx + 1,
        questionsAnswered: p.questionsAnswered || 0,
        totalQuestions: p.totalQuestions || quiz.questions.length,
        correctCount: p.correctCount, wrongCount: p.wrongCount, retryCorrectCount: p.retryCorrectCount,
        isFinished: Boolean(p.isFinished),
        hasShield: Boolean(p.hasShield),
        isAi: false,
      }));

      const combined = [...studentList, ...botList];
      combined.sort((a, b) => b.score - a.score);
      combined.forEach((b, i) => {
        b.rank = i + 1;
      });
      return combined;
    });
  }, [quiz.questions.length]);

  const applyArenaSnapshot = useCallback((data: ArenaSnapshot) => {
    if ([data.quizId, data.arena?.quizId].some(id => id !== undefined && id !== quiz.id)) return false;
    if (!acceptArenaRevision(arenaRevisionRef, data)) return false;
    const sessionId = data.sessionId ?? data.arena?.sessionId;
    if (sessionId && sessionId !== arenaSessionRef.current) {
      arenaSessionRef.current = sessionId;
      displayedJoinFeedbackRef.current.clear();
      // Participants already present when this view adopts a session are not
      // new arrivals. Reconnect/replay must not announce historical membership.
      for (const participant of data.participants ?? []) {
        displayedJoinFeedbackRef.current.add(getArenaJoinKey(quiz.id, sessionId, participant.studentId));
      }
      actionGenerationRef.current++;
      terminalReconciledRef.current = false;
    }
    // Apply the whole committed leaderboard before displaying its winner.
    if (Array.isArray(data.participants)) syncRankedBattlers(data.participants);
    if (isTerminalArenaSnapshot(data)) {
      if (!terminalReconciledRef.current) actionGenerationRef.current++;
      terminalReconciledRef.current = true;
      setIsTimerRunning(false);
      setPhase("podium");
      return true;
    }
    if (data.arena?.status === "active") {
      setPhase("wave"); setIsTimerRunning(true);
      if (data.arena.matchEndsAt) {
        setMatchEndsAt(data.arena.matchEndsAt);
        setTimeLeft(Math.max(0, Math.ceil((Date.parse(data.arena.matchEndsAt) - Date.now()) / 1000)));
      }
    } else if (data.arena?.status === "lobby") {
      setPhase("lobby"); setIsTimerRunning(false);
    }
    // Ended hints/partial events are not evidence that the final snapshot was
    // applied. Keep read-only reconciliation alive until finalizedAt is visible.
    return false;
  }, [quiz.id, syncRankedBattlers]);

  const broadcastArenaAction = async (action: string, payload?: Record<string, unknown>) => {
    if (actionPendingRef.current) return null;
    const generation = actionGenerationRef.current;
    const requestSession = arenaSessionRef.current;
    const requestRevision = arenaRevisionRef.current;
    const requestQuiz = quiz.id;
    const requestIsCurrent = () => generation === actionGenerationRef.current
      && requestSession === arenaSessionRef.current && requestQuiz === actionQuizRef.current;
    actionPendingRef.current = true;
    setArenaError("");
    setIsActionPending(true);
    const payloadKey = JSON.stringify(payload ?? {});
    const previous = retryActionRef.current;
    const actionId = previous?.action === action && previous.payload === payloadKey ? previous.id : crypto.randomUUID();
    const sessionId = previous?.id === actionId ? previous.sessionId : arenaSessionRef.current;
    retryActionRef.current = { action, payload: payloadKey, id: actionId, sessionId };
    try {
      const response = await fetch(`/api/arena/${quiz.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload, sessionId, actionId }),
      });
      const data = await response.json();
      // The request may have committed before a newer terminal read/session
      // replaced this view. It cannot authorize any delayed local continuation.
      if (!requestIsCurrent()) {
        void reconciliationRef.current?.refresh();
        return null;
      }
      if (!response.ok || !data.success) {
        if (requestRevision === arenaRevisionRef.current) setArenaError(data.error || "Arena action failed. Please try again.");
        return null;
      }
      const revision = data.arenaRevision ?? data.arena?.revision;
      const responseSession = data.sessionId ?? data.arena?.sessionId;
      const createsSession = action === "reset" || action === "create_session";
      if (!Number.isSafeInteger(revision) || revision < arenaRevisionRef.current || !responseSession
        || (requestSession && responseSession !== requestSession && !createsSession)) {
        void reconciliationRef.current?.refresh();
        return null;
      }
      // Apply committed state, never arithmetic derived from an action amount.
      applyArenaSnapshot({ ...data, resultReady: data.arena?.status === "ended" && !!data.arena?.finalizedAt });
      const acceptedGeneration = actionGenerationRef.current;
      void reconciliationRef.current?.refresh();
      retryActionRef.current = null;
      // Recheck at the caller's await boundary: a pending terminal read can
      // finish after response application but before that continuation resumes.
      return { isCurrent: () => acceptedGeneration === actionGenerationRef.current
        && revision === arenaRevisionRef.current && responseSession === arenaSessionRef.current
        && requestQuiz === actionQuizRef.current };
    } catch {
      if (requestIsCurrent() && requestRevision === arenaRevisionRef.current) setArenaError("Network error. The arena action was not delivered.");
      return null;
    } finally {
      actionPendingRef.current = false;
      setIsActionPending(false);
    }
  };

  // Realtime Pusher Subscriptions
  useEffect(() => {
    let subscribed = true;
    const pusher = new PusherClient(
      process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
      {
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1",
        authEndpoint: "/api/pusher/auth",
      },
    );
    const stateHints = { getIdentity: readRealtimeIdentity,
      isLive: () => subscribed && actionQuizRef.current === quiz.id,
      onStateHint: () => reconciliationRef.current?.hint(),
      onSessionHint: () => reconciliationRef.current?.hint({ allowTerminal: true }) };
    const arenaChannel = guardArenaChannel(pusher.subscribe(`private-arena-${quiz.id}`), arenaRevisionRef, stateHints);
    const teacherChannel = guardArenaChannel(pusher.subscribe(`private-teacher-${teacherId}`), arenaRevisionRef, stateHints);
    pusher.connection.bind("connected", () => { void reconciliationRef.current?.refresh(); });
    const refreshSession = () => { void reconciliationRef.current?.refresh(); };
    arenaChannel.bind("arena-reset", refreshSession);
    arenaChannel.bind("arena-session-created", refreshSession);

    const handleStudentJoined = (data?: ArenaSnapshot & { quizId?: number; studentId?: string; studentName?: string; name?: string }) => {
      if (terminalReconciledRef.current || actionQuizRef.current !== quiz.id) return;
      if (data?.quizId !== undefined && data.quizId !== quiz.id) return;
      const sessionId = data?.sessionId ?? data?.arena?.sessionId;
      if (sessionId && sessionId !== arenaSessionRef.current) return;
      const revision = data?.arenaRevision ?? data?.arena?.revision;
      if (revision !== undefined && !Number.isSafeInteger(revision)) return;
      // Enrollment is a read hint, never a participant or result snapshot.
      reconciliationRef.current?.hint();
      // A newer gameplay snapshot cannot suppress an unseen informational join.
      const joinIdentity = claimArenaJoinFeedback(displayedJoinFeedbackRef.current, data,
        readRealtimeIdentity());
      if (!joinIdentity || !data?.studentId) return;
      playJoinChime();
      const displayName = data.studentName || data.name || "A fighter";
      setBattleEvents((prev) => [
        {
          id: `join-${joinIdentity}`,
          timestamp: "Just now",
          text: `🎮 ${displayName} entered the Arena!`,
          type: "info",
        },
        ...prev.slice(0, 25),
      ]);
    };

    arenaChannel.bind("arena-student-joined", handleStudentJoined);
    teacherChannel.bind("arena-student-joined", handleStudentJoined);

    // Live Student Answer Progress Event
    const handleAnswerEvent = (data: ArenaSnapshot & {
      studentId: string;
      studentName: string;
      questionId: number;
      choiceId: number;
      isCorrect: boolean;
      answerKind?: "initial" | "retry";
      correctCount?: number; wrongCount?: number; retryCorrectCount?: number;
      score: number;
      rank: number;
      questionsAnswered: number;
      isFinished: boolean;
    }) => {
      if (!acceptArenaEventRevision(arenaRevisionRef, data, readRealtimeIdentity())) return;
      setBattlers((prev) => {
        const updated = prev.map((b) => {
          if (b.id !== data.studentId) return b;
          return {
            ...b,
            score: typeof data.score === "number" ? data.score : b.score,
            questionsAnswered: data.questionsAnswered ?? b.questionsAnswered + 1,
            correctCount: data.correctCount ?? b.correctCount, wrongCount: data.wrongCount ?? b.wrongCount, retryCorrectCount: data.retryCorrectCount ?? b.retryCorrectCount,
            isFinished: Boolean(data.isFinished),
          };
        });
        updated.sort((a, b) => b.score - a.score);
        updated.forEach((b, i) => {
          b.rank = i + 1;
        });
        return updated;
      });

      setBattleEvents((prev) => [
        {
          id: `ev-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
          timestamp: "Just now",
          text: `${data.isCorrect ? "✅" : "❌"} ${data.studentName} answered ${data.answerKind === "retry" ? (data.isCorrect ? "retry correctly (no extra points)" : "retry incorrectly") : data.isCorrect ? "correctly (+pts)" : "incorrectly"}. (Q: ${data.questionsAnswered || 1}/${quiz.questions.length})`,
          type: "info",
        },
        ...prev.slice(0, 25),
      ]);
    };

    arenaChannel.bind("arena-answer", handleAnswerEvent);
    teacherChannel.bind("arena-answer", handleAnswerEvent);

    // Incoming Attack Warning
    const handleIncomingAttack = (data: {
      attackId: string;
      attackerName: string;
      targetName: string;
      powerType: string;
      scorePenalty?: number;
      damage?: number;
    }) => {
      if (!claimArenaFeedback(displayedCombatFeedbackRef.current, data.attackId, "launched")) return;
      const penalty = data.scorePenalty || data.damage || 40;
      setBattleEvents((prev) => [
        {
          id: `ev-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
          timestamp: "Just now",
          text: `⚠️ ${data.attackerName} launched ${data.powerType.toUpperCase()} at ${data.targetName}! (-${penalty} PTS at risk)`,
          type: "attack",
        },
        ...prev.slice(0, 25),
      ]);
    };

    arenaChannel.bind("arena-incoming-attack", handleIncomingAttack);
    teacherChannel.bind("arena-incoming-attack", handleIncomingAttack);

    // Attack Hit Event
    const handleAttackHit = (data: ArenaSnapshot & {
      attackId: string;
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
      if (!claimArenaFeedback(displayedCombatFeedbackRef.current, data.attackId, "hit")) return;
      const penalty = data.scorePenalty || data.damage || 40;
      setBattleEvents((prev) => [
        {
          id: `ev-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
          timestamp: "Just now",
          text: `💥 ${data.attackerName}'s ${data.powerType.toUpperCase()} hit ${data.targetName} for -${penalty} PTS!`,
          type: "attack",
        },
        ...prev.slice(0, 25),
      ]);

      if (!acceptArenaEventRevision(arenaRevisionRef, data, readRealtimeIdentity())) return;
      if (Array.isArray(data.participants)) {
        syncRankedBattlers(data.participants);
      } else {
        setBattlers((prev) => {
          const updated = prev.map((b) =>
            b.id === data.targetStudentId ? { ...b, score: data.targetCurrentScore } : b
          );
          updated.sort((a, b) => b.score - a.score);
          updated.forEach((b, i) => {
            b.rank = i + 1;
          });
          return updated;
        });
      }
    };

    arenaChannel.bind("arena-attack-hit", handleAttackHit);
    teacherChannel.bind("arena-attack-hit", handleAttackHit);

    // Attack Blocked Event
    const handleAttackBlocked = (data: ArenaSnapshot & {
      attackId: string;
      attackerName: string;
      targetStudentId: string;
      targetName: string;
      powerType: string;
      sessionId?: string;
    }) => {
      if (!claimArenaFeedback(displayedCombatFeedbackRef.current, data.attackId, "deflected")) return;
      if (acceptArenaEventRevision(arenaRevisionRef, data, readRealtimeIdentity())) {
        if (Array.isArray(data.participants)) syncRankedBattlers(data.participants);
        else setBattlers((prev) =>
          prev.map((b) => (b.id === data.targetStudentId ? { ...b, hasShield: false } : b))
        );
      }
      setBattleEvents((prev) => [
        {
          id: `ev-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
          timestamp: "Just now",
          text: `🛡️ ${data.targetName} deflected ${data.attackerName}'s ${data.powerType.toUpperCase()} with Guardian Shield! (0 PTS lost)`,
          type: "shield",
        },
        ...prev.slice(0, 25),
      ]);
    };

    arenaChannel.bind("arena-attack-blocked", handleAttackBlocked);
    teacherChannel.bind("arena-attack-blocked", handleAttackBlocked);

    // Leaderboard Updated Event
    arenaChannel.bind("arena-leaderboard-updated", (data: ArenaSnapshot) => {
      if (!acceptArenaEventRevision(arenaRevisionRef, data, readRealtimeIdentity())) return;
      if (Array.isArray(data?.participants)) {
        syncRankedBattlers(data.participants);
      }
    });

    // Score Updated Event
    arenaChannel.bind("arena-score-updated", (data: ArenaSnapshot & { studentId: string; score: number; rank: number }) => {
      if (!acceptArenaEventRevision(arenaRevisionRef, data, readRealtimeIdentity())) return;
      setBattlers((prev) => {
        const updated = prev.map((b) =>
          b.id === data.studentId ? { ...b, score: data.score } : b
        );
        updated.sort((a, b) => b.score - a.score);
        updated.forEach((b, i) => {
          b.rank = i + 1;
        });
        return updated;
      });
    });

    // Arena Start
    arenaChannel.bind("arena-start", (data?: ArenaSnapshot & { matchDuration?: number; matchEndsAt?: string }) => {
      if (!acceptArenaEventRevision(arenaRevisionRef, data, readRealtimeIdentity())) return;
      void reconciliationRef.current?.refresh();
      setPhase("wave");
      setIsTimerRunning(true);
      if (data?.matchEndsAt) {
        setMatchEndsAt(data.matchEndsAt);
        const rem = Math.max(0, Math.ceil((Date.parse(data.matchEndsAt) - Date.now()) / 1000));
        setTimeLeft(rem);
      } else if (data?.matchDuration) {
        setTimeLeft(data.matchDuration);
      }
      if (Array.isArray(data?.participants)) {
        syncRankedBattlers(data.participants);
      }
    });

    // Arena End
    arenaChannel.bind("arena-end", (data?: ArenaSnapshot) => {
      if (!acceptArenaEventRevision(arenaRevisionRef, data, readRealtimeIdentity())) return;
      if (Array.isArray(data?.participants)) syncRankedBattlers(data.participants);
      playFanfareSound();
      setIsTimerRunning(false);
      setPhase("podium");
      // An event can be partial; independently confirm PostgreSQL's result.
      void reconciliationRef.current?.refresh();
    });

    return () => {
      subscribed = false;
      arenaChannel.unbind_all();
      teacherChannel.unbind_all();
      pusher.unsubscribe(`private-arena-${quiz.id}`);
      pusher.unsubscribe(`private-teacher-${teacherId}`);
      pusher.disconnect();
    };
  }, [quiz.id, quiz.questions.length, syncRankedBattlers, teacherId, readRealtimeIdentity]);

  // Initial, periodic and reconnect recovery share the same read-only path.
  useEffect(() => {
    const worker = startArenaReconciliation({ read: (signal) => fetchArenaSnapshot(quiz.id, signal), apply: applyArenaSnapshot });
    reconciliationRef.current = worker;
    const refresh = () => { if (!document.hidden) void worker.refresh(); };
    window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => {
      worker.stop(); reconciliationRef.current = null;
      window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh);
    };
  }, [quiz.id, applyArenaSnapshot]);

  // End Arena Match Manually
  const handleEndArena = async () => {
    const result = await broadcastArenaAction("end");
    if (!result?.isCurrent()) return;
    playFanfareSound();
  };

  // Overall Match Timer Countdown
  useEffect(() => {
    if (phase !== "wave" || !isTimerRunning) return;

    const interval = setInterval(() => {
      if (matchEndsAt) {
        const remaining = Math.max(0, Math.ceil((Date.parse(matchEndsAt) - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining <= 0) {
          void handleEndArena();
        }
      } else {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            void handleEndArena();
            return 0;
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, isTimerRunning, matchEndsAt]);

  // Start Arena Match
  const handleStartMatch = async () => {
    const waveDuration = selectedMatchDuration;
    const started = await broadcastArenaAction("start", {
      mode,
      waveDuration,
      matchDuration: selectedMatchDuration,
      enabledPowers,
    });
    if (!started?.isCurrent()) return;
    playGongSound();
  };

  const handleDropAirdrop = async () => {
    const result = await broadcastArenaAction("airdrop");
    if (!result?.isCurrent()) return;
    playAirdropSound();
    setBattleEvents((prev) => [
      {
        id: `ev-${Date.now()}`,
        timestamp: "Just now",
        text: `🎁 HOST AIRDROP DELIVERED! All battlers granted Shields and +50 PTS!`,
        type: "airdrop",
      },
      ...prev.slice(0, 25),
    ]);
  };

  const handleAddBot = () => {
    const available = BOT_NAMES.filter((name) => !battlers.some((x) => x.name === name));
    if (available.length === 0) return;
    const botName = available[0];
    setBattlers((prev) => {
      const updated = [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          name: botName,
          initials: getStudentInitials(botName, "AI"),
          score: 0,
          rank: prev.length + 1,
          questionsAnswered: 0,
          totalQuestions: quiz.questions.length,
          isFinished: false,
          hasShield: false,
          isAi: true,
        },
      ];
      updated.sort((a, b) => b.score - a.score);
      updated.forEach((b, i) => {
        b.rank = i + 1;
      });
      return updated;
    });
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

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Full leaderboard sorted #1 through #N
  const sortedLeaderboard = [...battlers].sort((a, b) => b.score - a.score);
  const podiumLeaderboard = sortedLeaderboard.filter((b) => !b.isAi);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col font-sans select-none overflow-x-hidden">
      {/* ─────────────────────────────────────────────────────────────
          ARENA PROJECTOR TOPBAR
      ───────────────────────────────────────────────────────────── */}
      <header className="min-h-16 px-4 sm:px-8 py-3 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0 z-30">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Link
            href="/dashboard/teacher/playground"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
            title="Exit Arena"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center text-slate-950 font-black shadow-sm">
              <Swords className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-black tracking-tight text-white flex flex-wrap items-center gap-2">
                <span className="break-words">{quiz.title}</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-[10px] font-extrabold uppercase">
                  POWER ARENA HOST
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                {quiz.subjectName} • {battlers.length} Battlers • Score-Based Gameplay
              </div>
            </div>
          </div>
        </div>

        {/* Join PIN Pill for Classroom Projector */}
        <div className="flex shrink-0 items-center gap-3">
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

          <AssessmentThemeControl />
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
        <div role="alert" className="mx-4 mt-3 rounded-xl border border-rose-500/50 bg-rose-950/80 px-4 py-3 text-sm font-semibold text-rose-100 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{arenaError}</span>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          PHASE 1: LOBBY (TEACHER CONFIG & START ARENA)
      ───────────────────────────────────────────────────────────── */}
      {phase === "lobby" && (
        <main className="flex-1 p-6 sm:p-12 flex flex-col justify-between max-w-6xl mx-auto w-full space-y-8">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-bold tracking-wider uppercase">
              <Users className="w-4 h-4" />
              ARENA LOBBY OPEN • READY TO START
            </div>
            <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tight font-[family-name:var(--font-display)]">
              Join the Power Arena
            </h1>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-base sm:text-xl text-slate-300 pt-2">
              <span>Enter PIN: <strong className="text-amber-400 font-mono text-2xl font-black">{quiz.accessCode}</strong></span>
            </div>
          </div>

          {/* Overall Match Duration Selector */}
          <div className="max-w-md mx-auto w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-4 text-center space-y-2">
            <span className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center justify-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              MATCH DURATION
            </span>
            <div className="pt-1 text-lg font-black text-amber-400">{selectedMatchDuration / 60} Minutes</div>
            <p className="text-[10px] text-slate-500 pt-1">
              Saved quiz duration. Edit the quiz before starting to change it.
            </p>
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
                    <ArenaIdentity studentName={b.name} initials={b.initials} className="w-12 h-12 text-sm" />
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
                  Start Arena Match ({formatTimer(selectedMatchDuration)})
                </>
              )}
            </button>
          </div>
        </main>
      )}

      {/* ─────────────────────────────────────────────────────────────
          PHASE 2: ACTIVE ARENA (LIVE FULL LEADERBOARD + TELEMETRY)
      ───────────────────────────────────────────────────────────── */}
      {phase === "wave" && (
        <main className="flex-1 p-4 sm:p-8 flex flex-col lg:flex-row gap-6 max-w-7xl mx-auto w-full">
          {/* Left: Full Live Leaderboard (#1 through #N) */}
          <div className="flex-1 flex flex-col justify-between space-y-4">
            {/* Overall Match Timer & Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
              <div className="space-y-1">
                <span className="px-2.5 py-1 rounded-md bg-amber-400/20 text-amber-300 text-xs font-black uppercase tracking-wider">
                  POWER ARENA IN PROGRESS
                </span>
                <div className="text-xs text-slate-400">
                  Total Questions: {quiz.questions.length} • Automatic Question Advancement
                </div>
              </div>

              {/* Live Overall Countdown Timer */}
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-mono uppercase text-slate-400 font-bold">Match Time</span>
                  <div
                    className={`text-3xl sm:text-4xl font-mono font-black ${
                      timeLeft <= 30 ? "text-rose-400 animate-ping" : "text-amber-400"
                    }`}
                  >
                    {formatTimer(timeLeft)}
                  </div>
                </div>
              </div>
            </div>

            {/* Complete Dynamic Leaderboard Table */}
            <div className="rounded-3xl bg-slate-900 border border-slate-800 overflow-hidden shadow-2xl flex-1 flex flex-col">
              <div className="p-3.5 bg-slate-800/60 border-b border-slate-800 flex items-center justify-between text-xs font-bold text-slate-400 px-6">
                <span>RANK & PARTICIPANT</span>
                <span>PROGRESS & STATUS</span>
                <span>SCORE</span>
              </div>

              <div className="divide-y divide-slate-800/80 overflow-y-auto max-h-[480px]">
                {sortedLeaderboard.map((b, idx) => (
                  <div
                    key={b.id}
                    className={`p-3.5 px-6 flex items-center justify-between transition-all ${
                      idx === 0
                        ? "bg-amber-400/10"
                        : idx === 1
                        ? "bg-slate-800/30"
                        : idx === 2
                        ? "bg-amber-700/10"
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                          idx === 0
                            ? "bg-amber-400 text-slate-950 shadow-md"
                            : idx === 1
                            ? "bg-slate-300 text-slate-950"
                            : idx === 2
                            ? "bg-amber-700 text-white"
                            : "text-slate-500 font-mono bg-slate-800"
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <ArenaIdentity studentName={b.name} initials={b.initials} />
                      <div className="min-w-0">
                        <div className="font-bold text-white text-sm sm:text-base truncate">
                          {b.name}
                        </div>
                        {b.hasShield && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
                            🛡️ SHIELD
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-slate-400 hidden sm:inline">
                        {b.questionsAnswered} / {quiz.questions.length} Qs
                      </span>
                      {b.correctCount !== undefined && <span className="text-xs">Correct: {b.correctCount} · Wrong: {b.wrongCount ?? 0}</span>}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          b.isFinished
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                        }`}
                      >
                        {b.isFinished ? "Completed" : "Playing"}
                      </span>
                    </div>

                    <div className="text-right font-mono font-black text-amber-300 text-base sm:text-lg">
                      {b.score} <span className="text-xs text-slate-400 font-normal">pts</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Teacher Host Action Controls: Airdrop and End Arena */}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handleDropAirdrop}
                disabled={isActionPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
              >
                <Gift className="w-4 h-4" />
                Drop Airdrop (+50 PTS & Shield) 🎁
              </button>

              <button
                onClick={handleEndArena}
                disabled={isActionPending}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs shadow-lg transition-all cursor-pointer"
              >
                <StopCircle className="w-4 h-4" />
                End Arena Now 🏁
              </button>
            </div>
          </div>

          {/* Right: Live Combat Activity Feed */}
          <div className="w-full lg:w-84 flex flex-col gap-4">
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5 flex-1 flex flex-col">
              <div className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  Live Combat Feed
                </span>
                <span className="text-[10px] font-mono text-emerald-400 font-bold">● LIVE</span>
              </div>
              <div className="flex-1 max-h-[500px] overflow-y-auto space-y-2 text-xs text-slate-300 pr-1">
                {battleEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 text-[11px] leading-relaxed animate-in fade-in slide-in-from-top-1 duration-150"
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
          PHASE 3: GRAND CHAMPIONSHIP PODIUM
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
              Prizes awarded to top battlers based on authoritative scores.
            </p>
          </div>

          {/* 3D Podium Display */}
          <div className="flex items-end justify-center gap-3 sm:gap-6 pt-12 pb-6">
            {podiumLeaderboard.length === 0 && (
              <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-6 py-8 text-center text-sm text-slate-300">
                No eligible student submission was available for this session.
              </div>
            )}
            {/* 2nd Place */}
            {podiumLeaderboard[1] && (
              <div className="flex flex-col items-center space-y-2 w-28 sm:w-36">
                <ArenaIdentity studentName={podiumLeaderboard[1].name} initials={podiumLeaderboard[1].initials} className="w-16 h-16 text-lg" />
                <div className="font-bold text-xs sm:text-sm text-white truncate max-w-full">
                  {podiumLeaderboard[1].name}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  {podiumLeaderboard[1].score} pts
                </div>
                <div className="w-full h-32 sm:h-40 rounded-t-2xl bg-gradient-to-b from-slate-700 to-slate-900 border-2 border-slate-600 flex flex-col items-center justify-center p-2 shadow-xl">
                  <span className="text-2xl font-black text-slate-300">2nd</span>
                  <span className="text-[11px] font-bold text-slate-400 mt-1">
                    Runner-up
                  </span>
                </div>
              </div>
            )}

            {/* 1st Place Champion */}
            {podiumLeaderboard[0] && (
              <div className="flex flex-col items-center space-y-2 w-32 sm:w-44 -mt-8">
                <div className="relative">
                  <Crown className="w-8 h-8 text-amber-400 absolute -top-8 left-1/2 -translate-x-1/2 animate-bounce" />
                  <ArenaIdentity studentName={podiumLeaderboard[0].name} initials={podiumLeaderboard[0].initials} className="w-20 h-20 text-xl" />
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
                    Champion
                  </span>
                </div>
              </div>
            )}

            {/* 3rd Place */}
            {podiumLeaderboard[2] && (
              <div className="flex flex-col items-center space-y-2 w-28 sm:w-36">
                <ArenaIdentity studentName={podiumLeaderboard[2].name} initials={podiumLeaderboard[2].initials} className="w-16 h-16 text-lg" />
                <div className="font-bold text-xs sm:text-sm text-white truncate max-w-full">
                  {podiumLeaderboard[2].name}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  {podiumLeaderboard[2].score} pts
                </div>
                <div className="w-full h-24 sm:h-32 rounded-t-2xl bg-gradient-to-b from-amber-800 to-amber-950 border-2 border-amber-700 flex flex-col items-center justify-center p-2 shadow-xl">
                  <span className="text-2xl font-black text-amber-200">3rd</span>
                  <span className="text-[11px] font-bold text-amber-300 mt-1">
                    Bronze
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Full Leaderboard for All Participants Below Podium */}
          {sortedLeaderboard.length > 0 && (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-2 max-h-72 overflow-y-auto">
              <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider mb-2 px-1">
                Full Final Leaderboard ({sortedLeaderboard.length} Participants)
              </h4>
              {sortedLeaderboard.map((b, idx) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-black text-slate-400 w-5">#{idx + 1}</span>
                    <ArenaIdentity studentName={b.name} initials={b.initials} className="w-8 h-8 text-[10px]" />
                    <span className="font-bold text-white">{b.name}</span>
                  </div>
                  <div className="font-mono font-black text-amber-300">{b.score} pts</div>
                </div>
              ))}
            </div>
          )}

          {/* Teacher Review Banner */}
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs sm:text-sm font-semibold text-center max-w-xl mx-auto flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>This Power Arena has already been completed. Create a new quiz to host another match.</span>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6 border-t border-slate-800">
            <Link
              href="/dashboard/teacher"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-all cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>

            <Link
              href="/dashboard/teacher/playground"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-black text-sm shadow-md transition-all cursor-pointer hover:scale-105 active:scale-95"
            >
              Exit to Playground Studio
            </Link>
          </div>
        </main>
      )}
    </div>
  );
}
