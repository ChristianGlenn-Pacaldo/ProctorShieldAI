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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const violationCountRef = useRef(0); // track count without re-render dependency issues
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isReportingRef = useRef(false);
  const isAlertingRef = useRef(false);
  const [warningModal, setWarningModal] = useState({ show: false, message: "", isFinal: false });
  const [preWarning, setPreWarning] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const [quiz, setQuiz] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loadingQuiz, setLoadingQuiz] = useState(true);
  const [quizError, setQuizError] = useState("");
  const [answersState, setAnswersState] = useState<Record<number, number>>({});
  const [studentQuizStatus, setStudentQuizStatus] = useState<string>("");
  const [studentQuizId, setStudentQuizId] = useState<number | null>(null);
  const [userId, setUserId] = useState<string>("");

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
      pusherClient = new Pusher.default(process.env.NEXT_PUBLIC_PUSHER_KEY || "fb3c896eec50e6435f08", {
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
    if (!videoRef.current || !canvasRef.current) return null;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    // Good quality for AI analysis AND teacher viewing
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 640, 480);
    return canvas.toDataURL("image/jpeg", 0.85);
  }, []);

  // ── Report violation to server (with 3-strike auto-termination) ──
  const reportViolation = useCallback(async (type: string) => {
    if (isReportingRef.current) return;
    isReportingRef.current = true;

    const newCount = violationCountRef.current + 1;
    violationCountRef.current = newCount;
    setViolationCount(newCount);

    try {
      const snapshot = captureSnapshot();

      await fetch("/api/live/violation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId,
          violationType: type,
          confidenceScore: 100,
          snapshot: snapshot || undefined,
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

  // ── Upload snapshot to server (separate from Pusher) ──
  const uploadSnapshot = useCallback(async () => {
    const snapshot = captureSnapshot();
    if (!snapshot) return;
    try {
      await fetch("/api/live/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot, quizId }),
      });
    } catch (err) {
      console.error("Snapshot upload failed:", err);
    }
  }, [captureSnapshot, quizId]);

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

    let snapshotInterval: NodeJS.Timeout;
    let aiInterval: NodeJS.Timeout;
    let cocoInterval: NodeJS.Timeout;
    let audioInterval: NodeJS.Timeout;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let microphone: MediaStreamAudioSourceNode | null = null;

    const startMedia = async () => {
      try {
        // Try getting both video and audio
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: true,
        });
        return { stream, audioActive: true };
      } catch (err) {
        console.warn("Failed to get audio stream, falling back to video only:", err);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: false,
          });
          return { stream, audioActive: false };
        } catch (videoErr) {
          throw videoErr;
        }
      }
    };

    let faceApiInterval: NodeJS.Timeout;
    
    startMedia()
      .then(async ({ stream, audioActive }) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraActive(true);
        }

        // Notify teacher once (lightweight)
        setTimeout(() => notifyTeacherJoined(), 1500);

        // Upload snapshots every 1 second for teacher live view
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

          // Run face tracking every 500ms
          faceApiInterval = setInterval(async () => {
            if (!videoRef.current || isAlertingRef.current || isReportingRef.current || violationCountRef.current >= 3) return;
            
            const detections = await faceapi.detectAllFaces(
              videoRef.current,
              new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
            ).withFaceLandmarks();
            
            if (detections.length === 0) {
              noFaceFrames++;
              if (noFaceFrames > 6) { // 3 seconds
                reportViolation("no_face");
                noFaceFrames = 0;
              }
              setFaceStatus("Not Detected ✗");
            } else if (detections.length > 1) {
              multipleFacesFrames++;
              if (multipleFacesFrames > 4) { // 2 seconds
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
              const leftEye = landmarks.getLeftEye()[0];
              const rightEye = landmarks.getRightEye()[3];
              const noseBottom = landmarks.getNose()[3]; // Tip of the nose
              
              // Jaw sides don't move when shouting, so they are safe for Left/Right
              const jawline = landmarks.getJawOutline();
              const leftJaw = jawline[0];
              const rightJaw = jawline[16];
              
              const faceWidth = rightJaw.x - leftJaw.x;
              const noseRatioX = (noseBottom.x - leftJaw.x) / faceWidth;
              
              // For Up/Down, use Eye-to-Nose distance normalized by Eye-to-Eye distance!
              // This completely ignores the bottom jaw, so shouting will NOT affect it.
              const eyeCenterY = (leftEye.y + rightEye.y) / 2;
              const eyeDistance = rightEye.x - leftEye.x;
              const noseLength = noseBottom.y - eyeCenterY;
              const pitchRatio = noseLength / eyeDistance;
              
              let direction = "Focused ✓";
              let violationReason = "";
              
              if (noseRatioX < 0.35) {
                direction = "Looking Right ✗";
                violationReason = "looking_right";
              } else if (noseRatioX > 0.65) {
                direction = "Looking Left ✗";
                violationReason = "looking_left";
              } else if (pitchRatio < 0.45) {
                direction = "Looking Up ✗";
                violationReason = "looking_up";
              } else if (pitchRatio > 0.95) {
                direction = "Looking Down ✗";
                violationReason = "looking_down";
              }
              
              setGazeStatus(direction);
              
              if (direction !== "Focused ✓") {
                lookingAwayFrames++;
                if (lookingAwayFrames === 3) {
                  // Trigger Pre-warning
                  setPreWarning(`Please look directly at the screen. (${direction.replace(' ✗', '')})`);
                }
                if (lookingAwayFrames > 8) { // ~4 seconds
                  reportViolation(violationReason);
                  lookingAwayFrames = 0;
                  setPreWarning(null);
                }
              } else {
                lookingAwayFrames = 0;
                setPreWarning(null);
              }
            }
          }, 500);

          // ── COCO-SSD Object Detection ──
          cocoInterval = setInterval(async () => {
            if (!videoRef.current || isAlertingRef.current || isReportingRef.current || violationCountRef.current >= 3) return;
            const predictions = await cocoModel.detect(videoRef.current);
            const phoneDetected = predictions.some(p => p.class === "cell phone" && p.score > 0.5);
            
            if (phoneDetected) {
              phoneDetectedFrames++;
              setDeviceStatus("Phone Detected ✗");
              if (phoneDetectedFrames === 1) {
                setPreWarning("Unauthorized device (phone) detected in frame. Remove it immediately.");
              }
              if (phoneDetectedFrames >= 3) { // ~9 seconds total
                reportViolation("device_detected");
                phoneDetectedFrames = 0;
                setPreWarning(null);
              }
            } else {
              phoneDetectedFrames = 0;
              setDeviceStatus("None ✓");
            }
          }, 3000);

        } catch (err) {
          console.error("Failed to load face-api:", err);
        }

        // Run Gemini AI analysis every 25 seconds for Device Detection only (so we avoid rate limits)
        setTimeout(() => {
          analyzeFrame(); // First analysis after 5 seconds
          aiInterval = setInterval(() => {
            if (violationCountRef.current < 3) {
              analyzeFrame();
            }
          }, 25000);
        }, 5000);

        // Set up client-side audio analysis
        if (audioActive) {
          try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            audioContext = new AudioContextClass();
            analyser = audioContext.createAnalyser();
            microphone = audioContext.createMediaStreamSource(stream);
            microphone.connect(analyser);
            analyser.fftSize = 256;

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            let violationConsecutiveCount = 0;

            audioInterval = setInterval(() => {
              if (violationCountRef.current >= 3 || isAlertingRef.current || isReportingRef.current) return;
              if (!analyser) return;

              analyser.getByteTimeDomainData(dataArray);
              let sum = 0;
              for (let i = 0; i < bufferLength; i++) {
                const float = (dataArray[i] - 128) / 128;
                sum += float * float;
              }
              const rms = Math.sqrt(sum / bufferLength);

              // RMS threshold of 0.05 indicates speech/noise.
              setAudioLevel(Math.min(100, Math.floor(rms * 1000)));
              
              if (rms > 0.05) {
                violationConsecutiveCount++;
                if (violationConsecutiveCount === 3) {
                  setPreWarning("Audio anomaly detected. Please remain quiet.");
                }
                if (violationConsecutiveCount >= 6) { // sustained for 3 seconds
                  reportViolation("audio_anomaly");
                  violationConsecutiveCount = 0;
                  setPreWarning(null);
                }
              } else {
                if (violationConsecutiveCount > 0) {
                  violationConsecutiveCount--;
                  if (violationConsecutiveCount < 3) setPreWarning(null);
                }
              }
            }, 500);
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

  // ── Anti-Cheat Event Listeners ──
  useEffect(() => {
    if (!hasStarted) return;

    const handleVisibilityChange = () => {
      if (document.hidden && violationCountRef.current < 3 && !isAlertingRef.current && !isReportingRef.current) {
        reportViolation("tab_switch");
      }
    };

    const handleWindowBlur = () => {
      if (violationCountRef.current < 3 && !isAlertingRef.current && !isReportingRef.current) {
        reportViolation("tab_switch");
      }
    };

    const handleResize = () => {
      if (violationCountRef.current < 3 && !isAlertingRef.current && !isReportingRef.current) {
        reportViolation("window_resize");
      }
    };

    const preventCopy = (e: ClipboardEvent) => {
      e.preventDefault();
    };

    const preventContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const preventShortcuts = (e: KeyboardEvent) => {
      if (
        e.key === "PrintScreen" ||
        (e.ctrlKey && (e.key === "c" || e.key === "v" || e.key === "p" || e.key === "s")) ||
        e.key === "F12"
      ) {
        e.preventDefault();
        if (violationCountRef.current < 3 && !isAlertingRef.current && !isReportingRef.current) {
          reportViolation("attempted_screenshot");
        }
      }
    };

    // Block text selection
    const preventSelect = (e: Event) => e.preventDefault();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("resize", handleResize);
    document.addEventListener("copy", preventCopy);
    document.addEventListener("cut", preventCopy as any);
    document.addEventListener("contextmenu", preventContextMenu);
    document.addEventListener("keydown", preventShortcuts);
    document.addEventListener("selectstart", preventSelect);

    return () => {
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
                <p className="flex items-center gap-2 text-red-400 mt-4 pt-4 border-t border-gray-800"><AlertTriangle className="w-4 h-4 shrink-0" /> Quiz will auto-terminate after 3 violations.</p>
              </div>
              {studentQuizStatus === "pending_approval" ? (
                <button disabled className="w-full py-3 bg-amber-600/50 text-white font-bold rounded-xl flex items-center justify-center gap-2 opacity-80 cursor-not-allowed">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Waiting for Teacher Approval...
                </button>
              ) : quiz?.quizStatus === "active" ? (
                <button disabled className="w-full py-3 bg-indigo-600/50 text-white font-bold rounded-xl flex items-center justify-center gap-2 opacity-80 cursor-not-allowed">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Waiting for Teacher to Start...
                </button>
              ) : (
                <button
                  onClick={() => setHasStarted(true)}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/20"
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

  // ─── ACTIVE QUIZ SCREEN ──────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col md:flex-row">
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
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-amber-500 text-black font-bold px-6 py-3 rounded-full shadow-2xl shadow-amber-500/20 flex items-center gap-2 animate-fade-in">
          <AlertTriangle className="w-5 h-5" />
          {preWarning}
        </div>
      )}

      {/* LEFT: Quiz Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          <div className="flex justify-between items-center mb-8 pb-4 border-b border-gray-800">
            <div>
              <h1 className="text-2xl font-bold">{quiz?.title || "Active Quiz"}</h1>
              <p className="text-gray-400 text-sm">{quiz?.subject?.subjectName || "Loading..."}</p>
            </div>
            <div className="text-right">
              <div className={`text-xl font-mono ${timeLeft < 300 ? 'text-red-400 animate-pulse' : 'text-indigo-400'}`}>
                {formatTime(timeLeft)}
              </div>
              <p className="text-xs text-gray-500 uppercase font-bold tracking-widest">Time Remaining</p>
            </div>
          </div>

          {/* Dynamic Questions */}
          {loadingQuiz ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
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
              <div key={q.id} className="bg-[#111] p-6 rounded-2xl border border-gray-800 mb-4 animate-fade-in">
                <h3 className="font-semibold text-lg mb-4">{qi + 1}. {q.questionText}</h3>
                <div className="space-y-3">
                  {q.choices.map((choice: any) => (
                    <label 
                      key={choice.id} 
                      className={`flex items-center p-3 rounded-xl border cursor-pointer transition-all ${
                        answersState[q.id] === choice.id 
                          ? 'border-indigo-500 bg-indigo-500/10' 
                          : 'border-gray-800 hover:border-indigo-500/50 hover:bg-indigo-500/5'
                      }`}
                    >
                      <input 
                        type="radio" 
                        name={`q-${q.id}`} 
                        checked={answersState[q.id] === choice.id}
                        onChange={() => handleSelectChoice(q.id, choice.id)}
                        className="text-indigo-500 bg-black border-gray-700 mr-3 focus:ring-0" 
                      />
                      <span className="text-sm">{choice.choiceText}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}

          <div className="flex justify-end mt-8 pb-8">
            <button
              onClick={submitQuiz}
              disabled={isSubmitting || loadingQuiz || !!quizError}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50"
            >
              {isSubmitting ? "Submitting..." : "Submit Quiz"}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT: Proctor Sidebar */}
      <div className="w-full md:w-80 bg-[#111] border-l border-gray-800 flex flex-col h-screen shrink-0">
        <div className="p-4 border-b border-gray-800 flex items-center gap-2">
          <ShieldIcon className="w-5 h-5 text-indigo-500" />
          <h2 className="font-bold text-sm">ProctorShield AI</h2>
          <div className="ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-500">CONNECTED</span>
          </div>
        </div>

        {/* Webcam View */}
        <div className="p-4">
          <div className="relative rounded-xl overflow-hidden border-2 border-gray-800 bg-black aspect-video flex items-center justify-center">
            {!cameraActive && <p className="text-xs text-gray-500 animate-pulse">Initializing Camera...</p>}
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 bg-black/60 backdrop-blur-sm rounded text-[10px] font-bold text-emerald-400">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> REC
            </div>
          </div>
        </div>

        {/* AI Diagnostics — Real Data from Gemini */}
        <div className="p-4 flex-1 overflow-y-auto">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">AI Diagnostics (Gemini Vision)</h3>

          <div className="space-y-2 mb-6">
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-400">Face Detection</span>
              <span className={`font-bold ${faceStatus.includes("✓") ? "text-emerald-500" : "text-red-500"}`}>{faceStatus}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-400">Gaze Tracking</span>
              <span className={`font-bold ${gazeStatus.includes("✓") ? "text-emerald-500" : "text-red-500"}`}>{gazeStatus}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-400">Device Scan</span>
              <span className={`font-bold ${deviceStatus.includes("✓") ? "text-emerald-500" : "text-red-500"}`}>{deviceStatus}</span>
            </div>
            <div className="flex justify-between items-center text-xs pt-2 border-t border-gray-800">
              <span className="text-gray-400">Audio Level</span>
              <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-300 ${audioLevel > 50 ? 'bg-red-500' : 'bg-emerald-500'}`} 
                  style={{ width: `${audioLevel}%` }} 
                />
              </div>
            </div>
            <div className="flex justify-between items-center text-xs pt-2 border-t border-gray-800">
              <span className="text-gray-400">AI Status</span>
              <span className={`font-bold ${aiStatus === "All Clear" ? "text-emerald-500" : aiStatus === "Initializing..." ? "text-gray-500" : "text-red-500"}`}>{aiStatus}</span>
            </div>
          </div>

          {/* Violation Counter */}
          <div className={`p-3 rounded-xl mb-6 ${violationCount > 0 ? 'bg-red-500/10 border border-red-500/20' : 'bg-emerald-500/10 border border-emerald-500/20'}`}>
            <div className={`flex items-center gap-2 font-bold text-xs mb-1 ${violationCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {violationCount > 0 ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
              {violationCount > 0 ? `Violations (${violationCount}/3)` : "No Violations"}
            </div>
            <div className="flex gap-1">
              {[1, 2, 3].map(i => (
                <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= violationCount ? 'bg-red-500' : 'bg-gray-800'}`} />
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="pt-4 border-t border-gray-800">
            <p className="text-[10px] text-gray-500 text-center leading-relaxed">
              Gemini Vision AI is analyzing your webcam every 20 seconds. Tab switching, copy, and PrintScreen are automatically detected in real-time.
            </p>
          </div>
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
