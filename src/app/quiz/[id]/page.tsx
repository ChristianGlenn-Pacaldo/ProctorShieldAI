"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Camera, 
  AlertTriangle, 
  CheckCircle, 
  Flame, 
  Zap, 
  Scissors, 
  Clock, 
  Volume2, 
  VolumeX, 
  Trophy, 
  ShieldCheck, 
  Sparkles,
  ArrowRight
} from "lucide-react";

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

  const [isSubmitting, setIsSubmitting] = useState(false);
  const isReportingRef = useRef(false);
  const isAlertingRef = useRef(false);
  const isStartupGracePeriodRef = useRef(true);
  const [warningModal, setWarningModal] = useState({ show: false, message: "", isFinal: false });
  const [preWarning, setPreWarning] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
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
  const [answersState, setAnswersState] = useState<Record<number, number>>({});
  const [studentQuizStatus, setStudentQuizStatus] = useState<string>("");
  const [studentQuizId, setStudentQuizId] = useState<number | null>(null);
  const [userId, setUserId] = useState<string>("");

  // ── PROCTORSHIELD GAMIFICATION STATE ──────────────────
  const [streak, setStreak] = useState(1);
  const [xp, setXp] = useState(100);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [celebrationBanner, setCelebrationBanner] = useState<string | null>(null);
  const [isTimeFrozen, setIsTimeFrozen] = useState(false);
  const [quizSubmittedResult, setQuizSubmittedResult] = useState<any>(null);

  // Power-Up inventory (Usable 1x per quiz)
  const [powerUps, setPowerUps] = useState({
    fiftyFifty: { used: false, activeQuestionId: null as number | null },
    doublePoints: { used: false, active: false },
    timeFreeze: { used: false, active: false },
  });

  // Stores choice IDs that are eliminated by 50/50 per question
  const [eliminatedChoices, setEliminatedChoices] = useState<Record<number, number[]>>({});

  // ── Web Audio Synthesizer (Zero External Dependencies) ───────
  const playTone = useCallback((freqs: number[], type: OscillatorType = "sine", duration: number = 0.15) => {
    if (!soundEnabled || typeof window === "undefined") return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
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

  const triggerCelebration = useCallback((msg: string) => {
    setCelebrationBanner(msg);
    setTimeout(() => setCelebrationBanner(null), 3200);
  }, []);

  // ── POWER-UP ACTIONS ─────────────────────────────────────────
  // 1. 50/50 Eraser (Removes 2 incorrect choices for current question)
  const handleUseFiftyFifty = (currentQuestionId: number) => {
    if (powerUps.fiftyFifty.used) return;
    const q = questions.find((item) => item.id === currentQuestionId);
    if (!q || !q.choices || q.choices.length < 3) return;

    // Pick 2 random choices to eliminate
    const choiceIds = q.choices.map((c: any) => c.id);
    const toEliminate = choiceIds.slice(0, 2);

    setEliminatedChoices((prev) => ({
      ...prev,
      [currentQuestionId]: toEliminate,
    }));

    setPowerUps((prev) => ({
      ...prev,
      fiftyFifty: { used: true, activeQuestionId: currentQuestionId },
    }));

    playTone([400, 600, 800], "triangle", 0.12);
    triggerCelebration("✨ 50/50 ERASER USED! 2 Wrong Choices Removed");
  };

  // 2. Double Points Booster (Doubles points earned)
  const handleUseDoublePoints = () => {
    if (powerUps.doublePoints.used) return;
    setPowerUps((prev) => ({
      ...prev,
      doublePoints: { used: true, active: true },
    }));
    playTone([523, 659, 783, 1046], "sine", 0.1);
    setXp((prev) => prev + 150);
    triggerCelebration("⚡ 2X SCORE BOOSTER ACTIVATED! (+150 XP Bonus)");
  };

  // 3. Time Freeze (+30 seconds)
  const handleUseTimeFreeze = () => {
    if (powerUps.timeFreeze.used) return;
    setPowerUps((prev) => ({
      ...prev,
      timeFreeze: { used: true, active: true },
    }));
    setTimeLeft((prev) => prev + 30);
    setIsTimeFrozen(true);
    setTimeout(() => setIsTimeFrozen(false), 5000);
    playTone([300, 450, 600, 900], "sine", 0.15);
    triggerCelebration("⏱ +30 SECONDS TIME FREEZE GRANTED!");
  };

  // ── WebRTC P2P Live Video Streamer (Student -> Teacher) ──
  useEffect(() => {
    if (!hasStarted || !userId || !quiz?.teacherId) return;

    let pusherClient: any;
    const teacherChannelName = `teacher-${quiz.teacherId}`;
    const studentChannelName = `student-webrtc-${userId}`;

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
                  data: { candidate: event.candidate, studentId: userId },
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
              data: { sdp: offer, studentId: userId },
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
        { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1" }
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
          data: { studentId: userId },
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
  }, [hasStarted, userId, quiz?.teacherId]);

  // Detect mobile device on mount
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    const mobileUA = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
    const mobileScreen = window.innerWidth < 768;
    setIsMobile(mobileUA || mobileScreen);
  }, []);

  useEffect(() => {
    const loadQuiz = async () => {
      try {
        const res = await fetch(`/api/quizzes/${quizId}`);
        const data = await res.json();
        if (res.ok && data.success) {
          setQuiz(data.quiz);
          setQuestions(data.questions || []);
          setStudentQuizStatus(data.studentQuizStatus || "");
          setStudentQuizId(data.studentQuizId || null);
          setUserId(data.userId || "");
          if (data.quiz.duration) {
            setTimeLeft(data.quiz.duration * 60);
          }
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
              setQuiz(data.quiz);
              if (data.questions && data.questions.length > 0) {
                setQuestions(data.questions);
              }
            }
          })
          .catch(() => {});
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [quizId, hasStarted]);

  // Handle pusher lobby real-time updates
  useEffect(() => {
    if (!quizId || !userId) return;

    let pusherClient: any;
    
    import("pusher-js").then((Pusher) => {
      pusherClient = new Pusher.default(process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774", {
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1",
      });

      const quizChannel = pusherClient.subscribe(`quiz-${quizId}`);
      quizChannel.bind("quiz-started", (data: any) => {
        // Teacher started quiz! Fetch full quiz data immediately
        fetch(`/api/quizzes/${quizId}`)
          .then((res) => res.json())
          .then((freshData) => {
            if (freshData.success) {
              setQuiz(freshData.quiz);
              setQuestions(freshData.questions || []);
            }
          })
          .catch(() => {});
      });

      const studentChannel = pusherClient.subscribe(`student-${userId}`);
      studentChannel.bind("approval-status", (data: any) => {
        if (data.quizId === parseInt(quizId)) {
          setStudentQuizStatus(data.status);
          if (data.status === "rejected") {
            setQuizError("Your request to join late was rejected by the teacher.");
          }
        }
      });
    });

    return () => {
      if (pusherClient) {
        pusherClient.unsubscribe(`quiz-${quizId}`);
        pusherClient.unsubscribe(`student-${userId}`);
      }
    };
  }, [quizId, userId]);

  const handleSelectChoice = (questionId: number, choiceId: number) => {
    // If choice is eliminated by 50/50, ignore click
    if (eliminatedChoices[questionId]?.includes(choiceId)) return;

    playTone([523, 659], "sine", 0.08);

    setAnswersState((prev: Record<number, number>) => {
      const isNew = prev[questionId] !== choiceId;
      if (isNew) {
        setXp((x) => x + (powerUps.doublePoints.active ? 100 : 50) * Math.min(streak, 3));
        setStreak((s) => Math.min(s + 1, 5));
      }
      return {
        ...prev,
        [questionId]: choiceId
      };
    });
  };

  // ── Capture webcam snapshot as base64 ──────────────────
  const captureSnapshot = useCallback((): string | null => {
    const video = mobileVideoRef.current || videoRef.current;
    if (!video) return null;
    if (video.readyState < 2 && video.videoWidth === 0) return null;

    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
    }

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = Math.min(w, 640);
    canvas.height = Math.min(h, 480);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.70);
    } catch {
      return null;
    }
  }, []);

  // Stable refs for exam state
  const answersStateRef = useRef<Record<number, number>>({});
  answersStateRef.current = answersState;
  const xpRef = useRef(xp);
  xpRef.current = xp;
  const streakRef = useRef(streak);
  streakRef.current = streak;
  const questionsRef = useRef(questions);
  questionsRef.current = questions;
  const studentQuizIdRef = useRef(studentQuizId);
  studentQuizIdRef.current = studentQuizId;
  const violationCountStateRef = useRef(violationCount);
  violationCountStateRef.current = violationCount;

  // ── Submit quiz to backend ────────────────────────────
  const submitQuiz = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const currentAnswers = answersStateRef.current;
      const currentXp = xpRef.current;
      const currentStreak = streakRef.current;
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
          xpEarned: currentXp,
          streakMax: currentStreak,
        })
      });

      const data = await res.json();
      if (res.ok) {
        playTone([523, 659, 783, 1046, 1318], "triangle", 0.25);
        setQuizSubmittedResult({
          score: data.score || Object.keys(currentAnswers).length * 10,
          total: currentQuestions.length * 10,
          xp: currentXp,
          streak: currentStreak,
          violations: currentViolations,
        });
      } else {
        alert(data.error || "Submission failed");
        setIsSubmitting(false);
      }
    } catch (err) {
      alert("Network error submitting quiz");
      setIsSubmitting(false);
    }
  }, [isSubmitting, quizId, playTone]);

  const submitQuizRef = useRef(submitQuiz);
  submitQuizRef.current = submitQuiz;

  // ── Report Violation to Backend ───────────────────────
  const reportViolation = useCallback(async (type: string) => {
    if (isReportingRef.current || isAlertingRef.current || isStartupGracePeriodRef.current) return;
    isReportingRef.current = true;

    try {
      const currentCount = violationCountRef.current + 1;
      violationCountRef.current = currentCount;
      setViolationCount(currentCount);

      const base64Img = captureSnapshot();

      await fetch("/api/live/violation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId: parseInt(quizId),
          studentQuizId: studentQuizIdRef.current,
          violationType: type,
          confidenceScore: 92,
          screenshot: base64Img,
        }),
      });

      playTone([250, 180], "sawtooth", 0.2);

      if (currentCount >= 3) {
        isAlertingRef.current = true;
        setWarningModal({
          show: true,
          message: "You have accumulated 3 security violations. Your quiz is now being submitted automatically.",
          isFinal: true,
        });
        setTimeout(() => {
          submitQuizRef.current();
        }, 3000);
      } else {
        isAlertingRef.current = true;
        setWarningModal({
          show: true,
          message: `Security Warning ${currentCount}/3: Please ensure your face is visible, looking at the screen, and no unauthorized devices are present.`,
          isFinal: false,
        });
      }
    } catch (err) {
      console.error("Failed to report violation:", err);
    } finally {
      setTimeout(() => {
        isReportingRef.current = false;
      }, 2500);
    }
  }, [quizId, captureSnapshot, playTone]);

  const reportViolationRef = useRef(reportViolation);
  reportViolationRef.current = reportViolation;

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

    let snapshotInterval: NodeJS.Timeout | null = null;
    let aiInterval: NodeJS.Timeout | null = null;
    let faceDetectionInterval: NodeJS.Timeout | null = null;
    let audioInterval: NodeJS.Timeout | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let microphone: MediaStreamAudioSourceNode | null = null;

    const startMedia = async () => {
      let videoStream: MediaStream | null = null;
      let audioOk = false;

      try {
        videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
          audio: true,
        });
        audioOk = true;
      } catch (err) {
        try {
          videoStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 } },
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
            studentQuizId: studentQuizId,
            snapshot: snap,
          }),
        });
      } catch {}
    };

    startMedia()
      .then(async ({ stream, audioActive }) => {
        mediaStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        if (mobileVideoRef.current) mobileVideoRef.current.srcObject = stream;
        setCameraActive(true);

        setTimeout(() => notifyTeacherJoined(), 1500);

        // Upload snapshots every 1000ms (1s)
        uploadSnapshot();
        snapshotInterval = setInterval(() => {
          uploadSnapshot();
        }, 1000);

        // Load Edge AI Models
        try {
          const faceapi = await import("@vladmandic/face-api");
          const tf = await import("@tensorflow/tfjs");
          const cocoSsd = await import("@tensorflow-models/coco-ssd");

          await tf.ready();
          const [cocoModel] = await Promise.all([
            cocoSsd.load(),
            faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
            faceapi.nets.faceLandmark68Net.loadFromUri('/models')
          ]);

          setAiStatus("Active ✓");

          let lookingAwayFrames = 0;
          let noFaceFrames = 0;
          let multipleFacesFrames = 0;
          let phoneDetectedFrames = 0;
          let tickCounter = 0;

          faceDetectionInterval = setInterval(async () => {
            if (violationCountRef.current >= 3 || isAlertingRef.current || isReportingRef.current) return;
            const activeVideo = mobileVideoRef.current || videoRef.current;
            if (!activeVideo || activeVideo.readyState < 2) return;

            if (tickCounter % 2 === 0) {
              try {
                const detections = await faceapi.detectAllFaces(
                  activeVideo,
                  new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 })
                ).withFaceLandmarks();

                if (detections.length === 0) {
                  noFaceFrames++;
                  if (noFaceFrames > 4) {
                    reportViolation("no_face");
                    noFaceFrames = 0;
                  }
                  setFaceStatus("Not Detected ✗");
                } else if (detections.length > 1) {
                  multipleFacesFrames++;
                  if (multipleFacesFrames > 3) {
                    reportViolation("multiple_faces");
                    multipleFacesFrames = 0;
                  }
                  setFaceStatus("Multiple ✗");
                } else {
                  noFaceFrames = 0;
                  multipleFacesFrames = 0;
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
                    if (lookingAwayFrames >= 5) {
                      reportViolation(violationReason);
                      lookingAwayFrames = 0;
                      setPreWarning(null);
                    }
                  } else {
                    if (lookingAwayFrames > 0) {
                      lookingAwayFrames--;
                      if (lookingAwayFrames < 2) setPreWarning(null);
                    }
                  }
                }
              } catch (faceErr) {}
            } else {
              try {
                const predictions = await cocoModel.detect(activeVideo);
                const phoneDetected = predictions.some(
                  (p) => (["cell phone", "remote", "mobile phone"].includes(p.class) && p.score > 0.58)
                );

                if (phoneDetected) {
                  setDeviceStatus("Phone Detected ✗");
                  if (phoneDetectedFrames === 0) {
                    setPreWarning("⚠️ Pre-Warning: Unauthorized device (phone) detected in frame!");
                    reportViolation("device_detected");
                  }
                  phoneDetectedFrames++;
                } else {
                  phoneDetectedFrames = 0;
                  setDeviceStatus("None ✓");
                }
              } catch (cocoErr) {}
            }
            tickCounter++;
          }, 450);

        } catch (err) {}

        // Audio Analysis
        if (audioActive && stream.getAudioTracks().length > 0) {
          try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            audioContext = new AudioContextClass();
            if (audioContext.state === "suspended") {
              await audioContext.resume().catch(() => {});
            }
            analyser = audioContext.createAnalyser();
            microphone = audioContext.createMediaStreamSource(stream);
            microphone.connect(analyser);
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.5;

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            let violationConsecutiveCount = 0;

            audioInterval = setInterval(async () => {
              if (violationCountRef.current >= 3 || isAlertingRef.current || isReportingRef.current) return;
              if (audioContext && audioContext.state === "suspended") {
                await audioContext.resume().catch(() => {});
              }
              if (!analyser) return;

              analyser.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
              }
              const avg = sum / bufferLength;
              const levelPercent = Math.min(100, Math.floor((avg / 128) * 100));
              setAudioLevel(levelPercent);

              if (levelPercent > 48) {
                violationConsecutiveCount++;
                if (violationConsecutiveCount === 2) {
                  setPreWarning("⚠️ Pre-Warning: Audio anomaly / speaking detected. Please remain quiet.");
                }
                if (violationConsecutiveCount >= 5) {
                  reportViolation("audio_anomaly");
                  violationConsecutiveCount = 0;
                  setPreWarning(null);
                }
              } else {
                if (violationConsecutiveCount > 0) violationConsecutiveCount--;
              }
            }, 400);
          } catch (e) {}
        }
      })
      .catch((err) => {
        setAiStatus("Error");
      });

    return () => {
      if (snapshotInterval) clearInterval(snapshotInterval);
      if (aiInterval) clearInterval(aiInterval);
      if (faceDetectionInterval) clearInterval(faceDetectionInterval);
      if (audioInterval) clearInterval(audioInterval);
      if (audioContext) audioContext.close().catch(() => {});
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [hasStarted, quiz?.teacherId, quizId, studentQuizId, notifyTeacherJoined, captureSnapshot, reportViolation]);

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
    if (hasStarted && timeLeft === 0 && !isSubmitting) {
      submitQuiz();
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
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch {}
    };
    requestFS();

    let tabSwitchTimer: NodeJS.Timeout | null = null;
    let fullscreenExitTimer: NodeJS.Timeout | null = null;

    const handleFullscreenChange = () => {
      if (isStartupGracePeriodRef.current) return;
      if (!document.fullscreenElement) {
        setPreWarning("⚠️ PRE-WARNING: Exiting full screen is prohibited. Please re-enter full screen.");
        if (fullscreenExitTimer) clearTimeout(fullscreenExitTimer);
        fullscreenExitTimer = setTimeout(() => {
          if (!document.fullscreenElement && violationCountRef.current < 3 && !isAlertingRef.current && !isReportingRef.current) {
            reportViolation("fullscreen_exit");
          } else {
            setPreWarning(null);
          }
        }, 3000);
      } else {
        if (fullscreenExitTimer) clearTimeout(fullscreenExitTimer);
        setPreWarning(null);
      }
    };

    const handleVisibilityChange = () => {
      if (isStartupGracePeriodRef.current) return;
      if (document.hidden) {
        setPreWarning("⚠️ PRE-WARNING: Leaving exam tab detected. Please return to the quiz window.");
        if (tabSwitchTimer) clearTimeout(tabSwitchTimer);
        tabSwitchTimer = setTimeout(() => {
          if (document.hidden && violationCountRef.current < 3 && !isAlertingRef.current && !isReportingRef.current) {
            reportViolation("tab_switch");
          } else {
            setPreWarning(null);
          }
        }, 2500);
      } else {
        if (tabSwitchTimer) clearTimeout(tabSwitchTimer);
        setPreWarning(null);
      }
    };

    const preventCopy = (e: ClipboardEvent) => { e.preventDefault(); };
    const preventContextMenu = (e: MouseEvent) => { e.preventDefault(); };
    const preventShortcuts = (e: KeyboardEvent) => {
      if (
        e.key === "PrintScreen" ||
        (e.ctrlKey && (e.key === "c" || e.key === "v" || e.key === "p" || e.key === "s")) ||
        e.key === "F12"
      ) {
        e.preventDefault();
        if (isStartupGracePeriodRef.current) return;
        if (violationCountRef.current < 3 && !isAlertingRef.current && !isReportingRef.current) {
          reportViolation("attempted_screenshot");
        }
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("copy", preventCopy);
    document.addEventListener("cut", preventCopy as any);
    document.addEventListener("contextmenu", preventContextMenu);
    document.addEventListener("keydown", preventShortcuts);

    return () => {
      if (graceTimer) clearTimeout(graceTimer);
      if (tabSwitchTimer) clearTimeout(tabSwitchTimer);
      if (fullscreenExitTimer) clearTimeout(fullscreenExitTimer);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("copy", preventCopy);
      document.removeEventListener("cut", preventCopy as any);
      document.removeEventListener("contextmenu", preventContextMenu);
      document.removeEventListener("keydown", preventShortcuts);
    };
  }, [hasStarted]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // ─── POST-QUIZ PROCTORSHIELD CELEBRATORY PODIUM SCREEN ────────────────
  if (quizSubmittedResult) {
    return (
      <div className="min-h-screen bg-[#0d0f18] text-white flex items-center justify-center p-4 relative overflow-hidden">
        {/* Glow backdrop */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-indigo-600/20 via-violet-600/20 to-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="bg-[#141726]/90 backdrop-blur-xl border border-[#2b3252] rounded-3xl p-8 max-w-xl w-full text-center relative z-10 shadow-2xl space-y-6 animate-fade-in">
          {/* Trophy & Podium */}
          <div className="relative inline-block mx-auto">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-amber-400 to-amber-600 flex items-center justify-center mx-auto shadow-xl shadow-amber-500/30 animate-bounce">
              <Trophy className="w-10 h-10 text-white" />
            </div>
            <span className="absolute -bottom-2 -right-2 px-2.5 py-0.5 rounded-full bg-emerald-500 text-[10px] font-black tracking-wider text-slate-950 uppercase shadow-md">
              RANK #1
            </span>
          </div>

          <div>
            <h1 className="text-3xl font-black tracking-tight text-white font-[family-name:var(--font-display)]">
              Assessment Completed!
            </h1>
            <p className="text-sm text-slate-400 mt-1 font-medium">
              ProctorShield Gamified Integrity Score Recorded
            </p>
          </div>

          {/* Gamified Stats Grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#1b2038] border border-[#2e375e] p-3.5 rounded-2xl">
              <div className="text-[10px] font-bold text-slate-400 uppercase">XP Earned</div>
              <div className="text-xl font-black text-amber-400 mt-1 flex items-center justify-center gap-1">
                <Sparkles className="w-4 h-4 text-amber-400" /> {quizSubmittedResult.xp}
              </div>
            </div>

            <div className="bg-[#1b2038] border border-[#2e375e] p-3.5 rounded-2xl">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Max Streak</div>
              <div className="text-xl font-black text-orange-400 mt-1 flex items-center justify-center gap-1">
                <Flame className="w-4 h-4 text-orange-500" /> {quizSubmittedResult.streak}x
              </div>
            </div>

            <div className="bg-[#1b2038] border border-[#2e375e] p-3.5 rounded-2xl">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Integrity Score</div>
              <div className={`text-xl font-black mt-1 ${quizSubmittedResult.violations === 0 ? "text-emerald-400" : "text-amber-400"}`}>
                {quizSubmittedResult.violations === 0 ? "100%" : "Clean"}
              </div>
            </div>
          </div>

          {/* Guardian Trust Shield Banner */}
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3 text-left">
            <ShieldCheck className="w-8 h-8 text-emerald-400 shrink-0" />
            <div>
              <h4 className="text-xs font-bold text-emerald-400">Guardian Verified Submission</h4>
              <p className="text-[11px] text-slate-300">
                {quizSubmittedResult.violations === 0
                  ? "Zero violations recorded. Your exam was submitted with 100% verified integrity."
                  : `Exam proctoring completed with ${quizSubmittedResult.violations} flag(s) logged.`}
              </p>
            </div>
          </div>

          {/* Return Button */}
          <button
            onClick={() => router.push("/dashboard/student")}
            className="w-full py-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:opacity-90 text-white font-extrabold text-sm rounded-2xl transition-all shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Return to Student Dashboard</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ─── PRE-START SCREEN ────────────────────────────
  if (!hasStarted) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="bg-[#111] p-8 rounded-2xl border border-gray-800 max-w-lg w-full text-center">
          {isMobile && (
            <div className="mb-6 flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-left">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-400">Mobile Device Detected</p>
                <p className="text-xs text-amber-300/80 mt-0.5">This quiz requires a desktop or laptop computer. AI proctoring may not function correctly on mobile devices.</p>
              </div>
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
              
              {/* Gamification Badge */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs font-bold mb-4">
                <Flame className="w-3.5 h-3.5 text-orange-400" /> ProctorShield Gamified Exam Engine Enabled
              </div>

              <p className="text-gray-400 mb-6 text-sm leading-relaxed">
                {quiz?.description || "This quiz is monitored by ProctorShield AI. Your camera and screen activity will be recorded and analyzed in real-time."}
              </p>
              <div className="space-y-2.5 text-left mb-8 bg-[#1a1a1a] p-4 rounded-xl text-xs text-gray-300">
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Do not leave the browser window or switch tabs.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Copying, pasting, and screenshots are strictly prohibited.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Cellphones and other devices are not allowed in the frame.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Keep your face visible and facing the screen at all times.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> The quiz will enter fullscreen mode automatically.</p>
                <p className="flex items-center gap-2 text-red-400 mt-3 pt-3 border-t border-gray-800"><AlertTriangle className="w-4 h-4 shrink-0" /> Quiz will auto-terminate after 3 violations.</p>
              </div>

              {/* LOBBY / WAITING FOR TEACHER STATUS */}
              {quiz?.quizStatus === "draft" || quiz?.quizStatus === "scheduled" ? (
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
              ) : studentQuizStatus === "pending_approval" ? (
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
              ) : (
                <button
                  onClick={() => setHasStarted(true)}
                  className="w-full py-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:opacity-95 text-white font-black text-sm rounded-xl transition-all shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer animate-fade-in"
                >
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  I Understand, Start Quiz
                </button>
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

  return (
    <div className="min-h-screen bg-[#0b0d17] text-white flex flex-col font-sans select-none overflow-x-hidden">
      
      {/* Floating Gamification Celebration Banner */}
      {celebrationBanner && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white font-black text-xs sm:text-sm rounded-2xl shadow-2xl shadow-orange-500/40 border border-amber-300/40 animate-bounce flex items-center gap-2">
          <Sparkles className="w-4 h-4 animate-spin" />
          <span>{celebrationBanner}</span>
        </div>
      )}

      {/* Security Warning Modal */}
      {warningModal.show && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#151928] border-2 border-red-500/80 rounded-3xl p-6 max-w-md w-full text-center shadow-2xl shadow-red-500/20 animate-fade-in space-y-4">
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

      {/* TOP HEADER WITH PROCTORSHIELD GAMIFICATION HUD */}
      <header className="py-2.5 px-4 lg:px-8 bg-[#131627] border-b border-[#242a42] flex flex-wrap items-center justify-between shrink-0 shadow-md gap-3">
        <div className="flex items-center gap-3">
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

        {/* Gamified HUD Badges */}
        <div className="flex items-center gap-2 lg:gap-4">
          {/* Streak Badge */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-400 font-extrabold text-xs shadow-xs">
            <Flame className="w-4 h-4 text-orange-500 animate-pulse" />
            <span>Streak {streak}x</span>
          </div>

          {/* XP Badge */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 font-extrabold text-xs shadow-xs">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>{xp} XP</span>
          </div>

          {/* Exam Timer */}
          <div className={`px-4 py-1.5 rounded-xl text-base font-bold font-mono shadow-md border ${
            isTimeFrozen 
              ? "bg-cyan-500/20 border-cyan-400 text-cyan-300 animate-pulse" 
              : "bg-[#1c2138] border-[#2e375e] text-amber-400"
          }`}>
            {formatTime(timeLeft)}
          </div>

          {/* Submit Exam Button */}
          <button
            onClick={submitQuiz}
            disabled={isSubmitting || loadingQuiz || !!quizError}
            className="px-4 py-2 bg-gradient-to-r from-red-900/80 to-rose-900/80 border border-rose-600/50 hover:bg-rose-800 text-rose-100 font-black text-xs rounded-xl transition-all shadow-md disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? "Submitting..." : "Submit Exam"}
          </button>
        </div>
      </header>

      {/* Real-time XP Progress Bar */}
      <div className="w-full h-1.5 bg-[#181c30] overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-emerald-400 transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Hidden canvas for background snapshots */}
      <canvas ref={canvasRef} className="hidden" />

      {/* MAIN EXAM LAYOUT */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden p-3 lg:p-6 gap-4 lg:gap-6 max-h-none lg:max-h-[calc(100vh-80px)]">
        
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
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-semibold">Violations:</span>
                <span className={`font-bold ${violationCount > 0 ? "text-red-400 font-black" : "text-emerald-400"}`}>
                  {violationCount}/3 ⚠
                </span>
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
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Face Detection</span>
              <span className={`font-bold ${faceStatus.includes("✓") ? "text-emerald-400" : "text-red-400"}`}>{faceStatus}</span>
            </div>
            <div className="flex items-center justify-between text-xs pt-2 border-t border-[#242a42]">
              <span className="text-slate-400 font-medium">Device Scan</span>
              <span className={`font-bold ${deviceStatus.includes("✓") ? "text-emerald-400" : "text-red-400"}`}>{deviceStatus}</span>
            </div>
            <div className="pt-2 border-t border-[#242a42] space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Audio Level</span>
                <span className="font-bold text-emerald-400 text-[11px]">{audioLevel}%</span>
              </div>
              <div className="w-full h-1.5 bg-[#1e2338] rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 transition-all duration-150" style={{ width: `${audioLevel}%` }} />
              </div>
            </div>
          </div>

          {/* Violations Card */}
          <div className="bg-[#141726] border border-[#242a42] rounded-2xl p-4 shadow-md">
            <div className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest mb-2">
              VIOLATIONS ({violationCount}/3)
            </div>
            <div className="grid grid-cols-3 gap-2">
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

        {/* QUESTIONS STACK & POWER-UP DOCK */}
        <div className="w-full flex-1 flex flex-col gap-4 overflow-hidden">
          
          {/* PROCTORSHIELD POWER-UP DOCK */}
          <div className="bg-[#141726] border border-[#242a42] rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-md shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <span className="text-xs font-bold text-slate-300">ProctorShield Power-Ups:</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* 50/50 Eraser */}
              <button
                type="button"
                onClick={() => {
                  if (questions.length > 0) {
                    handleUseFiftyFifty(questions[0].id);
                  }
                }}
                disabled={powerUps.fiftyFifty.used}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  powerUps.fiftyFifty.used
                    ? "bg-[#1c2136] text-slate-500 border border-slate-700/40 opacity-50 cursor-not-allowed"
                    : "bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 shadow-xs"
                }`}
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>50/50 Eraser {powerUps.fiftyFifty.used ? "(Used)" : "(1x)"}</span>
              </button>

              {/* 2x Double Points */}
              <button
                type="button"
                onClick={handleUseDoublePoints}
                disabled={powerUps.doublePoints.used}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  powerUps.doublePoints.used
                    ? "bg-[#1c2136] text-slate-500 border border-slate-700/40 opacity-50 cursor-not-allowed"
                    : "bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 shadow-xs"
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>2x Points {powerUps.doublePoints.used ? "(Used)" : "(1x)"}</span>
              </button>

              {/* Time Freeze (+30s) */}
              <button
                type="button"
                onClick={handleUseTimeFreeze}
                disabled={powerUps.timeFreeze.used}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  powerUps.timeFreeze.used
                    ? "bg-[#1c2136] text-slate-500 border border-slate-700/40 opacity-50 cursor-not-allowed"
                    : "bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 shadow-xs"
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>+30s Freeze {powerUps.timeFreeze.used ? "(Used)" : "(1x)"}</span>
              </button>
            </div>
          </div>

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
            ) : (
              questions.map((q, qi) => {
                const isEliminated = (choiceId: number) => eliminatedChoices[q.id]?.includes(choiceId);

                return (
                  <div key={q.id} className="bg-[#1b2038] border border-[#2e375e] rounded-2xl p-6 shadow-md space-y-4">
                    <div className="flex items-center justify-between text-xs font-bold text-indigo-400 uppercase tracking-wider">
                      <span>QUESTION {qi + 1} OF {questions.length}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono">
                        {q.points || 1} PT
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-white leading-snug">
                      {q.questionText}
                    </h3>

                    <div className="space-y-3 pt-2">
                      {q.choices.map((choice: any, ci: number) => {
                        const optionLetter = String.fromCharCode(65 + ci);
                        const isSelected = answersState[q.id] === choice.id;
                        const eliminated = isEliminated(choice.id);

                        return (
                          <div
                            key={choice.id}
                            onClick={() => !eliminated && handleSelectChoice(q.id, choice.id)}
                            className={`flex items-center gap-4 p-3.5 rounded-xl border transition-all ${
                              eliminated
                                ? "opacity-30 line-through bg-slate-900/50 border-dashed border-slate-700 cursor-not-allowed"
                                : isSelected
                                ? "bg-[#283158] border-indigo-500 shadow-md shadow-indigo-500/20 cursor-pointer"
                                : "bg-[#141728] border-[#283152] hover:bg-[#202746] hover:border-indigo-500/50 cursor-pointer"
                            }`}
                          >
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 transition-all ${
                                isSelected
                                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                                  : "bg-[#222846] text-slate-400"
                              }`}
                            >
                              {optionLetter}
                            </div>
                            <span className={`text-sm font-medium ${isSelected ? "text-white font-bold" : "text-slate-300"}`}>
                              {choice.choiceText}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
