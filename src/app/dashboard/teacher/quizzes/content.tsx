"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Search, Sparkles, Camera, Upload, Trash, Check, Crown, Shield } from "lucide-react";
import Link from "next/link";

interface TeacherQuizzesPageProps {
  isSubscribed?: boolean;
  initialManualQuizCount?: number;
  initialManualQuizLimit?: number;
}

export default function TeacherQuizzesPage({
  isSubscribed: initialIsSubscribed = false,
  initialManualQuizCount = 0,
  initialManualQuizLimit = 5,
}: TeacherQuizzesPageProps) {
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Quiz Creation Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [newQuizForm, setNewQuizForm] = useState({
    title: "",
    subjectName: "",
    description: "",
    duration: 60,
    totalQuestions: 10,
    shuffleQuestions: true,
    allowRetake: true,
    isGamified: true,
  });

  // Subscription Gating State
  const [isSubscribed, setIsSubscribed] = useState(initialIsSubscribed);
  const [manualQuizCount, setManualQuizCount] = useState(initialManualQuizCount);
  const [manualQuizLimit, setManualQuizLimit] = useState(initialManualQuizLimit);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<"ai" | "quiz_limit">("ai");
  const [isCheckingSub, setIsCheckingSub] = useState(true);

  // AI Modal State
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<"text" | "upload" | "webcam">("text");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [aiGeneratedQuestions, setAiGeneratedQuestions] = useState<any[]>([]);
  const [creationSource, setCreationSource] = useState<"manual" | "ai">("manual");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Manage Quiz Modal State
  const [manageQuiz, setManageQuiz] = useState<any | null>(null);
  const [manageQuizDetails, setManageQuizDetails] = useState<any>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Check subscription status on mount
  useEffect(() => {
    const checkSub = async () => {
      try {
        const res = await fetch("/api/billing/status");
        if (res.ok) {
          const data = await res.json();
          setIsSubscribed(data.isSubscribed);
          setManualQuizCount(data.manualQuizCount ?? 0);
          setManualQuizLimit(data.manualQuizLimit ?? initialManualQuizLimit);
        }
      } catch (err) {
        console.error("Subscription check failed:", err);
      } finally {
        setIsCheckingSub(false);
      }
    };
    checkSub();
  }, []);

  // Stop camera helper
  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  // Webcam stream lifecycle
  useEffect(() => {
    if (isAiModalOpen && activeTab === "webcam" && !capturedImage) {
      navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
        .then(s => {
          setStream(s);
          if (videoRef.current) {
            videoRef.current.srcObject = s;
          }
        })
        .catch(err => {
          console.error("Error accessing camera:", err);
        });
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isAiModalOpen, activeTab, capturedImage]);

  // Load quiz details (questions/choices) when managing an quiz
  useEffect(() => {
    if (!manageQuiz) {
      setManageQuizDetails(null);
      return;
    }
    const fetchDetails = async () => {
      try {
        const res = await fetch(`/api/quizzes/${manageQuiz.id}`);
        const data = await res.json();
        if (res.ok && data.success) {
          setManageQuizDetails({
            ...data.quiz,
            questions: data.questions
          });
        }
      } catch (err) {
        console.error("Failed to fetch quiz details:", err);
      }
    };
    fetchDetails();
  }, [manageQuiz]);

  const toggleQuizStatus = async (quiz: any) => {
    setIsUpdatingStatus(true);
    const newStatus = quiz.quizStatus === "active" ? "draft" : "active";
    try {
      const res = await fetch(`/api/quizzes/${quiz.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizStatus: newStatus })
      });
      if (res.ok) {
        setManageQuiz({ ...quiz, quizStatus: newStatus });
        fetchQuizzes(); // refresh list
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const endQuiz = async (quiz: any) => {
    if (!confirm("Are you sure you want to end this quiz? Students will no longer be able to join.")) return;
    setIsUpdatingStatus(true);
    try {
      const res = await fetch(`/api/quizzes/${quiz.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizStatus: "ended" })
      });
      if (res.ok) {
        setManageQuiz({ ...quiz, quizStatus: "ended" });
        fetchQuizzes();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const updateQuizDuration = async (quiz: any, newDuration: string) => {
    const durationInt = parseInt(newDuration);
    if (isNaN(durationInt) || durationInt === quiz.duration || durationInt < 1) return;
    try {
      const res = await fetch(`/api/quizzes/${quiz.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: durationInt })
      });
      if (res.ok) {
        setManageQuiz({ ...quiz, duration: durationInt });
        fetchQuizzes(); // refresh list
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteQuiz = async (quiz: any) => {
    if (!confirm(`Are you sure you want to permanently delete "${quiz.title}"?\n\nThis will permanently delete all questions, choices, student attempts, and violation evidence associated with it. This action cannot be undone.`)) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/quizzes/${quiz.id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setManageQuiz(null);
        fetchQuizzes();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete quiz");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to delete quiz. Please check your connection.");
    } finally {
      setIsDeleting(false);
    }
  };

  const addManualQuestion = () => {
    setAiGeneratedQuestions([
      ...aiGeneratedQuestions,
      {
        questionText: "",
        questionType: "multiple_choice",
        points: 1,
        choices: [
          { choiceText: "", isCorrect: true },
          { choiceText: "", isCorrect: false },
          { choiceText: "", isCorrect: false },
          { choiceText: "", isCorrect: false }
        ]
      }
    ]);
  };

  const updateQuestionText = (index: number, text: string) => {
    const updated = [...aiGeneratedQuestions];
    updated[index].questionText = text;
    setAiGeneratedQuestions(updated);
  };

  const updateChoiceText = (qIndex: number, cIndex: number, text: string) => {
    const updated = [...aiGeneratedQuestions];
    updated[qIndex].choices[cIndex].choiceText = text;
    setAiGeneratedQuestions(updated);
  };

  const setCorrectChoice = (qIndex: number, cIndex: number) => {
    const updated = [...aiGeneratedQuestions];
    updated[qIndex].choices = updated[qIndex].choices.map((c: any, idx: number) => ({
      ...c,
      isCorrect: idx === cIndex
    }));
    setAiGeneratedQuestions(updated);
  };

  const removeQuestion = (index: number) => {
    const updated = aiGeneratedQuestions.filter((_, idx) => idx !== index);
    setAiGeneratedQuestions(updated);
  };

  const openNewQuizModal = () => {
    if (!isSubscribed && manualQuizCount >= manualQuizLimit) {
      setUpgradeReason("quiz_limit");
      setShowBillingModal(true);
      return;
    }
    setCreationSource("manual");
    setAiGeneratedQuestions([
      {
        questionText: "",
        questionType: "multiple_choice",
        points: 1,
        choices: [
          { choiceText: "", isCorrect: true },
          { choiceText: "", isCorrect: false },
          { choiceText: "", isCorrect: false },
          { choiceText: "", isCorrect: false }
        ]
      }
    ]);
    setNewQuizForm({
      title: "",
      subjectName: "",
      description: "",
      duration: 60,
      totalQuestions: 1,
      shuffleQuestions: true,
      allowRetake: true,
      isGamified: true,
    });
    setCreateError("");
    setIsCreateModalOpen(true);
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("new") === "true") {
        openNewQuizModal();
        const url = new URL(window.location.href);
        url.searchParams.delete("new");
        window.history.replaceState({}, "", url.pathname);
      }
    }
  }, []);

  const handleCapture = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, 640, 480);
      const base64 = canvas.toDataURL("image/jpeg", 0.85);
      setCapturedImage(base64);
      stopCamera();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setUploadedImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const splitBase64 = (dataUrl: string) => {
    const parts = dataUrl.split(",");
    const mime = parts[0].match(/:(.*?);/)?.[1] || "image/jpeg";
    const raw = parts[1];
    return { mime, raw };
  };

  const handleAiGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAiGenerating(true);
    setCreateError("");

    try {
      const body: any = { numQuestions: 10 };
      if (activeTab === "text") {
        if (!aiTopic) {
          alert("Please enter a topic.");
          setIsAiGenerating(false);
          return;
        }
        body.topic = aiTopic;
      } else if (activeTab === "upload") {
        if (!uploadedImage) {
          alert("Please upload an image.");
          setIsAiGenerating(false);
          return;
        }
        const { mime, raw } = splitBase64(uploadedImage);
        body.imageBase64 = raw;
        body.mimeType = mime;
      } else if (activeTab === "webcam") {
        if (!capturedImage) {
          alert("Please capture an image.");
          setIsAiGenerating(false);
          return;
        }
        const { mime, raw } = splitBase64(capturedImage);
        body.imageBase64 = raw;
        body.mimeType = mime;
      }

      const res = await fetch("/api/ai/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (res.status === 403) {
        if (confirm("You need an active ProctorShield AI Pro subscription to use this feature.\n\nClick OK to upgrade your plan via GCash or Card.")) {
          window.location.href = "/dashboard/teacher/billing";
        }
        setIsAiGenerating(false);
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || "AI generation failed");
      }

      setAiGeneratedQuestions(data.questions);
      setCreationSource("ai");

      const displayTopic = activeTab === "text" ? aiTopic : (activeTab === "upload" ? "Uploaded Document" : "Captured Document");
      setNewQuizForm({
        title: data.detectedTitle || `AI Assessment - ${displayTopic.slice(0, 30)}`,
        subjectName: data.detectedSubject || (activeTab === "text" ? aiTopic.slice(0, 30) : "AI Generated"),
        description: data.detectedDescription || `This quiz was auto-generated by ProctorShield AI based on: ${displayTopic}.`,
        duration: 60,
        totalQuestions: data.questions.length,
        shuffleQuestions: true,
        allowRetake: true,
        isGamified: true,
      });

      setIsAiModalOpen(false);
      setIsCreateModalOpen(true);

      // Reset inputs
      setAiTopic("");
      setUploadedImage(null);
      setCapturedImage(null);
      setActiveTab("text");
    } catch (err: any) {
      console.error(err);
      alert(err.message || "An error occurred while generating questions");
    } finally {
      setIsAiGenerating(false);
    }
  };

  const [pendingRetakes, setPendingRetakes] = useState<any[]>([]);

  const fetchQuizzes = async () => {
    try {
      const res = await fetch("/api/quizzes");
      if (res.ok) {
        const data = await res.json();
        setQuizzes(data.quizzes || []);
        setPendingRetakes(data.pendingRetakes || []);
        if (data.entitlements) {
          setIsSubscribed(data.entitlements.isSubscribed);
          setManualQuizCount(data.entitlements.manualQuizCount ?? 0);
          setManualQuizLimit(data.entitlements.manualQuizLimit ?? initialManualQuizLimit);
        }
      }
    } catch (error) {
      console.error("Failed to fetch quizzes", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetakeApprove = async (studentQuizId: number, action: "accept" | "reject") => {
    try {
      const res = await fetch("/api/quizzes/retake/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentQuizId, action }),
      });
      if (res.ok) {
        setPendingRetakes((prev) => prev.filter((p) => p.studentQuizId !== studentQuizId));
        fetchQuizzes();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Fetch quizzes from our backend API
  useEffect(() => {
    fetchQuizzes();
  }, []);

  const handleCreateQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setIsCreating(true);

    try {
      const res = await fetch("/api/quizzes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newQuizForm,
          totalQuestions: aiGeneratedQuestions.length,
          questions: aiGeneratedQuestions,
          isAiGenerated: creationSource === "ai",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.entitlements) {
          setIsSubscribed(data.entitlements.isSubscribed);
          setManualQuizCount(data.entitlements.manualQuizCount ?? manualQuizCount);
          setManualQuizLimit(data.entitlements.manualQuizLimit ?? manualQuizLimit);
        }
        if (data.code === "FREE_QUIZ_LIMIT_REACHED" || data.code === "SUBSCRIPTION_REQUIRED") {
          setUpgradeReason(data.code === "FREE_QUIZ_LIMIT_REACHED" ? "quiz_limit" : "ai");
          setIsCreateModalOpen(false);
          setShowBillingModal(true);
        }
        setCreateError(data.details || data.message || data.error || "Failed to create quiz");
        setIsCreating(false);
        return;
      }

      // Success! Close modal, reset form, refresh quizzes
      setIsCreateModalOpen(false);
      setAiGeneratedQuestions([]);
      setCreationSource("manual");
      if (data.entitlements) {
        setIsSubscribed(data.entitlements.isSubscribed);
        setManualQuizCount(data.entitlements.manualQuizCount ?? manualQuizCount);
        setManualQuizLimit(data.entitlements.manualQuizLimit ?? manualQuizLimit);
      }
      setNewQuizForm({
        title: "",
        subjectName: "",
        description: "",
        duration: 60,
        totalQuestions: 10,
        shuffleQuestions: true,
        allowRetake: true,
        isGamified: true,
      });
      fetchQuizzes();
    } catch (err) {
      setCreateError("Network error. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const filtered = quizzes.filter((e) => e.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      {/* Pending Retake Requests Banner */}
      {pendingRetakes.length > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 shadow-xs">
          <h3 className="text-sm font-bold text-rose-500 mb-3 flex items-center gap-2 font-[family-name:var(--font-display)]">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            Pending Retake Requests ({pendingRetakes.length})
          </h3>
          <div className="space-y-2">
            {pendingRetakes.map((req) => (
              <div key={req.studentQuizId} className="flex items-center justify-between bg-[var(--surface)] p-3.5 rounded-xl border border-[var(--border)]">
                <div>
                  <div className="text-sm font-bold text-[var(--ink)]">{req.studentName}</div>
                  <div className="text-xs text-[var(--muted)]">Requested to retake &quot;{req.quizTitle}&quot;</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRetakeApprove(req.studentQuizId, "reject")}
                    className="px-3.5 py-1.5 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-lg transition-colors border border-red-500/20"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleRetakeApprove(req.studentQuizId, "accept")}
                    className="px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-all shadow-md shadow-indigo-600/20"
                  >
                    Accept Retake
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">📝 My Created Quizzes</h3>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
            <div className="relative w-full sm:w-auto">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search quizzes..."
                className="w-full sm:w-48 pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <button
              onClick={() => {
                if (!isSubscribed) {
                  setUpgradeReason("ai");
                  setShowBillingModal(true);
                  return;
                }
                setIsAiModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-violet-500/30 text-violet-500 hover:bg-violet-500/10 transition-all">
              <Sparkles className="w-3.5 h-3.5" /> AI Create
              {!isSubscribed && <Crown className="w-3 h-3 text-amber-400" />}
            </button>
            {!isSubscribed && !isCheckingSub && (
              <span className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface2)] text-[10px] font-bold text-[var(--muted)]">
                {manualQuizCount}/{manualQuizLimit} free quizzes
              </span>
            )}
            <button
              onClick={openNewQuizModal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-all">
              <Plus className="w-3.5 h-3.5" /> {isSubscribed ? "New Quiz" : "Manual Quiz"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto min-h-[300px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-[var(--muted)]">
              <span className="text-2xl mb-2">📄</span>
              <p className="text-sm font-semibold">No quizzes found</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Quiz Title", "Subject", "Join Code", "Questions", "Status", "Actions"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-[var(--surface2)] transition-colors">
                    <td className="px-5 py-3">
                      <div className="text-sm font-semibold text-[var(--ink)]">{e.title}</div>
                      <div className="text-xs text-[var(--muted)] mt-0.5">{e.duration} mins</div>
                    </td>
                    <td className="px-5 py-3 text-sm text-[var(--muted)]">{e.subject?.subjectName || "N/A"}</td>
                    <td className="px-5 py-3"><code className="whitespace-nowrap px-2 py-1 bg-indigo-500/10 text-indigo-500 rounded-md font-mono font-bold text-xs">{e.accessCode}</code></td>
                    <td className="px-5 py-3 text-sm text-[var(--ink)]">{e.totalQuestions}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${e.quizStatus === 'in_progress' ? 'bg-blue-500/15 text-blue-600' :
                        e.quizStatus === 'active' ? 'bg-emerald-500/15 text-emerald-600' :
                          e.quizStatus === 'ended' ? 'bg-red-500/15 text-red-600' :
                            e.quizStatus === 'draft' ? 'bg-amber-500/15 text-amber-600' :
                              'bg-slate-500/15 text-slate-400'
                        }`}>
                        {e.quizStatus.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-5 py-3 flex gap-2">
                      <button onClick={() => setManageQuiz(e)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface2)] hover:text-indigo-500 transition-all">Manage</button>
                      {e.quizStatus === 'active' && (
                        <button
                          onClick={async () => {
                            if (!confirm(`Are you sure you want to start "${e.title}"? Students in the lobby will immediately enter the quiz.`)) return;
                            try {
                              const res = await fetch(`/api/quizzes/${e.id}/start`, { method: "POST" });
                              if (res.ok) fetchQuizzes();
                            } catch (err) {
                              console.error(err);
                            }
                          }}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/20"
                        >
                          Start
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* CREATE QUIZ MODAL */}
      {isCreateModalOpen && (
        <div
          className="app-modal-backdrop bg-black/80 backdrop-blur-md"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCreateModalOpen(false);
          }}
        >
          <div
            className="app-modal-panel bg-[var(--surface)] border border-[var(--border)] rounded-2xl max-w-4xl shadow-2xl overflow-hidden flex flex-col animate-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface2)] shrink-0">
              <h2 className="text-base sm:text-lg font-bold text-[var(--ink)] flex items-center gap-2">
                <span>📝</span> Create New Quiz
              </h2>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateQuiz} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                {createError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                    {createError}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left Column: Metadata (5/12 grid span) */}
                  <div className="lg:col-span-5 space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface2)]/55 p-4 sm:p-5">
                    <h3 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">Quiz Settings</h3>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--ink)] mb-1.5">Quiz Title *</label>
                      <input required type="text" value={newQuizForm.title} onChange={e => setNewQuizForm({ ...newQuizForm, title: e.target.value })} className="w-full px-3 py-2 bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500" placeholder="e.g. Midterm Quizination" />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[var(--ink)] mb-1.5">Subject Name *</label>
                      <input required type="text" value={newQuizForm.subjectName} onChange={e => setNewQuizForm({ ...newQuizForm, subjectName: e.target.value })} className="w-full px-3 py-2 bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500" placeholder="e.g. Computer Science 101" />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[var(--ink)] mb-1.5">Description</label>
                      <textarea value={newQuizForm.description} onChange={e => setNewQuizForm({ ...newQuizForm, description: e.target.value })} className="w-full px-3 py-2 bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 min-h-[80px]" placeholder="Optional description..." />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[var(--ink)] mb-1.5">Duration (mins)</label>
                      <input required type="number" min="5" value={newQuizForm.duration} onChange={e => setNewQuizForm({ ...newQuizForm, duration: parseInt(e.target.value) })} className="w-full px-3 py-2 bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500" />
                    </div>

                    <div className="flex items-center gap-2 py-1">
                      <input
                        type="checkbox"
                        id="shuffleQuestions"
                        checked={newQuizForm.shuffleQuestions}
                        onChange={e => setNewQuizForm({ ...newQuizForm, shuffleQuestions: e.target.checked })}
                        className="w-4 h-4 rounded bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 text-indigo-600 focus:ring-0 cursor-pointer"
                      />
                      <label htmlFor="shuffleQuestions" className="text-xs font-semibold text-[var(--ink)] cursor-pointer select-none">
                        Shuffle Questions per Student
                      </label>
                    </div>

                    <div className="flex items-center gap-2 py-1">
                      <input
                        type="checkbox"
                        id="allowRetake"
                        checked={newQuizForm.allowRetake}
                        onChange={e => setNewQuizForm({ ...newQuizForm, allowRetake: e.target.checked })}
                        className="w-4 h-4 rounded bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 text-indigo-600 focus:ring-0 cursor-pointer"
                      />
                      <label htmlFor="allowRetake" className="text-xs font-semibold text-[var(--ink)] cursor-pointer select-none">
                        Allow students to request a retake
                      </label>
                    </div>

                    <div className="flex items-center gap-2 py-1 px-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                      <input
                        type="checkbox"
                        id="isGamified"
                        checked={newQuizForm.isGamified ?? true}
                        onChange={e => setNewQuizForm({ ...newQuizForm, isGamified: e.target.checked })}
                        className="w-4 h-4 rounded text-blue-600 focus:ring-0 cursor-pointer"
                      />
                      <label htmlFor="isGamified" className="text-xs font-bold text-blue-500 cursor-pointer select-none flex items-center gap-1.5 py-1">
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        ProctorShield Gamified Mode (Streaks & Power-Ups)
                      </label>
                    </div>
                  </div>

                  {/* Right Column: Questions Editor (7/12 grid span) */}
                  <div className="lg:col-span-7 flex flex-col min-h-[400px] lg:h-full rounded-2xl border border-[var(--border)] bg-[var(--surface2)]/35 p-4 sm:p-5">
                    <div className="flex justify-between items-center mb-2">
                      <h3 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">
                        Questions ({aiGeneratedQuestions.length})
                      </h3>
                      <button
                        type="button"
                        onClick={addManualQuestion}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-indigo-600 hover:bg-indigo-600/10 rounded-lg border border-indigo-600/25 transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Question
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-[300px] lg:max-h-[420px]">
                      {aiGeneratedQuestions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 border border-dashed border-[var(--border)] rounded-xl text-[var(--muted)] bg-[var(--surface2)]">
                          <span className="text-xl mb-1">📝</span>
                          <p className="text-xs font-semibold">No questions added yet</p>
                          <p className="text-[10px] text-center max-w-[200px] mt-1 text-[var(--muted2)]">
                            Use AI to generate, or click "+ Add Question" to type your own questions manually.
                          </p>
                        </div>
                      ) : (
                        aiGeneratedQuestions.map((q, qIndex) => (
                          <div key={qIndex} className="p-4 border border-[var(--border)] rounded-xl bg-[var(--surface2)] space-y-3 relative">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-extrabold text-indigo-600">Question #{qIndex + 1}</span>
                              <button
                                type="button"
                                onClick={() => removeQuestion(qIndex)}
                                className="text-[10px] font-bold text-red-500 hover:text-red-600 transition-colors flex items-center gap-0.5"
                              >
                                <Trash className="w-3 h-3" /> Remove
                              </button>
                            </div>

                            <div>
                              <input
                                required
                                type="text"
                                value={q.questionText}
                                onChange={e => updateQuestionText(qIndex, e.target.value)}
                                placeholder="Enter question text..."
                                className="w-full px-3 py-1.5 bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 rounded-lg text-xs text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
                              />
                            </div>

                            <div className="space-y-2">
                              {q.choices.map((c: any, cIndex: number) => (
                                <div key={cIndex} className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setCorrectChoice(qIndex, cIndex)}
                                    className={`w-5 h-5 rounded-full flex items-center justify-center border text-[10px] transition-all ${c.isCorrect
                                      ? 'bg-emerald-500 border-emerald-500 text-white font-bold'
                                      : 'border-gray-300 dark:border-gray-800 text-transparent hover:border-emerald-500/50'
                                      }`}
                                    title="Mark as correct choice"
                                  >
                                    ✓
                                  </button>
                                  <input
                                    required
                                    type="text"
                                    value={c.choiceText}
                                    onChange={e => updateChoiceText(qIndex, cIndex, e.target.value)}
                                    placeholder={`Choice ${String.fromCharCode(65 + cIndex)}`}
                                    className={`flex-1 px-3 py-1 bg-white dark:bg-[#111] border rounded-lg text-xs focus:outline-none transition-all ${c.isCorrect
                                      ? 'border-emerald-500 focus:border-emerald-500 text-emerald-700 dark:text-emerald-400 font-medium'
                                      : 'border-gray-300 dark:border-gray-800 focus:border-indigo-500 text-gray-900 dark:text-white'
                                      }`}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-[var(--border)] bg-[var(--surface2)] shrink-0 flex gap-3">
                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="flex-1 py-2.5 rounded-xl font-bold text-xs sm:text-sm border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface)] transition-all cursor-pointer">Cancel</button>
                <button type="submit" disabled={isCreating} className="ui-primary flex-1 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer">
                  {isCreating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Creating Quiz...
                    </>
                  ) : (
                    "Create Quiz"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI GENERATE MODAL */}
      {isAiModalOpen && (
        <div
          className="app-modal-backdrop bg-black/80 backdrop-blur-md"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsAiModalOpen(false);
              stopCamera();
            }
          }}
        >
          <div
            className="app-modal-panel bg-[var(--surface)] border border-[var(--border)] rounded-2xl max-w-lg shadow-2xl overflow-hidden relative animate-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-cyan-500/10 opacity-50 pointer-events-none" />

            <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface2)] relative z-10">
              <h2 className="text-lg font-bold text-[var(--ink)] flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-violet-500" /> Auto-Generate with AI
              </h2>
              <button
                onClick={() => { setIsAiModalOpen(false); stopCamera(); }}
                className="text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Input Selection Tabs */}
            <div className="px-6 py-2 border-b border-[var(--border)] flex gap-4 bg-[var(--surface2)] relative z-10 text-xs font-bold text-[var(--muted)]">
              <button
                type="button"
                onClick={() => { setActiveTab("text"); stopCamera(); }}
                className={`pb-2 border-b-2 transition-all flex items-center gap-1 ${activeTab === "text" ? "border-violet-500 text-violet-500 font-bold" : "border-transparent"}`}
              >
                Text Topic
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab("upload"); stopCamera(); }}
                className={`pb-2 border-b-2 transition-all flex items-center gap-1 ${activeTab === "upload" ? "border-violet-500 text-violet-500 font-bold" : "border-transparent"}`}
              >
                <Upload className="w-3.5 h-3.5" /> Upload File
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab("webcam"); }}
                className={`pb-2 border-b-2 transition-all flex items-center gap-1 ${activeTab === "webcam" ? "border-violet-500 text-violet-500 font-bold" : "border-transparent"}`}
              >
                <Camera className="w-3.5 h-3.5" /> Webcam Capture
              </button>
            </div>

            <form onSubmit={handleAiGenerate} className="p-6 space-y-4 relative z-10">
              <p className="text-xs text-[var(--muted)] mb-4 leading-relaxed">
                Provide a topic description, upload a document page, or use your webcam to capture questions. ProctorShield AI will instantly structure and generate your quiz.
              </p>

              {activeTab === "text" && (
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink)] mb-1.5">Quiz Topic / Subject *</label>
                  <textarea
                    required
                    value={aiTopic}
                    onChange={e => setAiTopic(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:border-violet-500 min-h-[100px]"
                    placeholder="e.g. Advanced Data Structures and Algorithms in Java"
                  />
                </div>
              )}

              {activeTab === "upload" && (
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-[var(--ink)]">Upload Material Image *</label>
                  {!uploadedImage ? (
                    <div className="border-2 border-dashed border-[var(--border)] hover:border-violet-500/50 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer relative bg-[var(--surface2)]">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                      <Upload className="w-8 h-8 text-[var(--muted)] mb-2" />
                      <span className="text-xs text-[var(--muted)] text-center">Drag & drop or click to upload syllabus/notes image</span>
                    </div>
                  ) : (
                    <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-black/40 p-2">
                      <img src={uploadedImage} alt="Uploaded preview" className="w-full max-h-[180px] object-contain rounded-lg" />
                      <button
                        type="button"
                        onClick={() => setUploadedImage(null)}
                        className="absolute top-4 right-4 bg-red-500/90 text-white p-1.5 rounded-lg hover:bg-red-600 transition-colors shadow-lg"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "webcam" && (
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-[var(--ink)]">Capture Material from Webcam *</label>
                  {!capturedImage ? (
                    <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-black aspect-video flex items-center justify-center">
                      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={handleCapture}
                        className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-lg shadow-violet-600/30 transition-all"
                      >
                        <Camera className="w-4 h-4" /> Capture Photo
                      </button>
                    </div>
                  ) : (
                    <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-black/40 p-2">
                      <img src={capturedImage} alt="Captured preview" className="w-full max-h-[180px] object-contain rounded-lg" />
                      <button
                        type="button"
                        onClick={() => setCapturedImage(null)}
                        className="absolute top-4 right-4 bg-red-500/90 text-white p-1.5 rounded-lg hover:bg-red-600 transition-colors shadow-lg"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setIsAiModalOpen(false); stopCamera(); }}
                  className="flex-1 py-2 rounded-lg font-semibold text-sm border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#222] transition-all"
                >
                  Cancel
                </button>
                <button type="submit" disabled={isAiGenerating} className="flex-1 py-2 rounded-lg font-semibold text-sm bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:opacity-90 transition-all shadow-lg shadow-violet-600/20 disabled:opacity-50 flex justify-center items-center gap-2">
                  {isAiGenerating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" /> Generate Magic
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {manageQuiz && (
        <div
          className="app-modal-backdrop bg-black/80 backdrop-blur-md"
          onClick={() => setManageQuiz(null)}
        >
          <div
            className="app-modal-panel bg-[var(--surface)] border border-[var(--border)] rounded-2xl max-w-md shadow-2xl overflow-hidden flex flex-col animate-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface2)] shrink-0">
              <h2 className="text-lg font-bold text-[var(--ink)]">Manage Quiz</h2>
              <button onClick={() => setManageQuiz(null)} className="p-2 -mr-2 text-[var(--muted)] hover:text-[var(--ink)] transition-colors">✕</button>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto">
              <div>
                <h3 className="text-xl font-bold text-[var(--ink)] mb-1">{manageQuiz.title}</h3>
                <p className="text-sm text-[var(--muted)]">{manageQuiz.subject?.subjectName || "No Subject"}</p>
              </div>

              <div className="bg-[var(--surface2)] border border-[var(--border)] rounded-xl p-4 flex flex-col items-center justify-center space-y-2">
                <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest">Share this code with students</span>
                <div className="flex items-center gap-3">
                  <code className="text-2xl font-mono font-bold text-indigo-500 tracking-wider">
                    {manageQuiz.accessCode}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(manageQuiz.accessCode);
                      alert("Join code copied to clipboard!");
                    }}
                    className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-500 hover:bg-indigo-400 rounded-lg transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="border border-[var(--border)] rounded-xl p-3">
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase">Questions</div>
                  <div className="text-lg font-semibold text-[var(--ink)]">{manageQuiz.totalQuestions}</div>
                </div>
                <div className="border border-[var(--border)] rounded-xl p-3">
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase mb-1">Duration (mins)</div>
                  <input
                    type="number"
                    min="1"
                    className="w-full px-2 py-1.5 bg-[var(--surface2)] border border-[var(--border)] rounded-lg text-lg font-semibold text-[var(--ink)] focus:outline-none focus:border-indigo-500 transition-colors"
                    defaultValue={manageQuiz.duration}
                    onBlur={(e) => updateQuizDuration(manageQuiz, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        updateQuizDuration(manageQuiz, e.currentTarget.value);
                        e.currentTarget.blur();
                      }
                    }}
                  />
                  <div className="text-[10px] text-[var(--muted)] mt-1">Press Enter or click away to save</div>
                </div>
              </div>

              {/* Display questions and choices with correct answer highlighted */}
              {manageQuizDetails ? (
                <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1 border-t border-[var(--border)] pt-4">
                  <h4 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider flex items-center justify-between">
                    <span>Generated Questions</span>
                    <span className="text-[10px] bg-indigo-500/10 text-indigo-500 px-2 py-0.5 rounded-full normal-case font-semibold">
                      {manageQuizDetails.shuffleQuestions ? 'Shuffled' : 'Standard'}
                    </span>
                  </h4>
                  {manageQuizDetails.questions && manageQuizDetails.questions.length > 0 ? (
                    manageQuizDetails.questions.map((q: any, qi: number) => (
                      <div key={q.id} className="p-3 bg-[var(--surface2)] border border-[var(--border)] rounded-xl text-xs space-y-1.5">
                        <div className="font-bold text-[var(--ink)]">{qi + 1}. {q.questionText}</div>
                        <div className="grid grid-cols-2 gap-2 pl-2">
                          {q.choices.map((c: any) => (
                            <div key={c.id} className={`flex items-center gap-1 ${c.isCorrect ? 'text-emerald-500 font-bold' : 'text-[var(--muted)]'}`}>
                              <span className="shrink-0">{c.isCorrect ? '✓' : '•'}</span>
                              <span className="truncate">{c.choiceText}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-[var(--muted)] italic">No questions found for this quiz.</div>
                  )}
                </div>
              ) : (
                <div className="flex justify-center py-4 border-t border-[var(--border)]">
                  <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              <div className="pt-4 border-t border-[var(--border)] flex justify-between items-center">
                <div className="text-sm text-[var(--muted)] font-medium">Quiz Status:</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleQuizStatus(manageQuiz)}
                    disabled={isUpdatingStatus || ["in_progress", "ended"].includes(manageQuiz.quizStatus)}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${manageQuiz.quizStatus === "active"
                      ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                      : "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                      } disabled:opacity-50`}
                  >
                    {isUpdatingStatus ? "Updating..." : manageQuiz.quizStatus === "active" ? "Set to Draft" : manageQuiz.quizStatus === "ended" ? "Ended" : manageQuiz.quizStatus === "in_progress" ? "In Progress" : "Make Active"}
                  </button>
                  <button
                    onClick={() => endQuiz(manageQuiz)}
                    disabled={isUpdatingStatus || manageQuiz.quizStatus === "ended"}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all disabled:opacity-50"
                  >
                    End Quiz
                  </button>
                </div>
              </div>
              <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 text-xs font-semibold text-[var(--ink)]">
                Allow retake requests
                <input
                  type="checkbox"
                  checked={manageQuiz.allowRetake === true}
                  onChange={async (event) => {
                    const allowRetake = event.target.checked;
                    const response = await fetch(`/api/quizzes/${manageQuiz.id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ allowRetake }),
                    });
                    if (response.ok) {
                      setManageQuiz({ ...manageQuiz, allowRetake });
                      void fetchQuizzes();
                    }
                  }}
                  className="h-4 w-4"
                />
              </label>
            </div>
            <div className="p-4 border-t border-[var(--border)] bg-[var(--surface2)] shrink-0 flex justify-between items-center">
              <button
                onClick={() => deleteQuiz(manageQuiz)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all shadow-md shadow-red-600/20 flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash className="w-3.5 h-3.5" /> {isDeleting ? "Deleting..." : "Delete Quiz"}
              </button>
              <button onClick={() => setManageQuiz(null)} className="px-5 py-2 bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] rounded-lg font-bold text-sm hover:bg-[var(--surface2)] transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* BILLING / SUBSCRIPTION GATE MODAL */}
      {/* BILLING / SUBSCRIPTION GATE MODAL */}
      {showBillingModal && (
        <div className="app-modal-backdrop bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="app-modal-panel bg-[var(--surface)] border border-[var(--border)] rounded-2xl max-w-md shadow-2xl overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/10 via-violet-600/10 to-amber-500/5 pointer-events-none" />

            <div className="relative z-10 p-8 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-xl shadow-amber-500/20">
                <Crown className="w-8 h-8 text-white" />
              </div>

              <h2 className="text-xl font-extrabold text-[var(--ink)] mb-2">
                {upgradeReason === "quiz_limit" ? "Free Quiz Limit Reached" : "Premium Feature"}
              </h2>
              <p className="text-sm text-[var(--muted)] leading-relaxed mb-6">
                {upgradeReason === "quiz_limit"
                  ? `Your Free plan includes ${manualQuizLimit} manual quizzes, and all ${manualQuizLimit} have been used. Upgrade for unlimited quizzes.`
                  : "AI Quiz Generation is a Premium feature. Upgrade your plan to unlock AI-powered quiz creation, live monitoring, and more."}
              </p>

              <div className="space-y-2.5 text-left mb-6 bg-[var(--surface2)] rounded-xl p-4 border border-[var(--border)]">
                {[
                  "AI Quiz Generation (Gemini AI)",
                  "Real-time Live Monitoring",
                  "Evidence Replay & Timeline",
                  "AI Verdict Reports",
                  "Unlimited Quizzes",
                ].map((feat) => (
                  <div key={feat} className="flex items-center gap-2 text-xs">
                    <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span className="text-[var(--ink)] font-medium">{feat}</span>
                  </div>
                ))}
              </div>

              <div className="text-center mb-5">
                <span className="text-3xl font-extrabold text-[var(--ink)]">₱500</span>
                <span className="text-sm text-[var(--muted)]">/year</span>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowBillingModal(false)}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface2)] transition-all"
                >
                  Maybe Later
                </button>
                <Link
                  href="/dashboard/teacher/billing"
                  className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:opacity-90 transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-1.5"
                >
                  <Crown className="w-4 h-4" /> Upgrade Now
                </Link>
              </div>

              <div className="flex items-center justify-center gap-1.5 mt-4 text-[10px] text-[var(--muted)]">
                <Shield className="w-3 h-3" />
                Secured by PayMongo · GCash & Card accepted
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
