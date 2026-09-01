"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, AlertTriangle, CheckCircle } from "lucide-react";

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
          setQuestions(data.questions);
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
  }, [quizId]);

  // Handle pusher lobby real-time updates
  useEffect(() => {
    if (!quizId || !userId) return;

    let pusherClient: any;
    
    import("pusher-js").then((Pusher) => {
      pusherClient = new Pusher.default(process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774", {
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1",
      });

      // Subscribe to quiz channel to know when quiz starts
      const quizChannel = pusherClient.subscribe(`quiz-${quizId}`);
      quizChannel.bind("quiz-started", () => {
        setQuiz((prev: any) => prev ? { ...prev, quizStatus: "in_progress" } : prev);
      });

      // Subscribe to student channel to know approval status
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
    setAnswersState((prev: Record<number, number>) => ({
      ...prev,
      [questionId]: choiceId
    }));
  };

  // ── Submit quiz to backend ────────────────────────────
  const submitQuiz = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const payloadAnswers = Object.entries(answersState).map(([qId, cId]) => ({
        questionId: parseInt(qId),
        choiceId: cId
      }));

      await fetch("/api/quizzes/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId, answers: payloadAnswers }),
      });
    } catch (err) {
      console.error("Failed to submit quiz:", err);
    } finally {
      router.push("/dashboard/student");
    }
  }, [quizId, router, isSubmitting, answersState]);

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
      return canvas.toDataURL("image/jpeg", 0.75);
    } catch {
      return null;
    }
  }, []);

  // ── Capture 3-5 second Video Clip Evidence ──
  const captureVideoEvidence = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      const fallbackSnapshot = captureSnapshot();
      if (!mediaStreamRef.current || typeof MediaRecorder === "undefined") {
        resolve(fallbackSnapshot);
        return;
      }
      try {
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
          ? "video/webm;codecs=vp8"
          : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : "";

        if (!mimeType) {
          resolve(fallbackSnapshot);
          return;
        }

        const recorder = new MediaRecorder(mediaStreamRef.current, { mimeType });
        const chunks: Blob[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve((reader.result as string) || fallbackSnapshot);
          };
          reader.onerror = () => resolve(fallbackSnapshot);
          reader.readAsDataURL(blob);
        };

        recorder.start();
        setTimeout(() => {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        }, 3000);
      } catch (err) {
        console.warn("Video evidence recording failed, falling back to snapshot:", err);
        resolve(fallbackSnapshot);
      }
    });
  }, [captureSnapshot]);

  // ── Report violation to server (with 3-strike auto-termination) ──
  const reportViolation = useCallback(async (type: string) => {
    if (isReportingRef.current) return;
    isReportingRef.current = true;

    const newCount = violationCountRef.current + 1;
    violationCountRef.current = newCount;
    setViolationCount(newCount);

    setAiLogs((prev) => [
      {
        id: String(Date.now()),
        text: `Violation: ${type.replace(/_/g, " ")}`,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isError: true,
      },
      ...prev.slice(0, 4),
    ]);

    try {
      const evidence = await captureVideoEvidence();

      await fetch("/api/live/violation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId,
          violationType: type,
          confidenceScore: 100,
          snapshot: evidence || undefined,
        }),
      });

      isAlertingRef.current = true;
      if (newCount === 1) {
        setWarningModal({ show: true, message: "⚠️ WARNING (1/3): Violation detected — " + type.replace(/_/g, " ") + ". Continuing this behavior will terminate your quiz.", isFinal: false });
      } else if (newCount === 2) {
        setWarningModal({ show: true, message: "⚠️ WARNING (2/3): Second violation — " + type.replace(/_/g, " ") + ". One more violation and your quiz will be automatically submitted.", isFinal: false });
      } else if (newCount >= 3) {
        setWarningModal({ show: true, message: "🚫 FINAL (3/3): Maximum violations reached. Your quiz is being automatically terminated and submitted.", isFinal: true });
        setTimeout(() => {
          setWarningModal({ show: false, message: "", isFinal: false });
          isAlertingRef.current = false;
          submitQuiz();
        }, 3000);
      }
    } catch (err) {
      console.error("Failed to report violation:", err);
    } finally {
      isReportingRef.current = false;
    }
  }, [quizId, submitQuiz, captureSnapshot]);

  // ── Notify teacher that student joined (lightweight, no image) ──
  const notifyTeacherJoined = useCallback(async () => {
    try {
      await fetch("/api/live/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId }),
      });
    } catch (err) {
      console.error("Failed to notify teacher:", err);
    }
  }, [quizId]);

  // ── Upload snapshot to server ──
  const uploadSnapshot = useCallback(async () => {
    const snapshot = captureSnapshot();
    if (!snapshot) return;
    try {
      await fetch("/api/live/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshot,
          quizId,
          quizTitle: quiz?.title,
          studentId: userId,
          studentName: quiz?.studentName || "Student",
          teacherId: quiz?.teacherId,
        }),
      });
    } catch (err) {
      console.error("Snapshot upload failed:", err);
    }
  }, [captureSnapshot, quizId, quiz?.title, quiz?.teacherId, quiz?.studentName, userId]);

  // ── Send frame to Gemini AI for real violation detection ──
  const analyzeFrame = useCallback(async () => {
    const snapshot = captureSnapshot();
    if (!snapshot) return;

    try {
      const res = await fetch("/api/live/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot }),
      });

      if (!res.ok) return;
      const data = await res.json();
      const violations: string[] = data.violations || [];

      // Update AI diagnostic display for Devices (since face-api handles the rest)
      if (violations.length === 0) {
        setDeviceStatus("None ✓");
      } else {
        if (violations.includes("device_detected")) {
          setDeviceStatus("Phone Found ✗");
        }
      }

      // Report the FIRST violation found (one at a time to avoid spam)
      if (violations.length > 0 && violationCountRef.current < 3) {
        reportViolation(violations[0]);
      }
    } catch (err) {
      console.error("AI analysis failed:", err);
    }
  }, [captureSnapshot, reportViolation]);

  // ── Initialize Webcam + Start all monitoring loops ──
  useEffect(() => {
    if (!hasStarted) return;

    let snapshotInterval: NodeJS.Timeout | null = null;
    let aiInterval: NodeJS.Timeout | null = null;
    let cocoInterval: NodeJS.Timeout | null = null;
    let audioInterval: NodeJS.Timeout | null = null;
    let faceApiInterval: NodeJS.Timeout | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let microphone: MediaStreamAudioSourceNode | null = null;

    const startMedia = async () => {
      try {
        // Try getting both video and audio
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 60, min: 15, max: 60 },
          },
          audio: true,
        });
        return { stream, audioActive: true };
      } catch (err) {
        console.warn("Failed to get audio stream, falling back to video only:", err);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
              frameRate: { ideal: 60, min: 15, max: 60 },
            },
            audio: false,
          });
          return { stream, audioActive: false };
        } catch (videoErr) {
          throw videoErr;
        }
      }
    };
    
    startMedia()
      .then(async ({ stream, audioActive }) => {
        mediaStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        if (mobileVideoRef.current) {
          mobileVideoRef.current.srcObject = stream;
        }
        setCameraActive(true);

        // Notify teacher once (lightweight)
        setTimeout(() => notifyTeacherJoined(), 1500);

        // Upload snapshots every 1 second (1000ms) for real-time AI snapshot monitoring
        uploadSnapshot();
        snapshotInterval = setInterval(() => {
          uploadSnapshot();
        }, 1000);

        // Load face-api models and COCO-SSD
        try {
          const faceapi = await import("@vladmandic/face-api");
          const tf = await import("@tensorflow/tfjs");
          const cocoSsd = await import("@tensorflow-models/coco-ssd");

          // Ensure TF backend is ready
          await tf.ready();
          
          const [cocoModel] = await Promise.all([
            cocoSsd.load(),
            faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
            faceapi.nets.faceLandmark68Net.loadFromUri('/models')
          ]);
          
          let noFaceFrames = 0;
          let multipleFacesFrames = 0;
          let lookingAwayFrames = 0;
          let phoneDetectedFrames = 0;
          let tickCounter = 0;

          // ── High-Performance Unified Staggered AI Loop (450ms Alternating Ticks) ──
          faceApiInterval = setInterval(async () => {
            const activeVideo = mobileVideoRef.current || videoRef.current;
            if (!activeVideo || isAlertingRef.current || isReportingRef.current || violationCountRef.current >= 3) return;
            
            // Stagger execution to prevent main thread blocking (CPU lag)
            if (tickCounter % 2 === 0) {
              // ── TICK 0: FACE TRACKING & 3D HEAD POSE (Input size 160 for 3x speedup) ──
              try {
                const detections = await faceapi.detectAllFaces(
                  activeVideo,
                  new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 })
                ).withFaceLandmarks();

                if (detections.length === 0) {
                  noFaceFrames++;
                  if (noFaceFrames > 4) { // ~2 seconds
                    reportViolation("no_face");
                    noFaceFrames = 0;
                  }
                  setFaceStatus("Not Detected ✗");
                } else if (detections.length > 1) {
                  multipleFacesFrames++;
                  if (multipleFacesFrames > 3) { // ~1.5 seconds
                    reportViolation("multiple_faces");
                    multipleFacesFrames = 0;
                  }
                  setFaceStatus("Multiple ✗");
                } else {
                  noFaceFrames = 0;
                  multipleFacesFrames = 0;
                  setFaceStatus("Detected ✓");

                  // ── DIRECTIONAL HEAD TRACKING ──
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

                  // Accurate thresholds for laptop & webcam positioning
                  if (yawOffset < -0.38) {
                    direction = "Looking Right ✗";
                    violationReason = "looking_right";
                  } else if (yawOffset > 0.38) {
                    direction = "Looking Left ✗";
                    violationReason = "looking_left";
                  } else if (pitchRatio < 0.15) {
                    direction = "Looking Up ✗";
                    violationReason = "looking_up";
                  } else if (pitchRatio > 1.10) { // Only triggers down when head is heavily tilted down!
                    direction = "Looking Down ✗";
                    violationReason = "looking_down";
                  }

                  setGazeStatus(direction);

                  // Natural radar position (50%, 50% is center for pitchRatio ~0.55)
                  let radarX = 50 - (yawOffset * 100);
                  radarX = Math.max(15, Math.min(85, radarX));

                  let radarY = 50 + ((pitchRatio - 0.55) * 60);
                  radarY = Math.max(15, Math.min(85, radarY));

                  setHeadPos({ x: radarX, y: radarY });

                  // Render Overlay Line on Canvas
                  if (overlayCanvasRef.current && videoRef.current) {
                    const canvas = overlayCanvasRef.current;
                    const video = videoRef.current;
                    if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
                      canvas.width = video.clientWidth || 320;
                      canvas.height = video.clientHeight || 240;
                    }
                    const ctx = canvas.getContext("2d");
                    if (ctx) {
                      ctx.clearRect(0, 0, canvas.width, canvas.height);
                      const scaleX = canvas.width / (video.videoWidth || 640);
                      const scaleY = canvas.height / (video.videoHeight || 480);

                      const nx = noseBottom.x * scaleX;
                      const ny = noseBottom.y * scaleY;
                      const ex = eyeCenterX * scaleX;
                      const ey = eyeCenterY * scaleY;

                      ctx.strokeStyle = direction === "Focused ✓" ? "#10b981" : "#ef4444";
                      ctx.lineWidth = 2.5;
                      ctx.beginPath();
                      ctx.moveTo(ex, ey);
                      ctx.lineTo(nx, ny);
                      ctx.stroke();

                      ctx.fillStyle = direction === "Focused ✓" ? "#10b981" : "#ef4444";
                      ctx.beginPath();
                      ctx.arc(nx, ny, 4, 0, 2 * Math.PI);
                      ctx.fill();
                    }
                  }

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
              } catch (faceErr) {
                console.warn("Face detection tick error:", faceErr);
              }
            } else {
              // ── TICK 1: COCO-SSD SENSITIVE DEVICE DETECTOR ──
              try {
                const predictions = await cocoModel.detect(activeVideo);
                const phoneDetected = predictions.some(
                  (p) =>
                    (["cell phone", "remote", "mobile phone"].includes(p.class) && p.score > 0.58)
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
              } catch (cocoErr) {
                console.warn("COCO-SSD scan error:", cocoErr);
              }
            }
            tickCounter++;
          }, 450);

        } catch (err) {
          console.error("Failed to load face-api models:", err);
        }

        // Run Gemini AI analysis every 25 seconds for Device Detection backup
        setTimeout(() => {
          analyzeFrame();
          aiInterval = setInterval(() => {
            if (violationCountRef.current < 3) {
              analyzeFrame();
            }
          }, 25000);
        }, 5000);

        // ── Set up client-side audio analysis ──
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
              const avg = sum / bufferLength; // 0 to 255
              const levelPercent = Math.min(100, Math.floor((avg / 128) * 100));

              setAudioLevel(levelPercent);

              // Calibrated threshold for distinct speech/loud noise (> 48% audio level)
              if (levelPercent > 48) {
                violationConsecutiveCount++;
                if (violationConsecutiveCount === 2) {
                  setPreWarning("⚠️ Pre-Warning: Audio anomaly / speaking detected. Please remain quiet.");
                }
                if (violationConsecutiveCount >= 5) { // ~2.5 seconds continuous loud speech
                  reportViolation("audio_anomaly");
                  violationConsecutiveCount = 0;
                  setPreWarning(null);
                }
              } else {
                if (violationConsecutiveCount > 0) violationConsecutiveCount--;
              }
            }, 400);
          } catch (e) {
            console.error("Failed to initialize audio analyzer:", e);
          }
        }
      })
      .catch((err) => {
        console.error("Camera access denied:", err);
        alert("You must allow camera access to take this quiz.");
      });

    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((track) => track.stop());
      }
      if (snapshotInterval) clearInterval(snapshotInterval);
      if (aiInterval) clearInterval(aiInterval);
      if (cocoInterval) clearInterval(cocoInterval);
      if (audioInterval) clearInterval(audioInterval);
      if (faceApiInterval) clearInterval(faceApiInterval);
      if (audioContext) {
        audioContext.close().catch(console.error);
      }
    };
  }, [hasStarted, notifyTeacherJoined, uploadSnapshot, analyzeFrame, reportViolation]);

  // ── Countdown Timer ──
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

  // ── Anti-Cheat Event Listeners (includes fullscreen lockdown & pre-warning system) ──
  useEffect(() => {
    if (!hasStarted) return;

    // Set 5-second startup grace period so entering fullscreen mode on start NEVER causes false violations
    isStartupGracePeriodRef.current = true;
    const graceTimer = setTimeout(() => {
      isStartupGracePeriodRef.current = false;
    }, 5000);

    // Request fullscreen on quiz start
    const requestFS = async () => {
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch {
        // Some browsers block automatic fullscreen
      }
    };
    requestFS();

    let tabSwitchTimer: NodeJS.Timeout | null = null;
    let fullscreenExitTimer: NodeJS.Timeout | null = null;

    // Detect fullscreen exit (with Pre-warning)
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

    const handleWindowBlur = () => {
      if (isStartupGracePeriodRef.current) return;
      if (violationCountRef.current < 3 && !isAlertingRef.current && !isReportingRef.current) {
        setPreWarning("⚠️ PRE-WARNING: Window lost focus. Please stay on the exam screen.");
        setTimeout(() => setPreWarning(null), 3000);
      }
    };

    const handleResize = () => {
      if (isStartupGracePeriodRef.current) return;
      // Ignore minor geometry shifts (e.g. scrollbars toggling)
      if (Math.abs(window.innerWidth - screen.width) < 100) return;
      if (violationCountRef.current < 3 && !isAlertingRef.current && !isReportingRef.current) {
        setPreWarning("⚠️ PRE-WARNING: Please keep your window maximized during the exam.");
        setTimeout(() => setPreWarning(null), 3000);
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
    const preventSelect = (e: Event) => e.preventDefault();

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("resize", handleResize);
    document.addEventListener("copy", preventCopy);
    document.addEventListener("cut", preventCopy as any);
    document.addEventListener("contextmenu", preventContextMenu);
    document.addEventListener("keydown", preventShortcuts);
    document.addEventListener("selectstart", preventSelect);

    return () => {
      if (graceTimer) clearTimeout(graceTimer);
      if (tabSwitchTimer) clearTimeout(tabSwitchTimer);
      if (fullscreenExitTimer) clearTimeout(fullscreenExitTimer);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("copy", preventCopy);
      document.removeEventListener("cut", preventCopy as any);
      document.removeEventListener("contextmenu", preventContextMenu);
      document.removeEventListener("keydown", preventShortcuts);
      document.removeEventListener("selectstart", preventSelect);
    };
  }, [hasStarted, reportViolation]);


  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // ─── PRE-START SCREEN ────────────────────────────
  if (!hasStarted) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="bg-[#111] p-8 rounded-2xl border border-gray-800 max-w-lg w-full text-center">
          {/* Mobile Warning Banner */}
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
              <p className="text-gray-400 mb-8 text-sm leading-relaxed">
                {quiz?.description || "This quiz is monitored by ProctorShield AI. Your camera and screen activity will be recorded and analyzed in real-time."}
              </p>
              <div className="space-y-3 text-left mb-8 bg-[#1a1a1a] p-4 rounded-xl text-xs text-gray-300">
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Do not leave the browser window or switch tabs.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Copying, pasting, and screenshots are strictly prohibited.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Cellphones and other devices are not allowed in the frame.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Keep your face visible and facing the screen at all times.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> The quiz will enter fullscreen mode automatically.</p>
                <p className="flex items-center gap-2 text-red-400 mt-4 pt-4 border-t border-gray-800"><AlertTriangle className="w-4 h-4 shrink-0" /> Quiz will auto-terminate after 3 violations.</p>
              </div>
              {studentQuizStatus === "pending_approval" ? (
                <button disabled className="w-full py-3.5 bg-amber-600/50 text-white font-bold rounded-xl flex items-center justify-center gap-2 opacity-80 cursor-not-allowed">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Waiting for Teacher Approval...
                </button>
              ) : quiz?.quizStatus === "draft" || quiz?.quizStatus === "scheduled" ? (
                <button disabled className="w-full py-3.5 bg-indigo-600/50 text-white font-bold rounded-xl flex items-center justify-center gap-2 opacity-80 cursor-not-allowed">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Waiting for Teacher to Start Quiz...
                </button>
              ) : (
                <button
                  onClick={() => setHasStarted(true)}
                  className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/20 cursor-pointer"
                >
                  I Understand, Start Quiz
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }


  // ─── ACTIVE QUIZ SCREEN (Exact Figma Layout) ──────────────────────────
  return (
    <div className="min-h-screen bg-[#0d0f17] text-white flex flex-col font-sans select-none">
      {/* Warning Modal */}
      {warningModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1a1a] border border-red-500/50 rounded-2xl p-6 max-w-md w-full text-center shadow-2xl shadow-red-500/20 animate-fade-in">
            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Violation Detected</h3>
            <p className="text-gray-300 mb-6 text-sm">{warningModal.message}</p>
            {!warningModal.isFinal && (
              <button
                onClick={() => {
                  setWarningModal({ show: false, message: "", isFinal: false });
                  isAlertingRef.current = false;
                }}
                className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition-all"
              >
                I Understand, Continue Quiz
              </button>
            )}
          </div>
        </div>
      )}

      {/* Pre-Warning Banner */}
      {preWarning && !warningModal.show && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 bg-amber-500 text-black font-bold px-6 py-3 rounded-full shadow-2xl shadow-amber-500/20 flex items-center gap-2 animate-fade-in">
          <AlertTriangle className="w-5 h-5" />
          {preWarning}
        </div>
      )}

      {/* Figma Top Header */}
      <header className="py-3 px-4 lg:px-8 bg-[#141724] border-b border-[#212638] flex flex-wrap items-center justify-between shrink-0 shadow-md gap-2">
        <h1 className="text-lg lg:text-2xl font-black text-white tracking-tight font-[family-name:var(--font-display)] truncate max-w-[200px] sm:max-w-none">
          {quiz?.title || "Proctored Exam"}
        </h1>

        <div className="flex items-center gap-3 lg:gap-6">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-emerald-400">AI Monitoring Active</span>
          </div>

          <div className="px-3 lg:px-6 py-1.5 lg:py-2 bg-[#1b1e2e] border border-[#2d334d] rounded-2xl text-lg lg:text-2xl font-bold font-mono text-amber-400 shadow-md tracking-wider">
            {formatTime(timeLeft)}
          </div>

          <button
            onClick={submitQuiz}
            disabled={isSubmitting || loadingQuiz || !!quizError}
            className="px-4 lg:px-6 py-2 lg:py-2.5 bg-gradient-to-r from-red-900/60 to-rose-900/60 border border-rose-700/50 hover:bg-rose-800 text-rose-200 font-bold text-xs lg:text-sm rounded-xl transition-all shadow-md disabled:opacity-50"
          >
            {isSubmitting ? "Submitting..." : "Submit Exam"}
          </button>
        </div>
      </header>

      {/* Top-level hidden canvas for universal snapshot captures */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Figma Main Content Area */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden p-3 lg:p-6 gap-4 lg:gap-6 max-h-none lg:max-h-[calc(100vh-80px)]">
        
        {/* MOBILE ONLY: Compact Sticky Proctoring Bar */}
        <div className="block lg:hidden bg-[#141724] border border-[#212638] rounded-2xl p-3 space-y-3 shrink-0 shadow-md">
          <div className="flex items-center justify-between gap-3">
            {/* Small Floating Camera Box */}
            <div className="w-28 h-20 bg-black rounded-xl overflow-hidden relative border border-emerald-500/40 shrink-0">
              <video ref={mobileVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/80 rounded text-[8px] font-bold text-emerald-400">
                LIVE AI
              </div>
            </div>

            {/* Quick Status Badges */}
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

          <button
            onClick={() => setShowMobileDetails(!showMobileDetails)}
            className="w-full py-1.5 text-xs font-bold text-slate-300 bg-[#1b1f33] hover:bg-[#232844] rounded-lg border border-[#2a304e] transition-colors"
          >
            {showMobileDetails ? "▲ Hide AI Radar & Diagnostics" : "▼ View Full AI Radar & Diagnostics"}
          </button>

          {/* Collapsible Diagnostics for Mobile */}
          {showMobileDetails && (
            <div className="space-y-3 pt-2 border-t border-[#212638] animate-fade-in">
              {/* Radar */}
              <div className="flex flex-col items-center justify-center p-2 bg-[#0a0c13] rounded-xl border border-emerald-500/20">
                <div className="text-[10px] font-bold text-slate-400 mb-1">HEAD DIRECTION RADAR</div>
                <div className="relative w-32 h-32 rounded-full border border-emerald-500/30 bg-[#0a0c13] flex items-center justify-center my-1">
                  <div className="absolute w-20 h-20 rounded-full border border-emerald-500/20" />
                  <div className="absolute w-full h-[1px] bg-emerald-500/20" />
                  <div className="absolute h-full w-[1px] bg-emerald-500/20" />
                  <div
                    className={`absolute w-3 h-3 rounded-full border-2 border-white transform -translate-x-1/2 -translate-y-1/2 ${
                      gazeStatus.includes("✓") ? "bg-emerald-400" : "bg-red-500 animate-pulse"
                    }`}
                    style={{ left: `${headPos.x}%`, top: `${headPos.y}%` }}
                  />
                </div>
              </div>

              {/* AI Logs */}
              <div className="space-y-1 text-xs">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Recent AI Logs</div>
                {aiLogs.slice(0, 3).map((log) => (
                  <div key={log.id} className="flex items-center justify-between text-[11px]">
                    <span className={log.isError ? "text-red-400 font-bold" : "text-slate-300"}>{log.text}</span>
                    <span className="text-slate-500">{log.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* DESKTOP ONLY: Left Column Side Panel */}
        <div className="hidden lg:flex w-80 flex-col gap-4 overflow-y-auto shrink-0 pr-1">
          
          {/* 1. WEBCAM FEED CARD (Natural 4:3 Aspect Ratio) */}
          <div className="bg-[#141724] border-2 border-emerald-500/50 rounded-2xl p-2 relative aspect-[4/3] w-full flex items-center justify-center shadow-lg overflow-hidden shrink-0">
            {!cameraActive && <p className="text-xs text-slate-400 animate-pulse">Initializing Camera...</p>}
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover rounded-xl" />
            <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none rounded-xl z-10" />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1 bg-black/75 backdrop-blur-sm rounded-full text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Live - AI Active
            </div>
          </div>

          {/* 2. HEAD DIRECTION RADAR CARD */}
          <div className="bg-[#141724] border border-[#212638] rounded-2xl p-4 flex flex-col items-center justify-center relative shadow-md">
            <div className="w-full text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">
              HEAD DIRECTION
            </div>
            
            {/* Compass Radar Circle */}
            <div className="relative w-40 h-40 rounded-full border border-emerald-500/30 bg-[#0a0c13] flex items-center justify-center my-2 shadow-inner">
              <div className="absolute w-28 h-28 rounded-full border border-emerald-500/20" />
              <div className="absolute w-16 h-16 rounded-full border border-emerald-500/20" />
              <div className="absolute w-full h-[1px] bg-emerald-500/20" />
              <div className="absolute h-full w-[1px] bg-emerald-500/20" />

              {/* Direction Labels */}
              <span className="absolute top-1.5 text-[9px] font-bold text-slate-400 tracking-widest">UP</span>
              <span className="absolute bottom-1.5 text-[9px] font-bold text-slate-400 tracking-widest">DOWN</span>
              <span className="absolute left-2.5 text-[9px] font-bold text-slate-400">L</span>
              <span className="absolute right-2.5 text-[9px] font-bold text-slate-400">R</span>

              {/* Live Head Tracking Dot */}
              <div
                className={`absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow-[0_0_12px_rgba(52,211,153,0.9)] transition-all duration-150 transform -translate-x-1/2 -translate-y-1/2 ${
                  gazeStatus.includes("✓") ? "bg-emerald-400" : "bg-red-500 animate-pulse"
                }`}
                style={{ left: `${headPos.x}%`, top: `${headPos.y}%` }}
              />
            </div>

            {/* Subtext Status */}
            <div className="mt-1 text-center">
              <span className={`text-xs font-bold ${gazeStatus.includes("✓") ? "text-emerald-400" : "text-red-400 font-extrabold"}`}>
                {gazeStatus.includes("✓") ? "CENTER ✓" : gazeStatus.toUpperCase()}
              </span>
            </div>
          </div>

          {/* 3. FACE, DEVICE & AUDIO STATUS CARD */}
          <div className="bg-[#141724] border border-[#212638] rounded-2xl p-4 space-y-3 shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <div className={`text-sm font-bold ${faceStatus.includes("✓") ? "text-emerald-400" : "text-red-400"}`}>
                  {faceStatus.includes("✓") ? "Face Detected" : "Face Not Detected"}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">Monitoring Active</div>
              </div>
              <div className={`w-3 h-3 rounded-full ${faceStatus.includes("✓") ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
            </div>

            <div className="pt-2 border-t border-[#212638] flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">Device Scan</span>
              <span className={`text-xs font-bold ${deviceStatus.includes("✓") ? "text-emerald-400" : "text-red-400 font-extrabold animate-pulse"}`}>
                {deviceStatus}
              </span>
            </div>

            <div className="pt-2 border-t border-[#212638] space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Audio Level</span>
                <span className={`font-bold font-mono text-[11px] ${audioLevel > 35 ? "text-red-400 font-extrabold" : "text-emerald-400"}`}>
                  {audioLevel}%
                </span>
              </div>
              <div className="w-full h-2 bg-[#1c2032] rounded-full overflow-hidden border border-[#2b314a]">
                <div
                  className={`h-full transition-all duration-150 ${audioLevel > 35 ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" : "bg-emerald-400"}`}
                  style={{ width: `${audioLevel}%` }}
                />
              </div>
            </div>
          </div>

          {/* 4. VIOLATIONS (X/3) CARD */}
          <div className="bg-[#141724] border border-[#212638] rounded-2xl p-4 shadow-md">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              VIOLATIONS ({violationCount}/3)
            </div>
            <div className="grid grid-cols-3 gap-3 mb-2">
              {[1, 2, 3].map((num) => (
                <div
                  key={num}
                  className={`h-14 rounded-xl border flex items-center justify-center text-xl font-black transition-all ${
                    num <= violationCount
                      ? "bg-red-600/90 border-red-500 text-white shadow-lg shadow-red-600/30 animate-pulse"
                      : "bg-[#1c2032] border-[#2b314a] text-slate-500"
                  }`}
                >
                  {num}
                </div>
              ))}
            </div>
            <div className="text-xs text-slate-400 text-center mt-2">
              {violationCount === 0 ? "No violations yet." : `${violationCount} violation(s) recorded.`}
            </div>
          </div>

          {/* 5. AI LOG PANEL */}
          <div className="bg-[#141724] border border-[#212638] rounded-2xl p-4 flex-1 shadow-md min-h-[140px]">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              AI LOG
            </div>
            <div className="space-y-2 text-xs">
              {aiLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between">
                  <span className={`font-semibold ${log.isError ? "text-red-400 font-bold" : "text-red-500"}`}>
                    {log.text}
                  </span>
                  <span className="text-slate-500 text-[10px]">{log.time}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* QUESTIONS STACK: Full width on mobile, right column on desktop */}
        <div className="w-full flex-1 bg-[#141724] border border-[#212638] rounded-2xl p-4 lg:p-6 overflow-y-visible lg:overflow-y-auto shadow-lg space-y-6">
          {loadingQuiz ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p>Loading questions...</p>
            </div>
          ) : quizError ? (
            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center text-red-400">
              <p className="font-bold text-lg mb-2">Error</p>
              <p>{quizError}</p>
            </div>
          ) : questions.length === 0 ? (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-6 text-center text-amber-500">
              <p className="font-bold text-lg mb-2">No Questions Available</p>
              <p>No questions have been configured for this assessment.</p>
            </div>
          ) : (
            questions.map((q, qi) => (
              <div key={q.id} className="bg-[#1b1f33] border border-[#2a304e] rounded-2xl p-6 shadow-md space-y-4">
                <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
                  QUESTION {qi + 1} OF {questions.length}
                </div>
                <h3 className="text-base font-bold text-white leading-snug">
                  {q.questionText}
                </h3>

                <div className="space-y-3 pt-2">
                  {q.choices.map((choice: any, ci: number) => {
                    const optionLetter = String.fromCharCode(65 + ci);
                    const isSelected = answersState[q.id] === choice.id;

                    return (
                      <div
                        key={choice.id}
                        onClick={() => handleSelectChoice(q.id, choice.id)}
                        className={`flex items-center gap-4 p-3.5 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? "bg-[#252b48] border-indigo-500 shadow-md shadow-indigo-500/10"
                            : "bg-[#151829] border-[#252b44] hover:bg-[#1f243c] hover:border-indigo-500/50"
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 transition-all ${
                            isSelected
                              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                              : "bg-[#232842] text-slate-400"
                          }`}
                        >
                          {optionLetter}
                        </div>
                        <span className={`text-sm font-medium ${isSelected ? "text-white font-semibold" : "text-slate-300"}`}>
                          {choice.choiceText}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}

function ShieldIcon(props: any) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
