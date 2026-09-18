"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getViolationLabel,
  getAudioAnomalyThreshold,
  getAudioSignalLevel,
  getUnauthorizedDeviceConfidence,
  isScreenshotShortcut,
} from "@/lib/proctoring-detection";
import { COCO_MODEL_BROWSER_URL } from "@/lib/coco-model";
import {
  getBrowserDeviceCapabilities,
  getBrowserProctoringPerformanceProfile,
  monitoringLabel,
  type DeviceCapabilities,
  type MonitoringLevel,
} from "@/lib/device-capabilities";
import { 
  Camera, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  Volume2, 
  VolumeX, 
  Trophy, 
  ShieldCheck, 
  Sparkles,
  ArrowRight,
  Smartphone,
  Monitor,
  Wifi,
  WifiOff,
  Save,
  ShieldAlert,
  Award,
} from "lucide-react";

type QuizSubmittedResult = {
  score: number | null;
  total: number;
  violations: number;
  integrityInvalidated: boolean;
  aiVerdict: "clean" | "suspicious" | "cheated";
  expEarned?: number;
  coinsEarned?: number;
  rank?: number;
  isTopOne?: boolean;
  rankTitle?: string;
  totalCoins?: number;
};

// Module-level cached promises to prevent duplicate downloads and allow preloading
let cachedFaceApiPromise: Promise<any> | null = null;
let cachedCocoModelPromise: Promise<any> | null = null;

function preloadProctoringModels(useTinyLandmarks = false, objectModelBase = "lite_mobilenet_v2") {
  if (typeof window === "undefined") return;
  if (!cachedFaceApiPromise) {
    cachedFaceApiPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api/dist/face-api.esm-nobundle.js");
      const sharedTf = faceapi.tf as unknown as typeof import("@tensorflow/tfjs");
      sharedTf.enableProdMode();
      await sharedTf.ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        useTinyLandmarks
          ? faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models')
          : faceapi.nets.faceLandmark68Net.loadFromUri('/models')
      ]);
      return faceapi;
    })();
  }
  if (!cachedCocoModelPromise) {
    cachedCocoModelPromise = import("@tensorflow-models/coco-ssd").then((cocoSsd) =>
      cocoSsd.load({
        base: objectModelBase as any,
        modelUrl: COCO_MODEL_BROWSER_URL,
      })
    );
  }
}

export default function QuizRoom() {
  const params = useParams();
  const quizId = params.id as string;
  const router = useRouter();

  const [hasStarted, setHasStarted] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [violationCount, setViolationCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60 * 60);
  const [aiStatus, setAiStatus] = useState("Initializing...");
  const [faceStatus, setFaceStatus] = useState("—");
  const [gazeStatus, setGazeStatus] = useState("—");
  const [deviceStatus, setDeviceStatus] = useState("—");
  const videoRef = useRef<HTMLVideoElement>(null);
  const mobileVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pcMapRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const violationCountRef = useRef(0);
  const feedbackAudioContextRef = useRef<AudioContext | null>(null);
  const lastTeacherWarningIdRef = useRef("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const submissionInFlightRef = useRef(false);
  const autoSubmitAttemptedRef = useRef(false);
  const isReportingRef = useRef(false);
  const isAlertingRef = useRef(false);
  const isStartupGracePeriodRef = useRef(true);
  const lastViolationAtRef = useRef(0);
  const fullscreenMonitoringRef = useRef(false);

  // Security Incident Refs (Component-level to avoid stale closures)
  const awayIncidentActiveRef = useRef(false);
  const awayViolationRecordedRef = useRef(false);
  const awayGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullscreenIncidentActiveRef = useRef(false);
  const fullscreenViolationRecordedRef = useRef(false);
  const fullscreenGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const examActiveRef = useRef(false);

  const [warningModal, setWarningModal] = useState({ show: false, message: "", isFinal: false });
  const [teacherWarningModal, setTeacherWarningModal] = useState({ show: false, message: "" });
  const [preWarning, setPreWarning] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioStatus, setAudioStatus] = useState("Starting...");
  const [isMobile, setIsMobile] = useState(false);
  const [deviceCapabilities, setDeviceCapabilities] = useState<DeviceCapabilities | null>(null);
  const [monitoringLevel, setMonitoringLevel] = useState<MonitoringLevel>("unsupported");
  const [preflightPassed, setPreflightPassed] = useState(false);
  const [isCheckingDevice, setIsCheckingDevice] = useState(false);
  const [deviceCheckError, setDeviceCheckError] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "offline" | "error">("idle");
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  const [headPos, setHeadPos] = useState({ x: 50, y: 50 });
  const [aiLogs, setAiLogs] = useState<{ id: string; text: string; time: string; isError?: boolean }[]>([
    { id: "1", text: "Head Tracking Initialized", time: "now" },
    { id: "2", text: "Camera Connected", time: "now" },
  ]);

  const [quiz, setQuiz] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loadingQuiz, setLoadingQuiz] = useState(true);
  const [quizError, setQuizError] = useState("");
  const [lobbyError, setLobbyError] = useState("");
  const [canEnterQuiz, setCanEnterQuiz] = useState(false);
  const [isEnteringQuiz, setIsEnteringQuiz] = useState(false);
  const [answersState, setAnswersState] = useState<Record<number, number>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [fillBlankInput, setFillBlankInput] = useState("");

  useEffect(() => {
    setFillBlankInput("");
  }, [currentQuestionIndex]);
  const [answerFeedback, setAnswerFeedback] = useState<Record<number, { choiceId: number; isCorrect: boolean }>>({});
  const [isCheckingAnswer, setIsCheckingAnswer] = useState(false);
  const advanceTimerRef = useRef<number | null>(null);
  const [studentQuizStatus, setStudentQuizStatus] = useState<string>("");
  const [studentQuizId, setStudentQuizId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");

  // ── PROCTORSHIELD EXAM STATE ──────────────────────────
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [quizSubmittedResult, setQuizSubmittedResult] = useState<QuizSubmittedResult | null>(null);



  // ── Web Audio Synthesizer (Zero External Dependencies) ───────
  const playTone = useCallback((freqs: number[], type: OscillatorType = "sine", duration: number = 0.15) => {
    if (!soundEnabled || typeof window === "undefined") return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      let ctx = feedbackAudioContextRef.current;
      if (!ctx || ctx.state === "closed") {
        ctx = new AudioCtx();
        feedbackAudioContextRef.current = ctx;
      }
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      let delay = 0;
      freqs.forEach((f) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f, ctx.currentTime + delay);
        gain.gain.setValueAtTime(0.12, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + duration);
        delay += duration * 0.8;
      });
    } catch {}
  }, [soundEnabled]);

  useEffect(() => () => {
    const context = feedbackAudioContextRef.current;
    feedbackAudioContextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);

  const receiveTeacherWarning = useCallback((value: unknown) => {
    const warning = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const warningQuizId = Number(warning.quizId);
    const warningId = typeof warning.id === "string" ? warning.id : "";
    const message = typeof warning.message === "string" ? warning.message.trim().slice(0, 240) : "";
    if (warningQuizId !== Number(quizId) || !warningId || !message || lastTeacherWarningIdRef.current === warningId) return;

    lastTeacherWarningIdRef.current = warningId;
    setTeacherWarningModal({ show: true, message });
    setPreWarning("Your teacher sent a live warning. Please acknowledge it.");
    playTone([880, 660, 880], "square", 0.16);
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([180, 100, 180]);
    }
  }, [playTone, quizId, setPreWarning, setTeacherWarningModal]);



  // ── WebRTC P2P Live Video Streamer (Student -> Teacher) ──
  useEffect(() => {
    if (!hasStarted || !userId || !quiz?.teacherId) return;

    let pusherClient: any;
    const teacherChannelName = `private-teacher-${quiz.teacherId}`;
    const studentChannelName = `private-student-${userId}`;

    const rtcConfig: RTCConfiguration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    };

    const handleWebRTCSignal = async (signalData: any) => {
      const { senderId, signalType, data } = signalData;
      if (!senderId) return;

      try {
        if (signalType === "request-stream" || signalType === "teacher-ready") {
          let pc = pcMapRef.current.get(senderId);
          if (pc) { pc.close(); }
          pc = new RTCPeerConnection(rtcConfig);
          pcMapRef.current.set(senderId, pc);

          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => {
              pc!.addTrack(track, mediaStreamRef.current!);
            });
          }

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              fetch("/api/live/webrtc", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  targetUserId: senderId,
                  targetChannel: teacherChannelName,
                  signalType: "ice-candidate",
                  data: { candidate: event.candidate, quizId },
                }),
              }).catch(() => {});
            }
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          await fetch("/api/live/webrtc", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              targetUserId: senderId,
              targetChannel: teacherChannelName,
              signalType: "sdp-offer",
              data: { sdp: offer, quizId },
            }),
          });
        } else if (signalType === "sdp-answer") {
          const pc = pcMapRef.current.get(senderId);
          if (pc && data?.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          }
        } else if (signalType === "ice-candidate") {
          const pc = pcMapRef.current.get(senderId);
          if (pc && data?.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        }
      } catch (err) {
        console.error("Student WebRTC error:", err);
      }
    };

    import("pusher-js").then((Pusher) => {
      pusherClient = new Pusher.default(
        process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
        { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1", authEndpoint: "/api/pusher/auth" }
      );

      const channel = pusherClient.subscribe(studentChannelName);
      channel.bind("webrtc-signal", handleWebRTCSignal);

      // Instantly announce student readiness to teacher
      fetch("/api/live/webrtc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: quiz.teacherId,
          targetChannel: teacherChannelName,
          signalType: "student-ready",
          data: { quizId },
        }),
      }).catch(() => {});
    });

    return () => {
      pcMapRef.current.forEach((pc) => pc.close());
      pcMapRef.current.clear();
      if (pusherClient) {
        pusherClient.unsubscribe(studentChannelName);
        pusherClient.disconnect();
      }
    };
  }, [hasStarted, userId, quiz?.teacherId, quizId]);

  // Detect mobile device on mount
  useEffect(() => {
    const capabilities = getBrowserDeviceCapabilities();
    setDeviceCapabilities(capabilities);
    setIsMobile(capabilities.deviceType === "mobile");
    setIsOnline(navigator.onLine);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setAutosaveStatus("idle");
    };
    const handleOffline = () => {
      setIsOnline(false);
      setAutosaveStatus("offline");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const restoreSavedAnswers = useCallback((data: any) => {
    const restored: Record<number, number> = {};
    const restoredFeedback: Record<number, { choiceId: number; isCorrect: boolean }> = {};
    if (Array.isArray(data.savedAnswers)) {
      for (const answer of data.savedAnswers) {
        const questionId = Number(answer.questionId);
        const choiceId = Number(answer.choiceId);
        if (Number.isInteger(questionId) && Number.isInteger(choiceId)) {
          restored[questionId] = choiceId;
          if (typeof answer.isCorrect === "boolean") {
            restoredFeedback[questionId] = { choiceId, isCorrect: answer.isCorrect };
          }
        }
      }
    }
    const attemptId = typeof data.studentQuizId === "string" ? data.studentQuizId : "";
    if (attemptId) {
      try {
        const local = JSON.parse(localStorage.getItem(`proctorshield:answers:${attemptId}`) || "{}") as Record<string, unknown>;
        for (const [questionId, choiceId] of Object.entries(local)) {
          const numericQuestionId = Number(questionId);
          const numericChoiceId = Number(choiceId);
          if (Number.isInteger(numericQuestionId) && Number.isInteger(numericChoiceId)) {
            restored[numericQuestionId] = numericChoiceId;
          }
        }
      } catch {}
    }
    if (Object.keys(restored).length > 0) {
      setAnswersState((current) => Object.keys(current).length > 0 ? current : restored);
    }
    if (Object.keys(restoredFeedback).length > 0) {
      setAnswerFeedback((current) => Object.keys(current).length > 0 ? current : restoredFeedback);
    }
    if (Array.isArray(data.questions) && data.questions.length > 0) {
      const firstUnlocked = data.questions.findIndex((question: { id: number }) => !restoredFeedback[question.id]);
      setCurrentQuestionIndex(firstUnlocked >= 0 ? firstUnlocked : data.questions.length - 1);
    }
    const restoredViolationCount = Math.min(3, Math.max(0, Number(data.violationCount) || 0));
    violationCountRef.current = restoredViolationCount;
    setViolationCount(restoredViolationCount);
  }, []);

  const runDevicePreflight = useCallback(async () => {
    if (isCheckingDevice) return false;
    if (quiz?.quizMode === "arena") {
      router.replace(`/arena/${quizId}`);
      return false;
    }
    setIsCheckingDevice(true);
    setDeviceCheckError("");
    let testStream: MediaStream | null = null;

    try {
      const capabilities = getBrowserDeviceCapabilities();
      setDeviceCapabilities(capabilities);
      setIsMobile(capabilities.deviceType === "mobile");
      if (!capabilities.secureContext) {
        throw new Error("Camera monitoring requires HTTPS. Open the secure exam URL on this device.");
      }
      if (!capabilities.cameraSupported) {
        throw new Error("This browser does not provide camera access. Use current Chrome, Safari, or Edge.");
      }

      let microphonePermission = false;
      try {
        testStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: true,
        });
        microphonePermission = testStream.getAudioTracks().length > 0;
      } catch {
        testStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      }

      const verified: DeviceCapabilities = {
        ...capabilities,
        cameraPermission: testStream.getVideoTracks().length > 0,
        microphonePermission,
      };
      const response = await fetch("/api/quizzes/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId: Number(quizId), capabilities: verified }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Device check failed.");
      }

      setDeviceCapabilities(verified);
      setMonitoringLevel(result.monitoringLevel);
      setPreflightPassed(true);
      return true;
    } catch (error) {
      setPreflightPassed(false);
      setMonitoringLevel("unsupported");
      setDeviceCheckError(error instanceof Error ? error.message : "Device check failed.");
      return false;
    } finally {
      testStream?.getTracks().forEach((track) => track.stop());
      setIsCheckingDevice(false);
    }
  }, [isCheckingDevice, quizId]);

  useEffect(() => {
    const loadQuiz = async () => {
      try {
        const res = await fetch(`/api/quizzes/${quizId}`);
        const data = await res.json();
        if (res.ok && data.success) {
          // ARENA ROUTE GUARD: If quiz is an arena quiz, redirect immediately
          if (data.quiz?.quizMode === "arena") {
            router.replace(`/arena/${quizId}`);
            return;
          }
          setQuiz(data.quiz);
          setQuestions(data.questions || []);
          setStudentQuizStatus(data.studentQuizStatus || "");
          setStudentQuizId(data.studentQuizId || null);
          setCanEnterQuiz(data.canEnterQuiz === true);
          setUserId(data.userId || "");
          restoreSavedAnswers(data);
          if (data.deviceType) setIsMobile(data.deviceType === "mobile");
          if (data.monitoringLevel === "strict" || data.monitoringLevel === "reduced") {
            setMonitoringLevel(data.monitoringLevel);
          }
          if (Number.isInteger(data.remainingSeconds)) setTimeLeft(data.remainingSeconds);
          else if (data.quiz.duration) setTimeLeft(data.quiz.duration * 60);
        } else {
          setQuizError(data.error || "Failed to load quiz");
        }
      } catch (err) {
        setQuizError("Network error loading quiz");
      } finally {
        setLoadingQuiz(false);
      }
    };
    loadQuiz();

    // Auto-poll every 3s if quiz is in draft/waiting mode
    const pollInterval = setInterval(() => {
      if (!hasStarted) {
        fetch(`/api/quizzes/${quizId}`)
          .then((res) => res.json())
          .then((data) => {
            if (data.success && data.quiz) {
              if (data.quiz.quizMode === "arena") {
                router.replace(`/arena/${quizId}`);
                return;
              }
              setQuiz(data.quiz);
              setQuestions(data.questions || []);
              setStudentQuizStatus(data.studentQuizStatus || "");
              setStudentQuizId(data.studentQuizId || null);
              setCanEnterQuiz(data.canEnterQuiz === true);
              restoreSavedAnswers(data);
              if (Number.isInteger(data.remainingSeconds)) setTimeLeft(data.remainingSeconds);
              else if (data.quiz.duration) setTimeLeft(data.quiz.duration * 60);
            }
          })
          .catch(() => {});
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [quizId, hasStarted, restoreSavedAnswers]);

  // Handle pusher lobby real-time updates
  useEffect(() => {
    if (!quizId || !userId) return;

    let pusherClient: any;
    let cancelled = false;
    
    import("pusher-js").then((Pusher) => {
      if (cancelled) return;
      pusherClient = new Pusher.default(process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774", {
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1",
        authEndpoint: "/api/pusher/auth",
      });

      const quizChannel = pusherClient.subscribe(`private-quiz-${quizId}`);
      quizChannel.bind("quiz-started", (data: any) => {
        // Teacher started quiz! Fetch full quiz data immediately
        fetch(`/api/quizzes/${quizId}`)
          .then((res) => res.json())
          .then((freshData) => {
            if (freshData.success) {
              setQuiz(freshData.quiz);
              setQuestions(freshData.questions || []);
              setStudentQuizStatus(freshData.studentQuizStatus || "");
              setStudentQuizId(freshData.studentQuizId || null);
              setCanEnterQuiz(freshData.canEnterQuiz === true);
              restoreSavedAnswers(freshData);
              if (Number.isInteger(freshData.remainingSeconds)) setTimeLeft(freshData.remainingSeconds);
              else if (freshData.quiz.duration) setTimeLeft(freshData.quiz.duration * 60);
            }
          })
          .catch(() => {});
      });

      const studentChannel = pusherClient.subscribe(`private-student-${userId}`);
      studentChannel.bind("approval-status", (data: any) => {
        if (data.quizId === parseInt(quizId)) {
          setStudentQuizStatus(data.status);
          setCanEnterQuiz(false);
          if (data.status === "rejected") {
            setQuizError("Your request to join late was rejected by the teacher.");
          }
        }
      });
      studentChannel.bind("teacher-warning", receiveTeacherWarning);
    }).catch(() => {
      // The polling fallback below still delivers teacher warnings when the
      // realtime client cannot connect on a restricted or unstable network.
    });

    return () => {
      cancelled = true;
      if (pusherClient) {
        pusherClient.unsubscribe(`private-quiz-${quizId}`);
        pusherClient.unsubscribe(`private-student-${userId}`);
        pusherClient.disconnect();
      }
    };
  }, [quizId, userId, receiveTeacherWarning, restoreSavedAnswers]);

  // Reconcile missed realtime events after a phone wakes, reconnects, or
  // returns from the background. Warning IDs prevent duplicate pop-ups.
  useEffect(() => {
    if (!hasStarted || !userId) return;

    let cancelled = false;
    const checkForWarning = async () => {
      try {
        const response = await fetch(`/api/live/warning?quizId=${encodeURIComponent(quizId)}`, {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!cancelled && response.ok && data.warning) receiveTeacherWarning(data.warning);
      } catch {
        // A later poll or the Pusher event will retry delivery.
      }
    };

    void checkForWarning();
    const intervalId = window.setInterval(() => void checkForWarning(), 5_000);
    window.addEventListener("online", checkForWarning);
    document.addEventListener("visibilitychange", checkForWarning);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("online", checkForWarning);
      document.removeEventListener("visibilitychange", checkForWarning);
    };
  }, [hasStarted, quizId, receiveTeacherWarning, userId]);

  const handleEnterQuiz = async () => {
    if (isEnteringQuiz) return;
    setIsEnteringQuiz(true);
    setLobbyError("");

    try {
      if (!preflightPassed && !await runDevicePreflight()) {
        setLobbyError("Complete the device and camera check before starting the quiz.");
        return;
      }

      // Some Android/OEM Chrome builds keep reporting the page as visible when
      // the user presses Home. Entering fullscreen from this direct user action
      // provides a second lifecycle signal because Android exits fullscreen
      // when the exam is backgrounded.
      if (isMobile && document.documentElement.requestFullscreen && !document.fullscreenElement) {
        try {
          await document.documentElement.requestFullscreen();
          fullscreenMonitoringRef.current = Boolean(document.fullscreenElement);
        } catch {
          fullscreenMonitoringRef.current = false;
        }
      }

      const response = await fetch(`/api/quizzes/${quizId}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setLobbyError(data.error || "Unable to verify the quiz start status.");
        return;
      }

      if (data.quiz?.quizMode === "arena") {
        router.replace(`/arena/${quizId}`);
        return;
      }

      setQuiz(data.quiz);
      setQuestions(data.questions || []);
      setStudentQuizStatus(data.studentQuizStatus || "");
      setStudentQuizId(data.studentQuizId || null);
      setCanEnterQuiz(data.canEnterQuiz === true);
      restoreSavedAnswers(data);

      if (data.canEnterQuiz !== true || !data.questions?.length) {
        setLobbyError("The teacher has not started this quiz yet. Please remain in the lobby.");
        return;
      }

      if (Number.isInteger(data.remainingSeconds)) setTimeLeft(data.remainingSeconds);
      else if (data.quiz.duration) setTimeLeft(data.quiz.duration * 60);
      setHasStarted(true);
    } catch {
      setLobbyError("Could not verify the quiz status. Check your connection and try again.");
    } finally {
      setIsEnteringQuiz(false);
    }
  };

  // ── Capture webcam snapshot as base64 ──────────────────
  const captureSnapshot = useCallback((): string | null => {
    const video = (videoRef.current && videoRef.current.videoWidth > 0)
      ? videoRef.current
      : (mobileVideoRef.current && mobileVideoRef.current.videoWidth > 0)
      ? mobileVideoRef.current
      : videoRef.current || mobileVideoRef.current;

    if (!video) return null;
    if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) return null;

    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
    }

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    const maxWidth = isMobile ? 320 : 480;
    const maxHeight = isMobile ? 240 : 360;
    const scale = Math.min(1, maxWidth / w, maxHeight / h);
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", isMobile ? 0.52 : 0.65);
    } catch {
      return null;
    }
  }, [isMobile]);

  // Stable refs for exam state
  const answersStateRef = useRef<Record<number, number>>({});
  const questionsRef = useRef(questions);
  const studentQuizIdRef = useRef(studentQuizId);
  const violationCountStateRef = useRef(violationCount);
  const pendingEvidenceUploadRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    answersStateRef.current = answersState;
    questionsRef.current = questions;
    studentQuizIdRef.current = studentQuizId;
    violationCountStateRef.current = violationCount;
    isSubmittingRef.current = isSubmitting;
    examActiveRef.current = hasStarted && !isSubmitting && !quizSubmittedResult && violationCount < 3;
  }, [answersState, questions, studentQuizId, violationCount, hasStarted, isSubmitting, quizSubmittedResult]);

  const autosaveAnswers = useCallback(async () => {
    const currentStudentQuizId = studentQuizIdRef.current;
    if (!hasStarted || !currentStudentQuizId) return false;
    if (!navigator.onLine) {
      setAutosaveStatus("offline");
      return false;
    }

    const payloadAnswers = Object.entries(answersStateRef.current).map(([questionId, choiceId]) => ({
      questionId: Number(questionId),
      choiceId,
    }));
    setAutosaveStatus("saving");
    try {
      const response = await fetch("/api/quizzes/autosave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId: Number(quizId), answers: payloadAnswers }),
      });
      if (!response.ok) {
        setAutosaveStatus("error");
        return false;
      }
      setAutosaveStatus("saved");
      return true;
    } catch {
      setAutosaveStatus(navigator.onLine ? "error" : "offline");
      return false;
    }
  }, [hasStarted, quizId]);

  useEffect(() => {
    if (!studentQuizId) return;
    try {
      localStorage.setItem(`proctorshield:answers:${studentQuizId}`, JSON.stringify(answersState));
    } catch {}
  }, [answersState, studentQuizId]);

  useEffect(() => {
    if (!hasStarted || !studentQuizId) return;
    const debounce = window.setTimeout(() => void autosaveAnswers(), 900);
    return () => window.clearTimeout(debounce);
  }, [answersState, autosaveAnswers, hasStarted, studentQuizId]);

  useEffect(() => {
    if (!hasStarted || !studentQuizId) return;
    const heartbeat = window.setInterval(() => void autosaveAnswers(), 15_000);
    if (isOnline && autosaveStatus === "offline") void autosaveAnswers();
    return () => window.clearInterval(heartbeat);
  }, [autosaveAnswers, autosaveStatus, hasStarted, isOnline, studentQuizId]);

  // ── Submit quiz to backend ────────────────────────────
  const submitQuiz = useCallback(async () => {
    if (submissionInFlightRef.current) return;
    if (!navigator.onLine) {
      setAutosaveStatus("offline");
      setPreWarning("You are offline. Your answers are safe on this device and submission will resume when the connection returns.");
      return;
    }
    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    try {
      // A page transition can cancel MediaRecorder/upload work on mobile. Keep the
      // quiz alive until an in-progress evidence clip has finished persisting.
      if (pendingEvidenceUploadRef.current) {
        await pendingEvidenceUploadRef.current;
      }
      const currentAnswers = answersStateRef.current;
      const currentQuestions = questionsRef.current;
      const currentStudentQuizId = studentQuizIdRef.current;
      const currentViolations = violationCountStateRef.current;

      const payloadAnswers = Object.entries(currentAnswers).map(([qId, cId]) => ({
        questionId: parseInt(qId),
        choiceId: cId
      }));

      const res = await fetch("/api/quizzes/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId: parseInt(quizId),
          answers: payloadAnswers,
          studentQuizId: currentStudentQuizId,
        })
      });

      const data = await res.json();
      if (res.ok) {
        // Stop autosave, monitoring, and heartbeat effects as soon as the server
        // accepts the final submission. This prevents late mobile requests from
        // racing the completed attempt and producing avoidable 409 responses.
        setHasStarted(false);
        if (currentStudentQuizId) {
          try { localStorage.removeItem(`proctorshield:answers:${currentStudentQuizId}`); } catch {}
        }
        playTone([523, 659, 783, 1046, 1318], "triangle", 0.25);
        const serverViolationCount = Number.isInteger(Number(data.result?.violationCount))
          ? Math.max(0, Number(data.result.violationCount))
          : currentViolations;
        const serverVerdict = ["clean", "suspicious", "cheated"].includes(data.result?.aiVerdict)
          ? data.result.aiVerdict as QuizSubmittedResult["aiVerdict"]
          : serverViolationCount >= 3
            ? "cheated"
            : serverViolationCount > 0
              ? "suspicious"
              : "clean";
        const integrityInvalidated = data.result?.integrityInvalidated === true
          || serverVerdict === "cheated"
          || serverViolationCount >= 3;
        setQuizSubmittedResult({
          score: data.result?.score == null ? null : Number(data.result.score),
          total: 100,
          violations: serverViolationCount,
          integrityInvalidated,
          aiVerdict: integrityInvalidated ? "cheated" : serverVerdict,
          expEarned: typeof data.result?.expEarned === "number" ? data.result.expEarned : 100,
          coinsEarned: typeof data.result?.coinsEarned === "number" ? data.result.coinsEarned : 0,
          rank: data.result?.rank ?? 1,
          isTopOne: data.result?.isTopOne === true,
          rankTitle: data.result?.rankTitle ?? "Rank #1",
          totalCoins: data.result?.totalCoins ?? 100,
        });
      } else {
        if (res.status === 409 && /already (?:been )?(?:submitted|completed)|already being submitted/i.test(data.error || "")) {
          router.replace("/dashboard/student/results");
          return;
        }
        setPreWarning(data.error || "Submission failed. Please try again.");
        submissionInFlightRef.current = false;
        setIsSubmitting(false);
      }
    } catch (err) {
      setPreWarning("Network error submitting quiz. Your saved answers are safe; please try again.");
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }, [quizId, playTone, router, setPreWarning]);

  const submitQuizRef = useRef(submitQuiz);
  useEffect(() => {
    submitQuizRef.current = submitQuiz;
  }, [submitQuiz]);

  useEffect(() => {
    if (!hasStarted || violationCount < 3 || isAlertingRef.current || isSubmitting) return;
    isAlertingRef.current = true;
    setWarningModal({
      show: true,
      message: "You have accumulated 3 security violations. Your quiz is now being submitted automatically.",
      isFinal: true,
    });
    const timer = window.setTimeout(() => void submitQuizRef.current(), 1_500);
    return () => window.clearTimeout(timer);
  }, [hasStarted, isSubmitting, violationCount]);

  const handleSelectChoice = useCallback(async (
    questionId: number,
    choiceId: number,
    questionIndex: number,
  ) => {
    if (
      isCheckingAnswer
      || answerFeedback[questionId]
    ) return;

    setIsCheckingAnswer(true);
    setPreWarning(null);
    try {
      const response = await fetch("/api/quizzes/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId: Number(quizId), questionId, choiceId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setPreWarning(data.error || "Your answer could not be recorded. Please try again.");
        setIsCheckingAnswer(false);
        return;
      }

      const recordedChoiceId = Number(data.choiceId);
      const isCorrect = data.isCorrect === true;
      const nextAnswers = { ...answersStateRef.current, [questionId]: recordedChoiceId };
      answersStateRef.current = nextAnswers;
      setAnswersState(nextAnswers);
      setAnswerFeedback((current) => ({
        ...current,
        [questionId]: { choiceId: recordedChoiceId, isCorrect },
      }));

      if (isCorrect) {
        playTone([523, 659, 784], "sine", 0.08);
      } else {
        playTone([220, 165], "sawtooth", 0.12);
      }

      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = window.setTimeout(() => {
        setIsCheckingAnswer(false);
        if (questionIndex >= questionsRef.current.length - 1) {
          void submitQuizRef.current();
        } else {
          setCurrentQuestionIndex(questionIndex + 1);
        }
      }, 1_100);
    } catch {
      setPreWarning("Network error. Your answer was not recorded; please tap it again.");
      setIsCheckingAnswer(false);
    }
  }, [answerFeedback, isCheckingAnswer, playTone, quizId, setPreWarning]);

const handleFillBlankSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const currentQ = questions[currentQuestionIndex];
    if (!currentQ || !fillBlankInput.trim() || isCheckingAnswer || answerFeedback[currentQ.id]) return;

    const trimmed = fillBlankInput.trim().toLowerCase();
    const matched = currentQ.choices.find(
      (ch: any) => ch.isCorrect && ch.choiceText.trim().toLowerCase() === trimmed
    );

    if (matched) {
      void handleSelectChoice(currentQ.id, matched.id, currentQuestionIndex);
    } else {
      const fallbackChoice = currentQ.choices.find((ch: any) => !ch.isCorrect) || currentQ.choices[0];
      if (fallbackChoice) {
        void handleSelectChoice(currentQ.id, fallbackChoice.id, currentQuestionIndex);
      }
    }
  }, [questions, currentQuestionIndex, fillBlankInput, isCheckingAnswer, answerFeedback, handleSelectChoice]);

  useEffect(() => () => {
    if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
  }, []);

  const captureEvidenceClip = useCallback(async (durationMs = 4_000): Promise<{
    blob: Blob;
    durationMs: number;
    extension: "webm" | "mp4";
  } | null> => {
    const sourceStream = mediaStreamRef.current;
    if (!sourceStream || typeof MediaRecorder === "undefined") return null;

    const liveTracks = sourceStream.getTracks().filter((track) => track.readyState === "live");
    if (!liveTracks.some((track) => track.kind === "video")) return null;

    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];
    const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) return null;

    try {
      const recorder = new MediaRecorder(new MediaStream(liveTracks), {
        mimeType,
        videoBitsPerSecond: 350_000,
        audioBitsPerSecond: 32_000,
      });
      const chunks: BlobPart[] = [];

      return await new Promise((resolve) => {
        let finished = false;
        const finish = (clip: { blob: Blob; durationMs: number; extension: "webm" | "mp4" } | null) => {
          if (finished) return;
          finished = true;
          resolve(clip);
        };

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onerror = () => finish(null);
        recorder.onstop = () => {
          if (chunks.length === 0) return finish(null);
          const normalizedType = mimeType.startsWith("video/mp4") ? "video/mp4" : "video/webm";
          finish({
            blob: new Blob(chunks, { type: normalizedType }),
            durationMs,
            extension: normalizedType === "video/mp4" ? "mp4" : "webm",
          });
        };

        recorder.start(500);
        window.setTimeout(() => {
          if (recorder.state !== "inactive") recorder.stop();
        }, durationMs);
      });
    } catch (error) {
      console.warn("Evidence video recording is unavailable:", error);
      return null;
    }
  }, []);

  // ── Report Violation to Backend ───────────────────────
  const reportViolation = useCallback(async (type: string, confidenceScore = 92): Promise<boolean> => {
    const now = Date.now();
    if (
      !examActiveRef.current ||
      submissionInFlightRef.current ||
      violationCountRef.current >= 3 ||
      isReportingRef.current ||
      now - lastViolationAtRef.current < 1_200
    ) return false;

    isReportingRef.current = true;
    lastViolationAtRef.current = now;

    let finishEvidenceUpload!: () => void;
    const evidenceUploadCompletion = new Promise<void>((resolve) => {
      finishEvidenceUpload = resolve;
    });
    pendingEvidenceUploadRef.current = evidenceUploadCompletion;

    try {
      const evidenceClipPromise = captureEvidenceClip();
      const base64Img = captureSnapshot();

      const response = await fetch("/api/live/violation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId: parseInt(quizId),
          studentQuizId: studentQuizIdRef.current,
          violationType: type,
          confidenceScore,
          screenshot: base64Img,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        console.error("Violation API rejected event:", type, response.status, data?.error);
        return false;
      }

      const violationId = String(data.violation?.id || "");
      if (/^\d+$/.test(violationId)) {
        const clip = await evidenceClipPromise;
        if (clip) {
          const formData = new FormData();
          formData.append("evidence", clip.blob, `violation-${violationId}.${clip.extension}`);
          formData.append("durationMs", String(clip.durationMs));
          void fetch(`/api/live/violation/${violationId}/evidence`, {
            method: "POST",
            body: formData,
          }).catch(() => {});
        }
      }

      const serverCount = Number(data.violationCount);
      const currentCount = Number.isInteger(serverCount) && serverCount > 0
        ? serverCount
        : violationCountRef.current + 1;
      violationCountRef.current = currentCount;
      setViolationCount(currentCount);

      playTone([250, 180], "sawtooth", 0.2);

      const violationLabel = getViolationLabel(type);
      if (currentCount >= 3) {
        isAlertingRef.current = true;
        setWarningModal({
          show: true,
          message: `Violation ${currentCount}/3: ${violationLabel}. Your quiz is now being submitted automatically.`,
          isFinal: true,
        });
        setTimeout(() => {
          submitQuizRef.current();
        }, 3000);
      } else {
        setWarningModal({
          show: true,
          message: `Violation ${currentCount}/3: ${violationLabel}. Please correct this before continuing.`,
          isFinal: false,
        });
      }
      return true;
    } catch (err) {
      console.error("Failed to report violation:", err);
      return false;
    } finally {
      finishEvidenceUpload();
      if (pendingEvidenceUploadRef.current === evidenceUploadCompletion) {
        pendingEvidenceUploadRef.current = null;
      }
      isReportingRef.current = false;
    }
  }, [quizId, captureEvidenceClip, captureSnapshot, playTone, setWarningModal]);

  const reportViolationRef = useRef(reportViolation);
  const triggerViolation = useCallback((type: string, score = 92) => reportViolation(type, score), [reportViolation]);
  useEffect(() => {
    reportViolationRef.current = reportViolation;
  }, [reportViolation]);

  // ── Notify Teacher on Student Joining ─────────────────
  const notifyTeacherJoined = useCallback(async () => {
    if (!quiz?.teacherId) return;
    try {
      await fetch("/api/live/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId: quiz.teacherId,
          quizId: parseInt(quizId),
          quizTitle: quiz.title,
          studentQuizId: studentQuizId,
        }),
      });
    } catch (err) {}
  }, [quiz, quizId, studentQuizId]);

  // ── Camera and Edge AI Tracking Loop ──────────────────
  useEffect(() => {
    if (!hasStarted) return;

    const performanceProfile = getBrowserProctoringPerformanceProfile(isMobile ? "mobile" : "desktop");
    let snapshotInterval: NodeJS.Timeout | null = null;
    let faceDetectionInterval: NodeJS.Timeout | null = null;
    let objectModelSlowTimer: NodeJS.Timeout | null = null;
    let audioInterval: NodeJS.Timeout | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let microphone: MediaStreamAudioSourceNode | null = null;
    let audioResumeListener: (() => void) | null = null;
    let cancelled = false;
    let loadedCocoModel: any = null;
    const desktopVideoElement = videoRef.current;
    const mobileVideoElement = mobileVideoRef.current;

    const disposeLoadedModels = () => {
      try {
        loadedCocoModel?.dispose?.();
      } catch {
        // The object model may already have been released during a fast remount.
      }
      loadedCocoModel = null;

      // face-api's network objects are module-level singletons shared by every
      // effect instance. Disposing them here lets an earlier React cleanup tear
      // down weights that a newer active monitor is already using, which can
      // crash the quiz with "model has no loaded params" on mobile remounts.
      // Keep those small shared weights cached for the lifetime of the page.
    };

    const startAudioAnalysis = (stream: MediaStream, audioActive: boolean) => {
      if (!audioActive || stream.getAudioTracks().length === 0) {
        setAudioLevel(0);
        setAudioStatus("Microphone unavailable ✗");
        setPreWarning("Microphone monitoring is unavailable. Enable microphone permission, then reload and run the device check again.");
        return;
      }

      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) throw new Error("Web Audio is unsupported");

        audioContext = new AudioContextClass();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.35;

        const samples = new Uint8Array(analyser.fftSize);
        let calibrationSamples = 0;
        let calibrationTotal = 0;
        let noiseFloor = 0;
        let anomalyFrames = 0;

        const resumeAudio = () => {
          if (!audioContext || audioContext.state !== "suspended") return;
          void audioContext.resume().then(() => {
            if (!cancelled && audioContext?.state === "running") setAudioStatus("Active ✓");
          }).catch(() => {});
        };
        audioResumeListener = resumeAudio;
        window.addEventListener("pointerdown", resumeAudio, { passive: true });
        resumeAudio();
        setAudioStatus(audioContext.state === "running" ? "Active ✓" : "Tap to enable audio");

        audioInterval = setInterval(async () => {
          if (!audioContext || !analyser || cancelled) return;
          if (document.hidden) {
            // Browsers may keep audio callbacks alive briefly after the app is
            // backgrounded. Let the dedicated tab/app-switch detector own that
            // incident instead of mislabeling it as an audio violation.
            anomalyFrames = 0;
            return;
          }
          if (audioContext.state === "suspended") {
            setAudioStatus("Tap to enable audio");
            await audioContext.resume().catch(() => {});
            const resumedState: string = audioContext.state;
            if (resumedState !== "running") return;
          }

          setAudioStatus("Active ✓");
          analyser.getByteTimeDomainData(samples);
          const levelPercent = getAudioSignalLevel(samples);
          setAudioLevel(levelPercent);

          if (calibrationSamples < 8) {
            calibrationTotal += levelPercent;
            calibrationSamples++;
            if (calibrationSamples === 8) {
              // Cap the learned baseline so talking during startup cannot make
              // the detector permanently insensitive for the whole exam.
              noiseFloor = Math.min(12, calibrationTotal / calibrationSamples);
            }
            return;
          }

          const threshold = getAudioAnomalyThreshold(noiseFloor);
          if (levelPercent >= threshold) {
            anomalyFrames++;
            if (anomalyFrames === 2) {
              setPreWarning("⚠️ Pre-Warning: Sustained sound or speaking detected. Please remain quiet.");
            }
            if (
              anomalyFrames >= 5 &&
              violationCountRef.current < 3 &&
              !isAlertingRef.current &&
              !isReportingRef.current
            ) {
              const persisted = await reportViolationRef.current("audio_anomaly");
              anomalyFrames = persisted ? 0 : 3;
              if (persisted) setPreWarning(null);
            }
          } else {
            anomalyFrames = Math.max(0, anomalyFrames - 2);
            noiseFloor = Math.min(12, noiseFloor * 0.9 + levelPercent * 0.1);
            if (anomalyFrames === 0 && !isAlertingRef.current) {
              setPreWarning((current) => current?.includes("Sustained sound") ? null : current);
            }
          }
        }, performanceProfile.audioIntervalMs);
      } catch (error) {
        console.warn("Audio monitoring initialization failed:", error);
        setAudioLevel(0);
        setAudioStatus("Audio unavailable ✗");
        setPreWarning("Audio monitoring could not initialize. Tap the page once, or reload and allow microphone access.");
      }
    };

    const startMedia = async () => {
      let videoStream: MediaStream | null = null;
      let audioOk = false;

      try {
        videoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: performanceProfile.captureWidth, max: 640 },
            height: { ideal: performanceProfile.captureHeight, max: 480 },
            frameRate: { ideal: performanceProfile.frameRate, max: performanceProfile.frameRate },
          },
          audio: true,
        });
        audioOk = true;
      } catch (err) {
        try {
          videoStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "user",
              width: { ideal: performanceProfile.captureWidth, max: 640 },
              height: { ideal: performanceProfile.captureHeight, max: 480 },
              frameRate: { ideal: performanceProfile.frameRate, max: performanceProfile.frameRate },
            },
            audio: false,
          });
        } catch (vErr) {
          throw new Error("Unable to access camera. Please allow camera permissions.");
        }
      }
      return { stream: videoStream, audioActive: audioOk };
    };

    const uploadSnapshot = async () => {
      const snap = captureSnapshot();
      if (!snap) return;
      try {
        await fetch("/api/live/snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quizId: parseInt(quizId),
            teacherId: quiz?.teacherId,
            studentQuizId: studentQuizIdRef.current,
            quizTitle: quiz?.title || "Quiz",
            snapshot: snap,
          }),
        });
      } catch {}
    };

    startMedia()
      .then(async ({ stream, audioActive }) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        mediaStreamRef.current = stream;
        const activeVideoElement = isMobile ? mobileVideoRef.current : videoRef.current;
        const inactiveVideoElement = isMobile ? videoRef.current : mobileVideoRef.current;
        if (inactiveVideoElement) {
          inactiveVideoElement.pause();
          inactiveVideoElement.srcObject = null;
        }
        if (activeVideoElement) {
          activeVideoElement.srcObject = stream;
          activeVideoElement.play().catch(() => {});
        }
        setCameraActive(true);
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.addEventListener("ended", () => {
            setCameraActive(false);
            setAiStatus("Camera disconnected");
            setDeviceStatus("Camera disconnected ✗");
            setPreWarning("Camera feed was disconnected. Reconnect it immediately.");
            void reportViolationRef.current("camera_unavailable", 100);
          }, { once: true });
        }

        setTimeout(() => notifyTeacherJoined(), 1500);

        // Keep the teacher preview current without continuously encoding and
        // uploading JPEG frames on constrained mobile devices.
        uploadSnapshot();
        snapshotInterval = setInterval(() => {
          if (!document.hidden && !isReportingRef.current) void uploadSnapshot();
        }, performanceProfile.snapshotIntervalMs);

        // Audio must start independently of the much larger object-detection
        // model so a slow mobile download cannot silently disable the mic.
        startAudioAnalysis(stream, audioActive);

        // Load Edge AI Models
        try {
          setAiStatus("Loading AI detectors...");
          preloadProctoringModels(performanceProfile.useTinyLandmarks, performanceProfile.objectModelBase);

          const faceapi = await cachedFaceApiPromise;
          if (cancelled) {
            disposeLoadedModels();
            return;
          }

          setFaceStatus("Scanning ✓");
          setGazeStatus("Focused ✓");
          setDeviceStatus("Loading device AI...");
          setAiStatus("Face active · device loading");

          let lookingAwayFrames = 0;
          let lookingAwayViolationRecorded = false;
          let noFaceFrames = 0;
          let noFaceViolationRecorded = false;
          let multipleFacesFrames = 0;
          let multipleFacesViolationRecorded = false;
          let phoneDetectedFrames = 0;
          let phoneAbsentFrames = 0;
          let phoneViolationRecorded = false;
          let tickCounter = 0;
          let detectionBusy = false;

          objectModelSlowTimer = setTimeout(() => {
            if (!cancelled && !loadedCocoModel) setDeviceStatus("Still loading device AI...");
          }, 10_000);

          if (cachedCocoModelPromise) {
            cachedCocoModelPromise
              .then((cocoModel) => {
                if (cancelled) return;
                loadedCocoModel = cocoModel;
                noFaceFrames = 0;
                phoneDetectedFrames = 0;
                tickCounter = 0;
                if (objectModelSlowTimer) clearTimeout(objectModelSlowTimer);
                objectModelSlowTimer = null;
                setDeviceStatus("Scanning ✓");
                setAiStatus("Active ✓");
              })
              .catch((error) => {
                if (cancelled) return;
                if (objectModelSlowTimer) clearTimeout(objectModelSlowTimer);
                objectModelSlowTimer = null;
                console.warn("Object detection model initialization failed:", error);
                setDeviceStatus("Device AI unavailable ✗");
                setAiStatus("Face active · device unavailable");
              });
          }

          const inferenceCanvas = document.createElement("canvas");
          inferenceCanvas.width = performanceProfile.inferenceWidth;
          inferenceCanvas.height = performanceProfile.inferenceHeight;
          const inferenceContext = inferenceCanvas.getContext("2d", { alpha: false });
          if (!inferenceContext) throw new Error("Unable to initialize the AI frame buffer.");

          faceDetectionInterval = setInterval(async () => {
            if (
              document.hidden ||
              document.visibilityState === "hidden" ||
              detectionBusy ||
              !examActiveRef.current ||
              violationCountRef.current >= 3 ||
              submissionInFlightRef.current ||
              isReportingRef.current
            ) return;

            const activeVideo = isMobile ? mobileVideoRef.current : videoRef.current;
            if (!activeVideo || activeVideo.readyState < 2 || activeVideo.videoWidth === 0 || activeVideo.videoHeight === 0) {
              if (activeVideo && activeVideo.paused && mediaStreamRef.current?.active) {
                activeVideo.play().catch(() => {});
              }
              return;
            }
            detectionBusy = true;

            try {
              inferenceContext.drawImage(
                activeVideo,
                0,
                0,
                performanceProfile.inferenceWidth,
                performanceProfile.inferenceHeight,
              );
            } catch {
              detectionBusy = false;
              return;
            }

            // Alternate scan: device AI on even ticks, face AI on odd ticks
            if (tickCounter % 2 === 1 || !loadedCocoModel) {
              try {
                const detections = await faceapi.detectAllFaces(
                  inferenceCanvas,
                  new faceapi.TinyFaceDetectorOptions({
                    inputSize: performanceProfile.faceInputSize,
                    scoreThreshold: 0.5,
                  })
                ).withFaceLandmarks(performanceProfile.useTinyLandmarks);

                if (detections.length === 0) {
                  noFaceFrames++;
                  if (noFaceFrames === 2) {
                    setPreWarning("⚠️ Warning: No face detected. Please face your camera.");
                  }
                  if ((!isMobile || loadedCocoModel) && noFaceFrames >= (isMobile ? 4 : 5) && !noFaceViolationRecorded) {
                    noFaceViolationRecorded = true;
                    await reportViolationRef.current("no_face", 100);
                  }
                  setFaceStatus("Not Detected ✗");
                } else if (detections.length > 1) {
                  multipleFacesFrames++;
                  if (multipleFacesFrames === 2) {
                    setPreWarning("⚠️ Warning: Multiple faces detected in frame.");
                  }
                  if (multipleFacesFrames >= (isMobile ? 3 : 4) && !multipleFacesViolationRecorded) {
                    multipleFacesViolationRecorded = true;
                    await reportViolationRef.current("multiple_faces", 100);
                  }
                  setFaceStatus("Multiple ✗");
                } else {
                  // Exactly 1 face detected -> reset no_face & multiple_faces incident states
                  noFaceFrames = 0;
                  noFaceViolationRecorded = false;
                  multipleFacesFrames = 0;
                  multipleFacesViolationRecorded = false;
                  setFaceStatus("Detected ✓");

                  const landmarks = detections[0].landmarks;
                  const leftEye = landmarks.getLeftEye();
                  const rightEye = landmarks.getRightEye();

                  const leftEyeX = leftEye.reduce((sum: number, p: any) => sum + p.x, 0) / leftEye.length;
                  const leftEyeY = leftEye.reduce((sum: number, p: any) => sum + p.y, 0) / leftEye.length;
                  const rightEyeX = rightEye.reduce((sum: number, p: any) => sum + p.x, 0) / rightEye.length;
                  const rightEyeY = rightEye.reduce((sum: number, p: any) => sum + p.y, 0) / rightEye.length;

                  const eyeCenterX = (leftEyeX + rightEyeX) / 2;
                  const eyeCenterY = (leftEyeY + rightEyeY) / 2;
                  const eyeDistance = Math.sqrt(Math.pow(rightEyeX - leftEyeX, 2) + Math.pow(rightEyeY - leftEyeY, 2)) || 1;

                  const nosePoints = landmarks.getNose();
                  const noseBottom = nosePoints[nosePoints.length - 1] || nosePoints[3];

                  const yawOffset = (noseBottom.x - eyeCenterX) / eyeDistance;
                  const pitchRatio = (noseBottom.y - eyeCenterY) / eyeDistance;

                  let direction = "Focused ✓";
                  let violationReason = "";

                  if (yawOffset < -0.38) {
                    direction = "Looking Right ✗";
                    violationReason = "looking_right";
                  } else if (yawOffset > 0.38) {
                    direction = "Looking Left ✗";
                    violationReason = "looking_left";
                  } else if (pitchRatio < 0.15) {
                    direction = "Looking Up ✗";
                    violationReason = "looking_up";
                  } else if (pitchRatio > 1.10) {
                    direction = "Looking Down ✗";
                    violationReason = "looking_down";
                  }

                  setGazeStatus(direction);

                  let radarX = 50 - (yawOffset * 100);
                  radarX = Math.max(15, Math.min(85, radarX));
                  let radarY = 50 + ((pitchRatio - 0.55) * 80);
                  radarY = Math.max(15, Math.min(85, radarY));
                  setHeadPos({ x: radarX, y: radarY });

                  if (direction !== "Focused ✓") {
                    lookingAwayFrames++;
                    if (lookingAwayFrames === 2) {
                      setPreWarning(`Please look directly at the screen. (${direction.replace(' ✗', '')})`);
                    }
                    if (lookingAwayFrames >= (isMobile ? 3 : 5) && !lookingAwayViolationRecorded) {
                      lookingAwayViolationRecorded = true;
                      await reportViolationRef.current(violationReason, 90);
                    }
                  } else {
                    lookingAwayFrames = 0;
                    lookingAwayViolationRecorded = false;
                  }
                }
              } catch (faceErr) {
                console.warn("Face detection frame failed:", faceErr);
              }
            } else {
              try {
                const predictions = await loadedCocoModel.detect(inferenceCanvas, 10, isMobile ? 0.2 : 0.25);
                const deviceConfidence = getUnauthorizedDeviceConfidence(predictions);

                if (deviceConfidence > 0) {
                  phoneDetectedFrames = Math.min(phoneDetectedFrames + 1, 5);
                  phoneAbsentFrames = 0;
                  setDeviceStatus(
                    phoneDetectedFrames >= 2
                      ? `Phone ${Math.round(deviceConfidence * 100)}% ✗`
                      : `Confirming ${Math.round(deviceConfidence * 100)}%…`
                  );
                  if (phoneDetectedFrames >= 2) {
                    setPreWarning("⚠️ Pre-Warning: Unauthorized device (phone) detected in frame!");
                    if (!phoneViolationRecorded) {
                      phoneViolationRecorded = true;
                      await reportViolationRef.current(
                        "device_detected",
                        Math.round(deviceConfidence * 100)
                      );
                    }
                  }
                } else {
                  phoneDetectedFrames = 0;
                  phoneAbsentFrames++;
                  if (phoneAbsentFrames >= 3) {
                    phoneViolationRecorded = false;
                    setDeviceStatus("None ✓");
                  }
                }
              } catch (cocoErr) {
                console.warn("Object detection frame failed:", cocoErr);
              }
            }
            tickCounter++;
            detectionBusy = false;
          }, performanceProfile.detectionIntervalMs);

        } catch (err) {
          if (cancelled) return;
          console.error("Proctoring AI model initialization failed:", err);
          setAiStatus("Detection unavailable");
          setDeviceStatus("AI unavailable ✗");
          setPreWarning("AI detection could not initialize. Check your connection and reload the exam.");
        }

      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Camera or microphone initialization failed:", err);
        setCameraActive(false);
        setAiStatus("Camera unavailable");
        setDeviceStatus("Camera unavailable ✗");
        setPreWarning("Camera access was lost or denied. Allow camera access and reload the exam.");
        void reportViolationRef.current("camera_unavailable", 100);
      });

    return () => {
      cancelled = true;
      if (snapshotInterval) clearInterval(snapshotInterval);
      if (objectModelSlowTimer) clearTimeout(objectModelSlowTimer);
      if (faceDetectionInterval) clearInterval(faceDetectionInterval);
      if (audioInterval) clearInterval(audioInterval);
      if (audioResumeListener) window.removeEventListener("pointerdown", audioResumeListener);
      if (audioContext) audioContext.close().catch(() => {});
      disposeLoadedModels();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      if (desktopVideoElement) desktopVideoElement.srcObject = null;
      if (mobileVideoElement) mobileVideoElement.srcObject = null;
    };
  }, [hasStarted, isMobile, quiz?.teacherId, quiz?.title, quizId, studentQuizId, notifyTeacherJoined, captureSnapshot]);

  // ── Timer Countdown ──
  useEffect(() => {
    if (!hasStarted) return;
    const timer = setInterval(() => {
      setTimeLeft((prev: number) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [hasStarted]);

  // ── Auto Submit on Time Up ──
  useEffect(() => {
    if (timeLeft > 0) {
      autoSubmitAttemptedRef.current = false;
      return;
    }
    if (hasStarted && !isSubmitting && !autoSubmitAttemptedRef.current) {
      autoSubmitAttemptedRef.current = true;
      void submitQuiz();
    }
  }, [hasStarted, timeLeft, isSubmitting, submitQuiz]);

  // ── Fullscreen & Anti-Cheat Lockdown ──
  useEffect(() => {
    if (!hasStarted) return;

    isStartupGracePeriodRef.current = true;
    const graceTimer = setTimeout(() => {
      isStartupGracePeriodRef.current = false;
    }, 5000);

    const requestFS = async () => {
      if (monitoringLevel !== "strict") return;
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
          fullscreenMonitoringRef.current = Boolean(document.fullscreenElement);
        }
      } catch {}
    };
    requestFS();

    // ── Incident State Machine for Tab/Focus Loss & Fullscreen (Using Component Refs) ──
    let lastShortcutReportAt = 0;

    const beginAway = (graceMs = 1500) => {
      if (!examActiveRef.current || isStartupGracePeriodRef.current || violationCountRef.current >= 3 || submissionInFlightRef.current) return;

      if (awayViolationRecordedRef.current) {
        // Continuous incident already penalized once, do not spam or add more strikes
        return;
      }

      if (!awayIncidentActiveRef.current) {
        awayIncidentActiveRef.current = true;
        setPreWarning("⚠️ Warning: Return to the exam. Leaving or minimizing the exam window is prohibited.");
      }

      if (!awayGraceTimerRef.current) {
        awayGraceTimerRef.current = setTimeout(async () => {
          awayGraceTimerRef.current = null;
          if (!examActiveRef.current || violationCountRef.current >= 3 || submissionInFlightRef.current) return;
          const isStillAway = typeof document !== "undefined" && (document.visibilityState === "hidden" || document.hidden);
          if (isStillAway && !awayViolationRecordedRef.current) {
            awayViolationRecordedRef.current = true;
            await reportViolationRef.current("tab_switch", 100);
          }
        }, graceMs);
      }
    };

    const endAway = () => {
      if (awayGraceTimerRef.current) {
        clearTimeout(awayGraceTimerRef.current);
        awayGraceTimerRef.current = null;
      }
      // Reset continuous incident state when student returns to exam
      awayIncidentActiveRef.current = false;
      awayViolationRecordedRef.current = false;
      if (!fullscreenIncidentActiveRef.current) {
        setPreWarning(null);
      }

      // Resume video playback if it paused during mobile backgrounding
      const activeVideo = isMobile ? mobileVideoRef.current : videoRef.current;
      if (activeVideo && activeVideo.paused && mediaStreamRef.current?.active) {
        activeVideo.play().catch(() => {});
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" || document.hidden) {
        beginAway(1500);
      } else {
        endAway();
      }
    };

    const handleWindowBlur = () => {
      beginAway(isMobile ? 1200 : 1800);
    };

    const handleWindowFocus = () => {
      endAway();
    };

    const handlePageHide = () => {
      beginAway(400);
    };

    const handlePageShow = () => {
      endAway();
    };

    const handleFullscreenChange = () => {
      if (monitoringLevel !== "strict" && !fullscreenMonitoringRef.current) return;
      if (!examActiveRef.current || isStartupGracePeriodRef.current || violationCountRef.current >= 3 || submissionInFlightRef.current) return;

      const fsElement = document.fullscreenElement || (document as any).webkitFullscreenElement;
      if (!fsElement) {
        if (!fullscreenIncidentActiveRef.current) {
          fullscreenIncidentActiveRef.current = true;
          setPreWarning("⚠️ Warning: Exiting full screen is prohibited. Please re-enter full screen.");
        }

        if (fullscreenViolationRecordedRef.current) return;

        if (!fullscreenGraceTimerRef.current) {
          fullscreenGraceTimerRef.current = setTimeout(async () => {
            fullscreenGraceTimerRef.current = null;
            const currentFs = document.fullscreenElement || (document as any).webkitFullscreenElement;
            if (!currentFs && !fullscreenViolationRecordedRef.current && violationCountRef.current < 3 && examActiveRef.current) {
              fullscreenViolationRecordedRef.current = true;
              await reportViolationRef.current("fullscreen_exit", 100);
            }
          }, 1500);
        }
      } else {
        if (fullscreenGraceTimerRef.current) {
          clearTimeout(fullscreenGraceTimerRef.current);
          fullscreenGraceTimerRef.current = null;
        }
        fullscreenIncidentActiveRef.current = false;
        fullscreenViolationRecordedRef.current = false;
        if (!awayIncidentActiveRef.current) {
          setPreWarning(null);
        }
      }
    };

    // Mobile render watchdog fallback
    let lastRenderedFrameAt = performance.now();
    let stalledRenderChecks = 0;
    let renderFrameId = 0;
    const trackRenderedFrame = (timestamp: number) => {
      lastRenderedFrameAt = timestamp;
      renderFrameId = window.requestAnimationFrame(trackRenderedFrame);
    };
    renderFrameId = window.requestAnimationFrame(trackRenderedFrame);
    const renderWatchdog = window.setInterval(() => {
      if (
        !isMobile
        || !examActiveRef.current
        || isStartupGracePeriodRef.current
        || violationCountRef.current >= 3
        || awayIncidentActiveRef.current
      ) {
        stalledRenderChecks = 0;
        return;
      }

      const renderGap = performance.now() - lastRenderedFrameAt;
      stalledRenderChecks = renderGap >= 1_800 ? stalledRenderChecks + 1 : 0;
      if (stalledRenderChecks >= 2) {
        stalledRenderChecks = 0;
        beginAway(0);
      }
    }, 750);

    const handleClipboard = (e: ClipboardEvent) => {
      e.preventDefault();
      if (examActiveRef.current && !isStartupGracePeriodRef.current) void reportViolationRef.current("clipboard_attempt", 100);
    };
    const preventContextMenu = (e: MouseEvent) => { e.preventDefault(); };
    const preventShortcuts = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const modifier = e.ctrlKey || e.metaKey;
      const screenshotOrCapture = isScreenshotShortcut(e) || (modifier && (key === "p" || key === "s"));
      const clipboardShortcut = modifier && (key === "c" || key === "v" || key === "x");
      const developerShortcut = e.key === "F12" || (modifier && e.shiftKey && (key === "i" || key === "j"));
      if (!screenshotOrCapture && !clipboardShortcut && !developerShortcut) return;

      e.preventDefault();
      if (!examActiveRef.current || isStartupGracePeriodRef.current || Date.now() - lastShortcutReportAt < 1_000) return;
      lastShortcutReportAt = Date.now();
      const violationType = developerShortcut
        ? "developer_tools"
        : clipboardShortcut
          ? "clipboard_attempt"
          : "attempted_screenshot";
      void reportViolationRef.current(violationType, 100);
    };

    const handleBeforePrint = () => {
      if (examActiveRef.current && !isStartupGracePeriodRef.current) void reportViolationRef.current("attempted_screenshot", 100);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("freeze", handlePageHide);
    document.addEventListener("resume", handlePageShow);
    window.addEventListener("beforeprint", handleBeforePrint);
    document.addEventListener("copy", handleClipboard);
    document.addEventListener("cut", handleClipboard);
    document.addEventListener("paste", handleClipboard);
    document.addEventListener("contextmenu", preventContextMenu);
    document.addEventListener("keydown", preventShortcuts);
    document.addEventListener("keyup", preventShortcuts);

    return () => {
      if (graceTimer) clearTimeout(graceTimer);
      if (awayGraceTimerRef.current) {
        clearTimeout(awayGraceTimerRef.current);
        awayGraceTimerRef.current = null;
      }
      if (fullscreenGraceTimerRef.current) {
        clearTimeout(fullscreenGraceTimerRef.current);
        fullscreenGraceTimerRef.current = null;
      }
      window.cancelAnimationFrame(renderFrameId);
      window.clearInterval(renderWatchdog);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("freeze", handlePageHide);
      document.removeEventListener("resume", handlePageShow);
      window.removeEventListener("beforeprint", handleBeforePrint);
      document.removeEventListener("copy", handleClipboard);
      document.removeEventListener("cut", handleClipboard);
      document.removeEventListener("paste", handleClipboard);
      document.removeEventListener("contextmenu", preventContextMenu);
      document.removeEventListener("keydown", preventShortcuts);
      document.removeEventListener("keyup", preventShortcuts);
    };
  }, [hasStarted, isMobile, monitoringLevel, reportViolation]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // ─── POST-QUIZ PROCTORSHIELD CELEBRATORY PODIUM SCREEN ────────────────
  if (quizSubmittedResult) {
    const resultInvalidated = quizSubmittedResult.integrityInvalidated
      || quizSubmittedResult.aiVerdict === "cheated"
      || quizSubmittedResult.violations >= 3;
    const resultFlagged = !resultInvalidated && quizSubmittedResult.violations > 0;
    return (
      <div className="exam-shell relative flex min-h-screen items-center justify-center overflow-x-hidden overflow-y-auto bg-[#0d0f18] p-3 text-white sm:p-4">
        {/* Glow backdrop */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-indigo-600/20 via-violet-600/20 to-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 my-auto w-full max-w-xl space-y-5 rounded-3xl border border-[#2b3252] bg-[#141726]/90 p-5 text-center shadow-2xl backdrop-blur-xl animate-fade-in sm:space-y-6 sm:p-8">
          {/* Trophy & Podium */}
          <div className="relative inline-block mx-auto">
            <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mx-auto shadow-xl animate-bounce ${
              resultInvalidated
                ? "bg-gradient-to-tr from-rose-600 to-red-500 shadow-rose-500/30"
                : "bg-gradient-to-tr from-amber-400 to-amber-600 shadow-amber-500/30"
            }`}>
              {resultInvalidated
                ? <AlertTriangle className="w-10 h-10 text-white" />
                : <Trophy className="w-10 h-10 text-white" />}
            </div>
            <span className={`absolute -bottom-2 -right-2 px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wider uppercase shadow-md ${
              resultInvalidated ? "bg-rose-500 text-white" : "bg-emerald-500 text-slate-950"
            }`}>
              {resultInvalidated ? "INVALIDATED" : "SUBMITTED"}
            </span>
          </div>

          <div>
            <h1 className="text-3xl font-black tracking-tight text-white font-[family-name:var(--font-display)]">
              {resultInvalidated ? "Cheating Detected" : "Assessment Completed!"}
            </h1>
            <p className="text-sm text-slate-400 mt-1 font-medium">
              {resultInvalidated
                ? "Three-strike integrity limit reached — academic score not recorded"
                : "Academic Integrity and Exam Record Saved"}
            </p>
          </div>

          {/* Academic Exam Stats Grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="bg-[#1b2038] border border-[#2e375e] p-3.5 rounded-2xl">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Exam Score</div>
              <div className="text-xl font-black text-amber-400 mt-1 flex items-center justify-center gap-1">
                <Award className="w-4 h-4 text-amber-400" /> {quizSubmittedResult.score !== null ? `${quizSubmittedResult.score}%` : "Recorded"}
              </div>
            </div>

            <div className="bg-[#1b2038] border border-[#2e375e] p-3.5 rounded-2xl">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Questions Completed</div>
              <div className="text-xl font-black text-indigo-400 mt-1 flex items-center justify-center gap-1">
                <CheckCircle className="w-4 h-4 text-indigo-400" /> {questions.length}
              </div>
            </div>

            <div className="bg-[#1b2038] border border-[#2e375e] p-3.5 rounded-2xl">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Integrity Score</div>
              <div className={`max-w-full break-words text-lg font-black leading-tight mt-1 sm:text-xl ${
                resultInvalidated ? "text-rose-400" : resultFlagged ? "text-amber-400" : "text-emerald-400"
              }`}>
                {resultInvalidated ? "CHEATED" : resultFlagged ? "REVIEW" : "100%"}
              </div>
            </div>
          </div>

          {/* Guardian Trust Shield Banner */}
          <div className={`flex min-w-0 items-start gap-3 rounded-2xl border p-4 text-left sm:items-center ${
            resultInvalidated
              ? "bg-rose-500/10 border-rose-500/30"
              : resultFlagged
                ? "bg-amber-500/10 border-amber-500/30"
                : "bg-emerald-500/10 border-emerald-500/30"
          }`}>
            {resultInvalidated
              ? <AlertTriangle className="w-8 h-8 text-rose-400 shrink-0" />
              : <ShieldCheck className={`w-8 h-8 shrink-0 ${resultFlagged ? "text-amber-400" : "text-emerald-400"}`} />}
            <div>
              <h4 className={`text-xs font-bold ${
                resultInvalidated ? "text-rose-400" : resultFlagged ? "text-amber-400" : "text-emerald-400"
              }`}>
                {resultInvalidated
                  ? "Result Invalidated"
                  : resultFlagged
                    ? "Submission Flagged for Review"
                    : "Guardian Verified Submission"}
              </h4>
              <p className="text-[11px] text-slate-300">
                {resultInvalidated
                  ? `This attempt is recorded as cheated after ${quizSubmittedResult.violations} integrity violations. Its academic score is not counted.`
                  : quizSubmittedResult.violations === 0
                  ? "Zero violations recorded. Your exam was submitted with 100% verified integrity."
                  : `Exam proctoring completed with ${quizSubmittedResult.violations} flag(s) and requires instructor review.`}
              </p>
            </div>
          </div>

          {/* EXP Earned Banner (Student Progression) */}
          {!resultInvalidated && (quizSubmittedResult.expEarned ?? 100) > 0 && (
            <div className={`p-4 rounded-2xl border text-left flex items-center justify-between gap-3 ${
              quizSubmittedResult.isTopOne
                ? "bg-gradient-to-r from-amber-500/20 via-yellow-500/15 to-amber-600/20 border-amber-400/50 shadow-lg shadow-amber-500/10"
                : "bg-indigo-500/15 border-indigo-500/30"
            }`}>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-2xl shrink-0">
                  {quizSubmittedResult.isTopOne ? "🥇" : "⚡"}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase text-indigo-400">
                      {quizSubmittedResult.isTopOne ? "Top 1 Leaderboard Champion!" : "Student Progression"}
                    </span>
                    {quizSubmittedResult.isTopOne && (
                      <span className="text-[10px] font-black bg-amber-400 text-slate-950 px-2 py-0.2 rounded-full">
                        HONOR ROLL
                      </span>
                    )}
                  </div>
                  <div className="text-base font-black text-white mt-0.5">
                    +{quizSubmittedResult.expEarned ?? 100} EXP Earned!
                  </div>
                  <div className="text-[11px] text-slate-300">
                    Your EXP and Level are securely saved to your student profile.
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => router.push("/join/avatar-shop")}
                className="px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white shadow-md transition-all active:scale-95 shrink-0 cursor-pointer"
              >
                Avatar Look 🎨
              </button>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={() => router.push("/join/avatar-shop")}
              className="flex-1 py-3.5 px-4 rounded-xl font-bold text-xs uppercase tracking-wider bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>🎨 Customize Avatar</span>
            </button>
            <button
              onClick={() => router.push("/dashboard/student")}
              className="flex-1 py-3.5 px-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Back to Dashboard</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── PRE-START SCREEN ────────────────────────────
  if (!hasStarted) {
    return (
      <div className="exam-shell min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="bg-[#111] p-8 rounded-2xl border border-gray-800 max-w-lg w-full text-center">
          {isMobile && (
            <div className="mb-4 flex items-start gap-3 bg-violet-500/10 border border-violet-500/30 rounded-xl px-4 py-3 text-left">
              <Smartphone className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-violet-300">Mobile Compatible Mode</p>
                <p className="text-xs text-violet-200/70 mt-0.5">Front-camera and app-switch monitoring are enabled. Mobile screenshot and fullscreen enforcement are not guaranteed, so your teacher will see Reduced Assurance.</p>
              </div>
            </div>
          )}
          {!loadingQuiz && !quizError && !["completed", "rejected", "pending_retake"].includes(studentQuizStatus) && (
          <div className="mb-6 rounded-xl border border-gray-800 bg-[#171717] p-4 text-left space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {isMobile ? <Smartphone className="w-4 h-4 text-violet-400" /> : <Monitor className="w-4 h-4 text-blue-400" />}
                <span className="text-xs font-bold text-white">Device & Camera Check</span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                preflightPassed ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
              }`}>
                {preflightPassed ? monitoringLabel(monitoringLevel) : "Required"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
              <span className={deviceCapabilities?.secureContext ? "text-emerald-400" : "text-rose-400"}>
                {deviceCapabilities?.secureContext ? "✓ Secure HTTPS" : "✕ HTTPS required"}
              </span>
              <span className={deviceCapabilities?.cameraPermission ? "text-emerald-400" : "text-slate-400"}>
                {deviceCapabilities?.cameraPermission ? "✓ Camera allowed" : "○ Camera not tested"}
              </span>
              <span className={deviceCapabilities?.microphonePermission ? "text-emerald-400" : "text-slate-400"}>
                {deviceCapabilities?.microphonePermission ? "✓ Microphone allowed" : "○ Microphone not tested"}
              </span>
              <span className={deviceCapabilities?.mediaRecorderSupported ? "text-emerald-400" : "text-rose-400"}>
                {deviceCapabilities?.mediaRecorderSupported ? "✓ 3–5s video evidence" : "✕ Video evidence unavailable"}
              </span>
              <span className={deviceCapabilities?.visibilitySupported ? "text-emerald-400" : "text-rose-400"}>
                {deviceCapabilities?.visibilitySupported ? "✓ App-switch checks" : "✕ App-switch unavailable"}
              </span>
            </div>
            {deviceCheckError && <p role="alert" className="text-[11px] font-semibold text-rose-400">{deviceCheckError}</p>}
            <button
              type="button"
              onClick={() => void runDevicePreflight()}
              disabled={isCheckingDevice}
              className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors disabled:opacity-60"
            >
              {isCheckingDevice ? "Testing camera and microphone..." : preflightPassed ? "Run Device Check Again" : "Test Camera & Device"}
            </button>
          </div>
          )}
          {loadingQuiz ? (
            <div className="py-20 text-gray-400">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p>Loading quiz configuration...</p>
            </div>
          ) : quizError ? (
            <div className="py-10 text-red-400 space-y-4">
              <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
              <p className="font-bold text-lg">Failed to Load Quiz</p>
              <p className="text-sm">{quizError}</p>
              <button
                onClick={() => router.push("/dashboard/student")}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all"
              >
                Go Back to Dashboard
              </button>
            </div>
          ) : (
            <>
              <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Camera className="w-8 h-8 text-indigo-500" />
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">{quiz?.title || "Proctoring Initialization"}</h1>
              <p className="text-indigo-400 font-semibold mb-2">{quiz?.subject?.subjectName}</p>
              
              {/* Examination Mode Badge */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs font-bold mb-4">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> ProctorShield Monitored Examination
              </div>

              <p className="text-gray-400 mb-6 text-sm leading-relaxed">
                {quiz?.description || "This quiz is monitored by ProctorShield AI. Your camera and screen activity will be recorded and analyzed in real-time."}
              </p>
              <div className="space-y-2.5 text-left mb-8 bg-[#1a1a1a] p-4 rounded-xl text-xs text-gray-300">
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Do not leave the browser window or switch tabs.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Copying and pasting are prohibited. Mobile screenshots cannot be reliably detected.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Cellphones and other devices are not allowed in the frame.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Keep your face visible and facing the screen at all times.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> {isMobile ? "Keep the exam visible and do not switch apps." : "The quiz will enter fullscreen mode automatically."}</p>
                <p className="flex items-center gap-2 text-red-400 mt-3 pt-3 border-t border-gray-800"><AlertTriangle className="w-4 h-4 shrink-0" /> Quiz will auto-terminate after 3 violations.</p>
              </div>

              {/* LOBBY / WAITING FOR TEACHER STATUS */}
              {studentQuizStatus === "pending_approval" ? (
                <div className="space-y-3.5 animate-fade-in">
                  <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex flex-col items-center justify-center text-center space-y-2">
                    <p className="text-sm font-bold text-amber-300">Late Entry Approval Pending</p>
                    <p className="text-xs text-slate-400">Waiting for teacher approval to join this in-progress quiz.</p>
                  </div>
                  <button disabled className="w-full py-3.5 bg-amber-600/50 text-white font-bold rounded-xl flex items-center justify-center gap-2 opacity-80 cursor-not-allowed">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Waiting for Teacher Approval...
                  </button>
                </div>
              ) : studentQuizStatus === "rejected" ? (
                <div className="space-y-3.5 animate-fade-in">
                  <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-center">
                    <p className="text-sm font-bold text-rose-300">Late Entry Request Rejected</p>
                    <p className="text-xs text-slate-400 mt-1">Your teacher did not approve entry to this quiz.</p>
                  </div>
                  <button onClick={() => router.push("/dashboard/student/quizzes")} className="w-full py-3.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-colors">
                    Return to My Quizzes
                  </button>
                </div>
              ) : studentQuizStatus === "completed" ? (
                <div className="space-y-3.5 animate-fade-in">
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-center">
                    <p className="text-sm font-bold text-emerald-300">Quiz Already Completed</p>
                    <p className="text-xs text-slate-400 mt-1">This attempt has already been submitted.</p>
                  </div>
                  <button onClick={() => router.push("/dashboard/student/results")} className="w-full py-3.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-colors">
                    View My Results
                  </button>
                </div>
              ) : !canEnterQuiz ? (
                <div className="space-y-3.5 animate-fade-in">
                  <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex flex-col items-center justify-center text-center space-y-2.5">
                    <div className="relative flex items-center justify-center my-1">
                      <span className="w-9 h-9 rounded-full bg-amber-500/20 animate-ping absolute" />
                      <span className="w-7 h-7 rounded-full bg-amber-500/30 border border-amber-400 flex items-center justify-center text-amber-300 text-sm font-bold relative z-10">
                        ⏳
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-amber-300">Waiting for Teacher to Start the Quiz...</p>
                      <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                        You are in the exam lobby. Please remain on this screen. The session will automatically unlock the moment your teacher starts it.
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-[11px] font-bold text-amber-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Live Lobby Active
                    </div>
                  </div>

                  <button disabled className="w-full py-3.5 bg-gray-800/80 text-gray-400 font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 cursor-not-allowed border border-gray-700">
                    <Clock className="w-4 h-4 animate-spin text-amber-400" />
                    Waiting for Teacher to Start...
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {lobbyError && <p role="alert" className="text-xs font-semibold text-rose-400">{lobbyError}</p>}
                  <button
                    onClick={handleEnterQuiz}
                    disabled={isEnteringQuiz}
                    className="w-full py-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:opacity-95 text-white font-black text-sm rounded-xl transition-all shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer animate-fade-in disabled:opacity-60 disabled:cursor-wait"
                  >
                    {isEnteringQuiz ? (
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4 text-amber-300" />
                    )}
                    {isEnteringQuiz ? "Verifying Start Status..." : preflightPassed ? "I Understand, Start Quiz" : "Check Device & Start Quiz"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── ACTIVE EXAM ROOM (WITH PROCTORSHIELD GAMIFICATION) ────────────
  const answeredCount = Object.keys(answersState).length;
  const progressPercent = questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;
  const currentQuestion = questions[currentQuestionIndex];

  return (
    <div className="exam-shell min-h-screen bg-[#0b0d17] text-white flex flex-col font-sans select-none overflow-x-hidden">
      {/* Security Warning Modal */}
      {teacherWarningModal.show && !warningModal.show && (
        <div className="app-modal-backdrop bg-black/80 backdrop-blur-md">
          <div className="app-modal-panel bg-[#151928] border-2 border-amber-500/80 rounded-3xl p-5 max-w-md text-center shadow-2xl shadow-amber-500/20 animate-fade-in space-y-4 overflow-y-auto sm:p-6">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-black text-white font-[family-name:var(--font-display)]">
              LIVE WARNING FROM YOUR TEACHER
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              {teacherWarningModal.message}
            </p>
            <button
              type="button"
              onClick={() => {
                setTeacherWarningModal({ show: false, message: "" });
                setPreWarning(null);
              }}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-md cursor-pointer"
            >
              I Understand & Continue
            </button>
          </div>
        </div>
      )}

      {/* Automated proctoring violation modal */}
      {warningModal.show && (
        <div className="app-modal-backdrop bg-black/80 backdrop-blur-md">
          <div className="app-modal-panel bg-[#151928] border-2 border-red-500/80 rounded-3xl p-5 max-w-md text-center shadow-2xl shadow-red-500/20 animate-fade-in space-y-4 overflow-y-auto sm:p-6">
            <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto text-red-500">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-black text-white font-[family-name:var(--font-display)]">
              {warningModal.isFinal ? "3-STRIKE VIOLATION LIMIT REACHED" : "SECURITY PROCTORING ALERT"}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              {warningModal.message}
            </p>
            {!warningModal.isFinal && (
              <button
                onClick={() => {
                  setWarningModal({ show: false, message: "", isFinal: false });
                  isAlertingRef.current = false;
                  if (fullscreenMonitoringRef.current && !document.fullscreenElement) {
                    void document.documentElement.requestFullscreen().catch(() => {});
                  }
                }}
                className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl transition-all shadow-md cursor-pointer"
              >
                I Understand & Continue
              </button>
            )}
          </div>
        </div>
      )}

      {/* Pre-Warning Banner */}
      {preWarning && (
        <div className="bg-amber-500 text-slate-950 px-4 py-2 text-center text-xs font-black tracking-wide shrink-0 animate-pulse flex items-center justify-center gap-2 shadow-md">
          <AlertTriangle className="w-4 h-4" />
          <span>{preWarning}</span>
        </div>
      )}

      {/* TOP HEADER WITH EXAM STATUS HUD */}
      <header className="py-2.5 px-3 sm:px-4 lg:px-8 bg-[#131627] border-b border-[#242a42] flex flex-wrap items-center justify-between shrink-0 shadow-md gap-2 sm:gap-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <h1 className="text-base lg:text-xl font-black text-white tracking-tight font-[family-name:var(--font-display)] truncate max-w-[180px] sm:max-w-none">
            {quiz?.title || "Proctored Exam"}
          </h1>

          {/* Sound Toggle */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-1.5 rounded-lg bg-[#1c2138] border border-[#2d3558] text-slate-400 hover:text-white transition-colors cursor-pointer"
            title={soundEnabled ? "Mute Sound Effects" : "Enable Sound Effects"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>

        {/* Proctored HUD Indicators */}
        <div className="flex w-full sm:w-auto items-center justify-between sm:justify-end gap-1.5 sm:gap-2 lg:gap-4">
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[10px] font-bold ${
            isOnline
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : "bg-rose-500/10 border-rose-500/30 text-rose-400"
          }`}>
            {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {isOnline ? "Online" : "Offline — answers kept here"}
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-[10px] font-bold">
            <Save className="w-3.5 h-3.5" />
            {autosaveStatus === "saving" ? "Saving..." : autosaveStatus === "saved" ? "Saved" : autosaveStatus === "error" ? "Save retrying" : autosaveStatus === "offline" ? "Saved on device" : "Autosave ready"}
          </div>
          <div className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[10px] font-bold ${
            monitoringLevel === "strict"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : "bg-violet-500/10 border-violet-500/30 text-violet-300"
          }`}>
            {isMobile ? <Smartphone className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
            {monitoringLabel(monitoringLevel)}
          </div>

          {/* Exam Timer */}
          <div className="px-3 sm:px-4 py-1.5 rounded-xl text-sm sm:text-base font-bold font-mono shadow-md border bg-[#1c2138] border-[#2e375e] text-amber-400">
            {formatTime(timeLeft)}
          </div>

          {/* Submit Exam Button */}
          <button
            onClick={submitQuiz}
            disabled={isSubmitting || loadingQuiz || !!quizError || !isOnline}
            className="hidden lg:block px-4 py-2 bg-gradient-to-r from-red-900/80 to-rose-900/80 border border-rose-600/50 hover:bg-rose-800 text-rose-100 font-black text-xs rounded-xl transition-all shadow-md disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? "Submitting..." : isOnline ? "Submit Exam" : "Waiting for connection"}
          </button>
        </div>
      </header>

      {/* Exam Question Progress Bar */}
      <div className="w-full h-1.5 bg-[#181c30] overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-emerald-400 transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Hidden canvas for background snapshots */}
      <canvas ref={canvasRef} className="hidden" />

      {/* MAIN EXAM LAYOUT */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden p-3 pb-28 lg:p-6 gap-4 lg:gap-6 max-h-none lg:max-h-[calc(100vh-80px)] transition-all">
        
        {/* MOBILE PROCTORING BAR */}
        <div className="block lg:hidden bg-[#141724] border border-[#212638] rounded-2xl p-3 space-y-3 shrink-0 shadow-md">
          <div className="flex items-center justify-between gap-3">
            <div className="w-28 h-20 bg-black rounded-xl overflow-hidden relative border border-emerald-500/40 shrink-0">
              <video ref={mobileVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/80 rounded text-[8px] font-bold text-emerald-400">
                LIVE AI
              </div>
            </div>
            <div className="flex-1 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-semibold">AI Engine:</span>
                <span className={`font-bold ${aiStatus.includes("Active") ? "text-emerald-400" : "text-amber-400"}`}>
                  {aiStatus}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-semibold">Face AI:</span>
                <span className={`font-bold ${faceStatus.includes("✓") ? "text-emerald-400" : "text-red-400"}`}>
                  {faceStatus}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-semibold">Gaze:</span>
                <span className={`font-bold ${gazeStatus.includes("✓") ? "text-emerald-400" : "text-red-400"}`}>
                  {gazeStatus.includes("✓") ? "Focused ✓" : "Away ✗"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400 font-semibold">Device:</span>
                <span className={`max-w-[9rem] truncate text-right font-bold ${deviceStatus.includes("✓") ? "text-emerald-400" : deviceStatus.includes("Loading") ? "text-amber-400" : "text-red-400"}`}>
                  {deviceStatus}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400 font-semibold">Audio:</span>
                <span className={`max-w-[9rem] truncate text-right font-bold ${audioStatus.includes("Active") ? "text-emerald-400" : "text-amber-400"}`}>
                  {audioStatus}{audioStatus.includes("Active") ? ` · ${audioLevel}%` : ""}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-semibold">Violations:</span>
                <span className={`font-bold ${violationCount > 0 ? "text-red-400 font-black" : "text-emerald-400"}`}>
                  {violationCount}/3 ⚠
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-semibold">Assurance:</span>
                <span className="font-bold text-violet-300">{monitoringLabel(monitoringLevel)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* DESKTOP SIDE PANEL (Webcam, Gaze Radar, AI Diagnostics) */}
        <div className="hidden lg:flex w-80 flex-col gap-4 overflow-y-auto shrink-0 pr-1">
          
          {/* Webcam Card */}
          <div className="bg-[#141726] border-2 border-emerald-500/50 rounded-2xl p-2 relative aspect-[4/3] w-full flex items-center justify-center shadow-lg overflow-hidden shrink-0">
            {!cameraActive && <p className="text-xs text-slate-400 animate-pulse">Initializing Camera...</p>}
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover rounded-xl" />
            <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1 bg-black/80 backdrop-blur-sm rounded-full text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Live AI Proctored
            </div>
          </div>

          {/* Gaze Radar */}
          <div className="bg-[#141726] border border-[#242a42] rounded-2xl p-4 flex flex-col items-center justify-center relative shadow-md">
            <div className="w-full text-left text-[11px] font-extrabold text-slate-400 uppercase tracking-widest mb-1">
              HEAD DIRECTION
            </div>
            <div className="relative w-36 h-36 rounded-full border border-emerald-500/30 bg-[#0a0c14] flex items-center justify-center my-2 shadow-inner">
              <div className="absolute w-24 h-24 rounded-full border border-emerald-500/20" />
              <div className="absolute w-12 h-12 rounded-full border border-emerald-500/20" />
              <div className="absolute w-full h-[1px] bg-emerald-500/20" />
              <div className="absolute h-full w-[1px] bg-emerald-500/20" />
              <div
                className={`absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow-[0_0_12px_rgba(52,211,153,0.9)] transition-all duration-150 transform -translate-x-1/2 -translate-y-1/2 ${
                  gazeStatus.includes("✓") ? "bg-emerald-400" : "bg-red-500 animate-pulse"
                }`}
                style={{ left: `${headPos.x}%`, top: `${headPos.y}%` }}
              />
            </div>
            <span className={`text-xs font-bold ${gazeStatus.includes("✓") ? "text-emerald-400" : "text-red-400 font-extrabold"}`}>
              {gazeStatus.includes("✓") ? "CENTER ✓" : gazeStatus.toUpperCase()}
            </span>
          </div>

          {/* Status Indicators */}
          <div className="bg-[#141726] border border-[#242a42] rounded-2xl p-4 space-y-3 shadow-md">
            <div className="w-full text-left text-[11px] font-extrabold text-slate-400 uppercase tracking-widest mb-2">
              PROCTOR DIAGNOSTICS
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Face Detection</span>
              <span className={`font-bold ${faceStatus.includes("✓") ? "text-emerald-400" : "text-red-400"}`}>{faceStatus}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Head Pose</span>
              <span className={`font-bold ${gazeStatus.includes("✓") ? "text-emerald-400" : "text-red-400"}`}>
                {gazeStatus.includes("✓") ? "Forward ✓" : "Diverted ✗"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="text-slate-400 font-medium">Object Check</span>
              <span className={`max-w-[10rem] truncate text-right font-bold ${deviceStatus.includes("✓") ? "text-emerald-400" : deviceStatus.includes("Loading") ? "text-amber-400" : "text-red-400"}`}>
                {deviceStatus}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="text-slate-400 font-medium">Ambient Audio</span>
              <span className={`max-w-[10rem] truncate text-right font-bold ${audioStatus.includes("Active") ? "text-emerald-400" : "text-amber-400"}`}>
                {audioStatus}{audioStatus.includes("Active") ? ` · ${audioLevel}%` : ""}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Lockdown</span>
              <span className="font-bold text-emerald-400">{isMobile ? "App-Switch Guard" : "Strict Fullscreen"}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Assurance</span>
              <span className="font-bold text-violet-300">{monitoringLabel(monitoringLevel)}</span>
            </div>
          </div>

          {/* Strike Counter Card */}
          <div className="bg-[#141726] border border-[#242a42] rounded-2xl p-4 shadow-md">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-white uppercase tracking-wider">Security Strikes</span>
              <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                violationCount > 0 ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"
              }`}>
                {violationCount}/3 Violations
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              {[1, 2, 3].map((num) => (
                <div
                  key={num}
                  className={`h-12 rounded-xl border flex items-center justify-center text-base font-black transition-all ${
                    num <= violationCount
                      ? "bg-red-600/90 border-red-500 text-white shadow-lg shadow-red-600/30 animate-pulse"
                      : "bg-[#1b2035] border-[#293150] text-slate-500"
                  }`}
                >
                  {num}
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* QUESTIONS STACK */}
        <div className="w-full flex-1 flex flex-col gap-4 overflow-hidden">

          {/* QUESTIONS LIST */}
          <div className="flex-1 bg-[#141726] border border-[#242a42] rounded-2xl p-4 lg:p-6 overflow-y-auto shadow-lg space-y-6">
            {loadingQuiz ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
                <p>Loading questions...</p>
              </div>
            ) : questions.length === 0 ? (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-6 text-center text-amber-500">
                <p className="font-bold text-lg mb-2">No Questions Available</p>
                <p>No questions have been configured for this assessment.</p>
              </div>
            ) : currentQuestion ? (
              <div key={currentQuestion.id} className="bg-[#1b2038] border border-[#2e375e] rounded-2xl p-4 sm:p-6 shadow-md space-y-4">
                <div className="flex items-center justify-between gap-3 text-[11px] sm:text-xs font-bold text-indigo-400 uppercase tracking-wider">
                  <span>QUESTION {currentQuestionIndex + 1} OF {questions.length}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono shrink-0">
                    {currentQuestion.points || 1} PT
                  </span>
                </div>

                <h3 className="text-base sm:text-lg font-bold text-white leading-snug break-words">
                  {currentQuestion.questionText}
                </h3>

                {currentQuestion.questionType === "fill_in_blank" ? (
                  <form onSubmit={handleFillBlankSubmit} className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <span>✏️</span> Type your answer below:
                      </label>
                      <input
                        type="text"
                        disabled={Boolean(answerFeedback[currentQuestion.id]) || isCheckingAnswer}
                        value={fillBlankInput}
                        onChange={(e) => setFillBlankInput(e.target.value)}
                        placeholder="Type your answer here..."
                        autoFocus
                        className="w-full px-5 py-4 rounded-2xl bg-[#141728] border-2 border-[#283152] focus:border-indigo-500 focus:bg-[#1a1f36] text-white text-base sm:text-lg font-bold outline-none transition-all disabled:opacity-60"
                      />
                    </div>
                    {!answerFeedback[currentQuestion.id] && (
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={!fillBlankInput.trim() || isCheckingAnswer}
                          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:opacity-90 disabled:opacity-40 text-white font-black text-sm shadow-md transition-all cursor-pointer flex items-center gap-2"
                        >
                          Submit Answer ➔
                        </button>
                      </div>
                    )}
                  </form>
                ) : (
                  <div className="space-y-2.5 sm:space-y-3 pt-1 sm:pt-2">
                    {currentQuestion.choices.map((choice: any, choiceIndex: number) => {
                    const optionLetter = String.fromCharCode(65 + choiceIndex);
                    const feedback = answerFeedback[currentQuestion.id];
                    const isSelected = feedback?.choiceId === choice.id || answersState[currentQuestion.id] === choice.id;
                    const isLocked = Boolean(feedback) || isCheckingAnswer;
                    const selectedCorrect = isSelected && feedback?.isCorrect === true;
                    const selectedWrong = isSelected && feedback?.isCorrect === false;

                    return (
                      <button
                        type="button"
                        key={choice.id}
                        onClick={() => void handleSelectChoice(currentQuestion.id, choice.id, currentQuestionIndex)}
                        disabled={isLocked}
                        className={`w-full flex items-center gap-3 sm:gap-4 p-3 sm:p-3.5 rounded-xl border text-left transition-all disabled:cursor-not-allowed ${
                          selectedCorrect
                            ? "bg-emerald-500/20 border-emerald-400 shadow-md shadow-emerald-500/20"
                            : selectedWrong
                            ? "bg-rose-500/20 border-rose-400 shadow-md shadow-rose-500/20"
                            : isSelected
                            ? "bg-[#283158] border-indigo-500 shadow-md shadow-indigo-500/20"
                            : "bg-[#141728] border-[#283152] hover:bg-[#202746] hover:border-indigo-500/50"
                        }`}
                      >
                        <span
                          className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 transition-all ${
                            selectedCorrect
                              ? "bg-emerald-500 text-white"
                              : selectedWrong
                              ? "bg-rose-500 text-white"
                              : isSelected
                              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                              : "bg-[#222846] text-slate-400"
                          }`}
                        >
                          {optionLetter}
                        </span>
                        <span className={`min-w-0 break-words text-sm font-medium ${isSelected ? "text-white font-bold" : "text-slate-300"}`}>
                          {choice.choiceText}
                        </span>
                      </button>
                    );
                  })}
                </div>
                )}

                {answerFeedback[currentQuestion.id] && (
                  <div
                    role="status"
                    className={`rounded-xl border px-4 py-3 text-center text-sm font-black ${
                      answerFeedback[currentQuestion.id].isCorrect
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                        : "bg-rose-500/15 border-rose-500/40 text-rose-300"
                    }`}
                  >
                    {answerFeedback[currentQuestion.id].isCorrect ? "Correct!" : "Incorrect — answer recorded."}
                    <span className="block mt-1 text-[11px] font-semibold opacity-80">
                      {currentQuestionIndex === questions.length - 1 ? "Submitting your quiz..." : "Loading the next question..."}
                    </span>
                  </div>
                )}
              </div>
            ) : null}
          </div>

        </div>

      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#2d3558] bg-[#101322]/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-slate-400">
              <span>{answeredCount}/{questions.length} answered</span>
              <span>{Math.round(progressPercent)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#242a42]">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void submitQuiz()}
            disabled={isSubmitting || loadingQuiz || Boolean(quizError) || !isOnline}
            className="shrink-0 rounded-xl bg-gradient-to-r from-rose-700 to-red-600 px-4 py-3 text-xs font-black text-white shadow-lg disabled:opacity-50"
          >
            {isSubmitting ? "Submitting..." : "Submit Quiz"}
          </button>
        </div>
      </div>
    </div>
  );
}
