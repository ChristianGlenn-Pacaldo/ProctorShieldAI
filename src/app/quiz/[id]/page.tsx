"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, AlertTriangle, CheckCircle } from "lucide-react";

export default function QuizRoom() {
  const params = useParams();
  const examId = params.id as string;
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

  // Dynamic Exam States
  const [exam, setExam] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loadingQuiz, setLoadingQuiz] = useState(true);
  const [quizError, setQuizError] = useState("");
  const [answersState, setAnswersState] = useState<Record<number, number>>({});

  useEffect(() => {
    const loadQuiz = async () => {
      try {
        const res = await fetch(`/api/exams/${examId}`);
        const data = await res.json();
        if (res.ok && data.success) {
          setExam(data.exam);
          setQuestions(data.questions);
          if (data.exam.duration) {
            setTimeLeft(data.exam.duration * 60);
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
  }, [examId]);

  const handleSelectChoice = (questionId: number, choiceId: number) => {
    setAnswersState(prev => ({
      ...prev,
      [questionId]: choiceId
    }));
  };

  // ── Submit exam to backend ────────────────────────────
  const submitExam = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const payloadAnswers = Object.entries(answersState).map(([qId, cId]) => ({
        questionId: parseInt(qId),
        choiceId: cId
      }));

      await fetch("/api/exams/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examId, answers: payloadAnswers }),
      });
    } catch (err) {
      console.error("Failed to submit exam:", err);
    } finally {
      router.push("/dashboard/student");
    }
  }, [examId, router, isSubmitting, answersState]);

  // ── Capture webcam snapshot as base64 ──────────────────
  const captureSnapshot = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    // Good quality for AI analysis AND teacher viewing
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 320, 240);
    return canvas.toDataURL("image/jpeg", 0.7);
  }, []);

  // ── Report violation to server (with 3-strike auto-termination) ──
  const reportViolation = useCallback(async (type: string) => {
    const newCount = violationCountRef.current + 1;
    violationCountRef.current = newCount;
    setViolationCount(newCount);

    try {
      const snapshot = captureSnapshot();

      await fetch("/api/live/violation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examId,
          violationType: type,
          confidenceScore: 100,
          snapshot: snapshot || undefined,
        }),
      });

      if (newCount === 1) {
        alert("⚠️ WARNING (1/3): Violation detected — " + type.replace(/_/g, " ") + ". Continuing this behavior will terminate your exam.");
      } else if (newCount === 2) {
        alert("⚠️ WARNING (2/3): Second violation — " + type.replace(/_/g, " ") + ". One more violation and your exam will be automatically submitted.");
      } else if (newCount >= 3) {
        alert("🚫 FINAL (3/3): Maximum violations reached. Your exam is being automatically terminated and submitted.");
        submitExam();
      }
    } catch (err) {
      console.error("Failed to report violation:", err);
    }
  }, [examId, submitExam, captureSnapshot]);

  // ── Notify teacher that student joined (lightweight, no image) ──
  const notifyTeacherJoined = useCallback(async () => {
    try {
      await fetch("/api/live/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examId }),
      });
    } catch (err) {
      console.error("Failed to notify teacher:", err);
    }
  }, [examId]);

  // ── Upload snapshot to server (separate from Pusher) ──
  const uploadSnapshot = useCallback(async () => {
    const snapshot = captureSnapshot();
    if (!snapshot) return;
    try {
      await fetch("/api/live/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot, examId }),
      });
    } catch (err) {
      console.error("Snapshot upload failed:", err);
    }
  }, [captureSnapshot, examId]);

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

      // Update AI diagnostic display
      if (violations.length === 0) {
        setAiStatus("All Clear");
        setFaceStatus("Detected ✓");
        setGazeStatus("Focused ✓");
        setDeviceStatus("None ✓");
      } else {
        setAiStatus("⚠ Issue Detected");
        if (violations.includes("no_face")) setFaceStatus("Not Detected ✗");
        else if (violations.includes("multiple_faces")) setFaceStatus("Multiple ✗");
        else setFaceStatus("Detected ✓");

        if (violations.includes("looking_away")) setGazeStatus("Looking Away ✗");
        else setGazeStatus("Focused ✓");

        if (violations.includes("device_detected")) setDeviceStatus("Phone Found ✗");
        else setDeviceStatus("None ✓");
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

    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480 }, audio: false })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraActive(true);
        }

        // Notify teacher once (lightweight)
        setTimeout(() => notifyTeacherJoined(), 1500);

        // Upload snapshots every 3 seconds for teacher live view
        snapshotInterval = setInterval(() => {
          uploadSnapshot();
        }, 3000);

        // Run AI analysis every 20 seconds (to stay within Gemini free tier rate limits)
        setTimeout(() => {
          analyzeFrame(); // First analysis after 5 seconds
          aiInterval = setInterval(() => {
            if (violationCountRef.current < 3) {
              analyzeFrame();
            }
          }, 20000);
        }, 5000);
      })
      .catch((err) => {
        console.error("Camera access denied:", err);
        alert("You must allow camera access to take this exam.");
      });

    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((track) => track.stop());
      }
      if (snapshotInterval) clearInterval(snapshotInterval);
      if (aiInterval) clearInterval(aiInterval);
    };
  }, [hasStarted, notifyTeacherJoined, uploadSnapshot, analyzeFrame]);

  // ── Countdown Timer ──
  useEffect(() => {
    if (!hasStarted) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          submitExam();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [hasStarted, submitExam]);

  // ── Anti-Cheat Event Listeners ──
  useEffect(() => {
    if (!hasStarted) return;

    const handleVisibilityChange = () => {
      if (document.hidden && violationCountRef.current < 3) {
        reportViolation("tab_switch");
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
        if (violationCountRef.current < 3) {
          reportViolation("attempted_screenshot");
        }
      }
    };

    // Block text selection
    const preventSelect = (e: Event) => e.preventDefault();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("copy", preventCopy);
    document.addEventListener("cut", preventCopy as any);
    document.addEventListener("contextmenu", preventContextMenu);
    document.addEventListener("keydown", preventShortcuts);
    document.addEventListener("selectstart", preventSelect);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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
              <p>Loading exam configuration...</p>
            </div>
          ) : quizError ? (
            <div className="py-10 text-red-400 space-y-4">
              <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
              <p className="font-bold text-lg">Failed to Load Exam</p>
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
              <h1 className="text-2xl font-bold text-white mb-2">{exam?.title || "Proctoring Initialization"}</h1>
              <p className="text-indigo-400 font-semibold mb-2">{exam?.subject?.subjectName}</p>
              <p className="text-gray-400 mb-8 text-sm leading-relaxed">
                {exam?.description || "This exam is monitored by ProctorShield AI. Your camera and screen activity will be recorded and analyzed in real-time."}
              </p>
              <div className="space-y-3 text-left mb-8 bg-[#1a1a1a] p-4 rounded-xl text-xs text-gray-300">
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Do not leave the browser window or switch tabs.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Copying, pasting, and screenshots are strictly prohibited.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Cellphones and other devices are not allowed in the frame.</p>
                <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> Keep your face visible and facing the screen at all times.</p>
                <p className="flex items-center gap-2 text-red-400 mt-4 pt-4 border-t border-gray-800"><AlertTriangle className="w-4 h-4 shrink-0" /> Exam will auto-terminate after 3 violations.</p>
              </div>
              <button
                onClick={() => setHasStarted(true)}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/20"
              >
                I Understand, Start Exam
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── ACTIVE EXAM SCREEN ──────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col md:flex-row">
      {/* LEFT: Exam Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          <div className="flex justify-between items-center mb-8 pb-4 border-b border-gray-800">
            <div>
              <h1 className="text-2xl font-bold">{exam?.title || "Active Exam"}</h1>
              <p className="text-gray-400 text-sm">{exam?.subject?.subjectName || "Loading..."}</p>
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
              onClick={submitExam}
              disabled={isSubmitting || loadingQuiz || !!quizError}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50"
            >
              {isSubmitting ? "Submitting..." : "Submit Exam"}
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
