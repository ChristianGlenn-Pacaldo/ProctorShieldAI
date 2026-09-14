"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  Search,
  Sparkles,
  Camera,
  Upload,
  Trash,
  Check,
  Crown,
  Shield,
  Pencil,
  Swords,
  Layers,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FREE_STUDENT_LIMIT_PER_QUIZ, PRO_STUDENT_LIMIT_PER_QUIZ } from "@/lib/subscription-rules";
import ProctorShieldQuizEditor, { QuizFormData } from "@/components/teacher/proctorshield-quiz-editor";
import ProctorShieldCreateHub from "@/components/teacher/proctorshield-create-hub";

interface TeacherQuizzesPageProps {
  isSubscribed?: boolean;
  initialManualQuizCount?: number;
  initialManualQuizLimit?: number;
  teacherName?: string;
}

export default function TeacherQuizzesPage({
  isSubscribed: initialIsSubscribed = false,
  initialManualQuizCount = 0,
  initialManualQuizLimit = 5,
  teacherName = "Teacher",
}: TeacherQuizzesPageProps) {
  const router = useRouter();
  const [portalMounted, setPortalMounted] = useState(false);
  useEffect(() => {
    setPortalMounted(true);
  }, []);
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // ProctorShield Studio State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingQuizData, setEditingQuizData] = useState<Partial<QuizFormData> | null>(null);

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
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Quick Manage Quiz Modal State
  const [manageQuiz, setManageQuiz] = useState<any | null>(null);
  const [manageQuizDetails, setManageQuizDetails] = useState<any>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Pending Retake Requests State
  const [pendingRetakes, setPendingRetakes] = useState<any[]>([]);

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
  }, [initialManualQuizLimit]);

  // Stop camera helper
  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  };

  // Webcam stream lifecycle
  useEffect(() => {
    if (isAiModalOpen && activeTab === "webcam" && !capturedImage) {
      navigator.mediaDevices
        .getUserMedia({ video: { width: 640, height: 480 }, audio: false })
        .then((s) => {
          setStream(s);
          if (videoRef.current) {
            videoRef.current.srcObject = s;
          }
        })
        .catch((err) => {
          console.error("Error accessing camera:", err);
        });
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isAiModalOpen, activeTab, capturedImage]);

  // Load quiz details when managing a quiz
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
            questions: data.questions,
          });
        }
      } catch (err) {
        console.error("Failed to fetch quiz details:", err);
      }
    };
    fetchDetails();
  }, [manageQuiz]);

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

  useEffect(() => {
    fetchQuizzes();
  }, []);

  // Handle URL query parameters (e.g. ?create=true or ?ai=true)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("create") === "true" || params.get("new") === "true") {
        openNewQuizStudio();
        const url = new URL(window.location.href);
        url.searchParams.delete("create");
        url.searchParams.delete("new");
        window.history.replaceState({}, "", url.pathname);
      } else if (params.get("ai") === "true") {
        if (!isSubscribed) {
          setUpgradeReason("ai");
          setShowBillingModal(true);
        } else {
          setIsAiModalOpen(true);
        }
        const url = new URL(window.location.href);
        url.searchParams.delete("ai");
        window.history.replaceState({}, "", url.pathname);
      }
    }
  }, [isSubscribed, manualQuizCount, manualQuizLimit]);

  const openNewQuizStudio = () => {
    if (!isSubscribed && manualQuizCount >= manualQuizLimit) {
      setUpgradeReason("quiz_limit");
      setShowBillingModal(true);
      return;
    }
    setEditingQuizData(null);
    setIsEditorOpen(true);
  };

  // Open Quiz in ProctorShield Studio (Overview & Question Editor)
  const handleEditQuizInStudio = async (quiz: any) => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/quizzes/${quiz.id}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setEditingQuizData({
          id: data.quiz.id,
          title: data.quiz.title,
          subjectName: data.quiz.subject?.subjectName || data.quiz.subjectName || "General",
          description: data.quiz.description || "",
          duration: data.quiz.duration || 60,
          passingScore: data.quiz.passingScore || 70,
          shuffleQuestions: data.quiz.shuffleQuestions ?? true,
          allowRetake: data.quiz.allowRetake ?? true,
          isGamified: data.quiz.isGamified ?? true,
          questions: (data.questions || []).map((q: any) => ({
            id: q.id,
            questionText: q.questionText,
            questionType: q.questionType || "multiple_choice",
            points: q.points || 1,
            timeLimitSeconds: q.timeLimitSeconds || 30,
            explanation: q.explanation || "",
            choices: (q.choices || []).map((c: any) => ({
              id: c.id,
              choiceText: c.choiceText,
              isCorrect: Boolean(c.isCorrect),
            })),
          })),
        });
        setIsEditorOpen(true);
      } else {
        alert(data.error || "Failed to load quiz details");
      }
    } catch (err) {
      console.error("Failed to load quiz details:", err);
      alert("Failed to load quiz details for editing.");
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

  const toggleQuizStatus = async (quiz: any) => {
    setIsUpdatingStatus(true);
    const newStatus = quiz.quizStatus === "active" ? "draft" : "active";
    try {
      const res = await fetch(`/api/quizzes/${quiz.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizStatus: newStatus }),
      });
      if (res.ok) {
        setManageQuiz({ ...quiz, quizStatus: newStatus });
        fetchQuizzes();
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
        body: JSON.stringify({ quizStatus: "ended" }),
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
        body: JSON.stringify({ duration: durationInt }),
      });
      if (res.ok) {
        setManageQuiz({ ...quiz, duration: durationInt });
        fetchQuizzes();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteQuiz = async (quiz: any) => {
    if (
      !confirm(
        `Are you sure you want to permanently delete "${quiz.title}"?\n\nThis will permanently delete all questions, choices, student attempts, and violation evidence associated with it. This action cannot be undone.`
      )
    )
      return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/quizzes/${quiz.id}`, {
        method: "DELETE",
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

    try {
      const body: any = { type: activeTab, questionCount: 5 };

      if (activeTab === "text") {
        if (!aiTopic.trim()) {
          alert("Please enter a topic or paste text.");
          setIsAiGenerating(false);
          return;
        }
        body.textPrompt = aiTopic.trim();
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
        body: JSON.stringify(body),
      });

      if (res.status === 403) {
        if (
          confirm(
            "You need an active ProctorShield Pro subscription to use this feature.\n\nClick OK to upgrade your plan via GCash or Card."
          )
        ) {
          window.location.href = "/dashboard/teacher/billing";
        }
        setIsAiGenerating(false);
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || "AI generation failed");
      }

      const displayTopic =
        activeTab === "text"
          ? aiTopic
          : activeTab === "upload"
          ? "Uploaded Document"
          : "Captured Document";

      setEditingQuizData({
        title: data.detectedTitle || `AI Assessment - ${displayTopic.slice(0, 30)}`,
        subjectName: data.detectedSubject || (activeTab === "text" ? aiTopic.slice(0, 30) : "General"),
        description:
          data.detectedDescription ||
          `This quiz was auto-generated by ProctorShield AI based on: ${displayTopic}.`,
        duration: 60,
        passingScore: 70,
        shuffleQuestions: true,
        allowRetake: true,
        isGamified: true,
        questions: (data.questions || []).map((q: any) => ({
          questionText: q.questionText,
          questionType: q.questionType || "multiple_choice",
          points: q.points || 1,
          timeLimitSeconds: 30,
          explanation: q.explanation || "",
          choices: (q.choices || []).map((c: any) => ({
            choiceText: c.choiceText,
            isCorrect: Boolean(c.isCorrect),
          })),
        })),
      });

      setIsAiModalOpen(false);
      setIsEditorOpen(true);

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

  const filtered = quizzes.filter((e) => e.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      {/* ─────────────────────────────────────────────────────────────
          1. PROCTORSHIELD ACTIVITY CREATION HUB
      ───────────────────────────────────────────────────────────── */}
      <ProctorShieldCreateHub
        teacherName={teacherName}
        isSubscribed={isSubscribed}
        onOpenCreateQuiz={openNewQuizStudio}
        onOpenAiGenerator={() => {
          if (!isSubscribed) {
            setUpgradeReason("ai");
            setShowBillingModal(true);
            return;
          }
          setIsAiModalOpen(true);
        }}
        onOpenArena={() => {
          if (!isSubscribed) {
            setUpgradeReason("quiz_limit");
            setShowBillingModal(true);
            return;
          }
          router.push("/dashboard/teacher/playground");
        }}
        onRequirePro={(reason) => {
          setUpgradeReason(reason === "arena" ? "quiz_limit" : "ai");
          setShowBillingModal(true);
        }}
      />

      {/* ─────────────────────────────────────────────────────────────
          2. PENDING RETAKE REQUESTS BANNER
      ───────────────────────────────────────────────────────────── */}
      {pendingRetakes.length > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 shadow-xs">
          <h3 className="text-sm font-bold text-rose-500 mb-3 flex items-center gap-2 font-[family-name:var(--font-display)]">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            Pending Retake Requests ({pendingRetakes.length})
          </h3>
          <div className="space-y-2">
            {pendingRetakes.map((req) => (
              <div
                key={req.studentQuizId}
                className="flex items-center justify-between bg-[var(--surface)] p-3.5 rounded-xl border border-[var(--border)]"
              >
                <div>
                  <div className="text-sm font-bold text-[var(--ink)]">{req.studentName}</div>
                  <div className="text-xs text-[var(--muted)]">
                    Requested to retake &quot;{req.quizTitle}&quot;
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRetakeApprove(req.studentQuizId, "reject")}
                    className="px-3.5 py-1.5 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-lg transition-colors border border-red-500/20 cursor-pointer"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleRetakeApprove(req.studentQuizId, "accept")}
                    className="px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
                  >
                    Accept Retake
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          3. QUIZZES TABLE SECTION
      ───────────────────────────────────────────────────────────── */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)] flex items-center gap-2 font-[family-name:var(--font-display)]">
            <span>📝</span> My Created Quizzes
          </h3>
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-violet-500/30 text-violet-500 hover:bg-violet-500/10 transition-all cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" /> AI Create
              {!isSubscribed && <Crown className="w-3 h-3 text-amber-400" />}
            </button>

            {!isSubscribed && !isCheckingSub && (
              <span className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface2)] text-[10px] font-bold text-[var(--muted)]">
                {manualQuizCount}/{manualQuizLimit} free quizzes
              </span>
            )}

            <button
              onClick={openNewQuizStudio}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
            >
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
                  {["Quiz Title", "Subject", "Join Code", "Questions", "Students", "Status", "Actions"].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide"
                    >
                      {h}
                    </th>
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
                    <td className="px-5 py-3 text-sm text-[var(--muted)]">
                      {e.subject?.subjectName || e.subjectName || "N/A"}
                    </td>
                    <td className="px-5 py-3">
                      <code className="whitespace-nowrap px-2 py-1 bg-indigo-500/10 text-indigo-500 rounded-md font-mono font-bold text-xs">
                        {e.accessCode}
                      </code>
                    </td>
                    <td className="px-5 py-3 text-sm text-[var(--ink)]">{e.totalQuestions}</td>
                    <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)] whitespace-nowrap">
                      {e.participantCount ?? 0}/
                      {e.participantLimit ??
                        (isSubscribed ? PRO_STUDENT_LIMIT_PER_QUIZ : FREE_STUDENT_LIMIT_PER_QUIZ)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          e.quizStatus === "in_progress"
                            ? "bg-blue-500/15 text-blue-600"
                            : e.quizStatus === "active"
                            ? "bg-emerald-500/15 text-emerald-600"
                            : e.quizStatus === "ended"
                            ? "bg-red-500/15 text-red-600"
                            : e.quizStatus === "draft"
                            ? "bg-amber-500/15 text-amber-600"
                            : "bg-slate-500/15 text-slate-400"
                        }`}
                      >
                        {e.quizStatus.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {/* Edit in ProctorShield Studio (Dual Overview & 2x2 Question Studio) */}
                        <button
                          onClick={() => handleEditQuizInStudio(e)}
                          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 hover:bg-indigo-500/20 transition-all cursor-pointer"
                          title="Open in ProctorShield Question Studio"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Edit</span>
                        </button>

                        {/* Quick Manage Modal */}
                        <button
                          onClick={() => setManageQuiz(e)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface2)] hover:text-indigo-500 transition-all cursor-pointer"
                        >
                          Manage
                        </button>

                        {e.quizStatus === "active" && (
                          <button
                            onClick={async () => {
                              if (
                                !confirm(
                                  `Are you sure you want to start "${e.title}"? Students in the lobby will immediately enter the quiz.`
                                )
                              )
                                return;
                              try {
                                const res = await fetch(`/api/quizzes/${e.id}/start`, { method: "POST" });
                                if (res.ok) fetchQuizzes();
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
                          >
                            Start
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          4. PROCTORSHIELD QUIZ & QUESTION STUDIO (FULL SCREEN OVERLAY)
      ───────────────────────────────────────────────────────────── */}
      {isEditorOpen && (
        <ProctorShieldQuizEditor
          initialQuiz={editingQuizData || undefined}
          isSubscribed={isSubscribed}
          teacherName={teacherName}
          onClose={() => {
            setIsEditorOpen(false);
            setEditingQuizData(null);
          }}
          onSaveSuccess={() => {
            setIsEditorOpen(false);
            setEditingQuizData(null);
            fetchQuizzes();
          }}
          onOpenAiGenerator={() => {
            if (!isSubscribed) {
              setUpgradeReason("ai");
              setShowBillingModal(true);
            } else {
              setIsAiModalOpen(true);
            }
          }}
        />
      )}

      {/* ─────────────────────────────────────────────────────────────
          5. QUICK MANAGE QUIZ MODAL
      ───────────────────────────────────────────────────────────── */}
      {manageQuiz && portalMounted && createPortal(
        <div
          className="app-modal-backdrop bg-black/80 backdrop-blur-md"
          onClick={(e) => {
            if (e.target === e.currentTarget) setManageQuiz(null);
          }}
        >
          <div
            className="app-modal-panel min-h-0 bg-[var(--surface)] border border-[var(--border)] rounded-2xl max-w-2xl shadow-2xl overflow-hidden flex flex-col animate-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface2)] px-4 py-3 sm:px-6 sm:py-4">
              <h2 className="text-base sm:text-lg font-bold text-[var(--ink)] flex items-center gap-2">
                <span>⚙️</span> Manage: {manageQuiz.title}
              </h2>
              <button
                type="button"
                onClick={() => setManageQuiz(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="border border-[var(--border)] rounded-xl p-3">
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase">Questions</div>
                  <div className="text-lg font-semibold text-[var(--ink)]">{manageQuiz.totalQuestions}</div>
                  <div className="text-[10px] text-[var(--muted)] mt-1">Total items in test</div>
                </div>

                <div className="border border-[var(--border)] rounded-xl p-3">
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase">Duration (mins)</div>
                  <input
                    type="number"
                    min="1"
                    defaultValue={manageQuiz.duration}
                    onBlur={(e) => updateQuizDuration(manageQuiz, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        updateQuizDuration(manageQuiz, (e.target as HTMLInputElement).value);
                      }
                    }}
                    className="w-full mt-1 px-2 py-0.5 border border-[var(--border)] rounded bg-[var(--surface2)] text-base font-semibold text-[var(--ink)] focus:outline-none focus:border-indigo-500"
                  />
                  <div className="text-[10px] text-[var(--muted)] mt-1">Press Enter to save</div>
                </div>

                <div className="border border-[var(--border)] rounded-xl p-3">
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase">Student Capacity</div>
                  <div className="text-lg font-semibold text-[var(--ink)]">
                    {manageQuiz.participantCount ?? 0}/
                    {manageQuiz.participantLimit ??
                      (isSubscribed ? PRO_STUDENT_LIMIT_PER_QUIZ : FREE_STUDENT_LIMIT_PER_QUIZ)}
                  </div>
                  <div className="text-[10px] text-[var(--muted)] mt-1">Enrolled students</div>
                </div>
              </div>

              {/* Edit full quiz in ProctorShield Studio CTA */}
              <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-indigo-500">ProctorShield Question Studio</div>
                  <div className="text-[11px] text-[var(--muted)] mt-0.5">
                    Edit questions, 2x2 color answers, time limits, and preview
                  </div>
                </div>
                <button
                  onClick={() => {
                    const q = manageQuiz;
                    setManageQuiz(null);
                    handleEditQuizInStudio(q);
                  }}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Pencil className="w-3.5 h-3.5" /> Open Studio
                </button>
              </div>

              {/* Status and Actions */}
              <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-[var(--muted)] font-medium">Quiz Status:</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => toggleQuizStatus(manageQuiz)}
                    disabled={isUpdatingStatus || ["in_progress", "ended"].includes(manageQuiz.quizStatus)}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      manageQuiz.quizStatus === "active"
                        ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                        : "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                    } disabled:opacity-50`}
                  >
                    {isUpdatingStatus
                      ? "Updating..."
                      : manageQuiz.quizStatus === "active"
                      ? "Set to Draft"
                      : manageQuiz.quizStatus === "ended"
                      ? "Ended"
                      : manageQuiz.quizStatus === "in_progress"
                      ? "In Progress"
                      : "Make Active"}
                  </button>
                  <button
                    onClick={() => endQuiz(manageQuiz)}
                    disabled={isUpdatingStatus || manageQuiz.quizStatus === "ended"}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    End Quiz
                  </button>
                </div>
              </div>

              <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 text-xs font-semibold text-[var(--ink)] cursor-pointer">
                Allow student retake requests
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

            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface2)] p-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                onClick={() => deleteQuiz(manageQuiz)}
                disabled={isDeleting}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-red-600/20 transition-all hover:bg-red-500 disabled:opacity-50 sm:w-auto cursor-pointer"
              >
                <Trash className="w-3.5 h-3.5" /> {isDeleting ? "Deleting..." : "Delete Quiz"}
              </button>
              <button
                onClick={() => setManageQuiz(null)}
                className="w-full px-5 py-2 bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] rounded-lg font-bold text-sm hover:bg-[var(--surface2)] transition-colors sm:w-auto cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ─────────────────────────────────────────────────────────────
          6. AI AUTO-GENERATE MODAL
      ───────────────────────────────────────────────────────────── */}
      {isAiModalOpen && portalMounted && createPortal(
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
            className="app-modal-panel relative flex min-h-0 max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl animate-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-50 pointer-events-none" />

            <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface2)] px-4 py-3 sm:px-6 sm:py-4">
              <h2 className="min-w-0 text-base font-bold text-[var(--ink)] flex items-center gap-2 sm:text-lg">
                <Sparkles className="w-5 h-5 text-purple-500" /> Auto-Generate with ProctorShield AI
              </h2>
              <button
                onClick={() => {
                  setIsAiModalOpen(false);
                  stopCamera();
                }}
                className="text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAiGenerate} className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4">
              <div className="flex border-b border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setActiveTab("text")}
                  className={`pb-2 text-xs sm:text-sm font-semibold flex-1 border-b-2 transition-colors cursor-pointer ${
                    activeTab === "text"
                      ? "border-purple-500 text-purple-600 dark:text-purple-400"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  Prompt / Text
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("upload")}
                  className={`pb-2 text-xs sm:text-sm font-semibold flex-1 border-b-2 transition-colors cursor-pointer ${
                    activeTab === "upload"
                      ? "border-purple-500 text-purple-600 dark:text-purple-400"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  Upload File/Image
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("webcam")}
                  className={`pb-2 text-xs sm:text-sm font-semibold flex-1 border-b-2 transition-colors cursor-pointer ${
                    activeTab === "webcam"
                      ? "border-purple-500 text-purple-600 dark:text-purple-400"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  Webcam Scan
                </button>
              </div>

              {activeTab === "text" && (
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-[var(--ink)]">
                    Topic or Reference Notes *
                  </label>
                  <textarea
                    required
                    value={aiTopic}
                    onChange={(e) => setAiTopic(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--surface2)] border border-[var(--border)] rounded-lg text-sm text-[var(--ink)] focus:outline-none focus:border-purple-500 min-h-[100px]"
                    placeholder="e.g. Advanced Data Structures, Binary Trees, and Big-O Notation..."
                  />
                </div>
              )}

              {activeTab === "upload" && (
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-[var(--ink)]">
                    Upload Exam / Document Image *
                  </label>
                  {!uploadedImage ? (
                    <div className="border-2 border-dashed border-[var(--border)] hover:border-purple-500/50 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer relative bg-[var(--surface2)]">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                      <Upload className="w-8 h-8 text-[var(--muted)] mb-2" />
                      <span className="text-xs text-[var(--muted)] text-center">
                        Drag &amp; drop or click to upload exam or notes image
                      </span>
                    </div>
                  ) : (
                    <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-black/40 p-2">
                      <img
                        src={uploadedImage}
                        alt="Uploaded preview"
                        className="w-full max-h-[180px] object-contain rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => setUploadedImage(null)}
                        className="absolute top-4 right-4 bg-red-500/90 text-white p-1.5 rounded-lg hover:bg-red-600 transition-colors shadow-lg cursor-pointer"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "webcam" && (
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-[var(--ink)]">
                    Capture Exam Paper from Webcam *
                  </label>
                  {!capturedImage ? (
                    <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-black aspect-video flex items-center justify-center">
                      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={handleCapture}
                        className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-lg shadow-purple-600/30 transition-all cursor-pointer"
                      >
                        <Camera className="w-4 h-4" /> Capture Photo
                      </button>
                    </div>
                  ) : (
                    <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-black/40 p-2">
                      <img
                        src={capturedImage}
                        alt="Captured preview"
                        className="w-full max-h-[180px] object-contain rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => setCapturedImage(null)}
                        className="absolute top-4 right-4 bg-red-500/90 text-white p-1.5 rounded-lg hover:bg-red-600 transition-colors shadow-lg cursor-pointer"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              </div>

              <div className="shrink-0 flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface2)] p-4 sm:flex-row sm:gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsAiModalOpen(false);
                    stopCamera();
                  }}
                  className="flex-1 py-2 rounded-lg font-semibold text-sm border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface2)] transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAiGenerating}
                  className="flex-1 py-2 rounded-lg font-semibold text-sm bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:opacity-90 transition-all shadow-lg shadow-purple-600/20 disabled:opacity-50 flex justify-center items-center gap-2 cursor-pointer"
                >
                  {isAiGenerating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Analyzing Document...
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
        </div>,
        document.body
      )}

      {/* ─────────────────────────────────────────────────────────────
          7. BILLING / PRO UPGRADE MODAL
      ───────────────────────────────────────────────────────────── */}
      {showBillingModal && portalMounted && createPortal(
        <div
          className="app-modal-backdrop bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowBillingModal(false);
          }}
        >
          <div
            className="app-modal-panel relative flex min-h-0 max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/10 via-violet-600/10 to-amber-500/5 pointer-events-none" />

            <div className="relative z-10 min-h-0 flex-1 overflow-y-auto p-5 text-center sm:p-8">
              <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-xl shadow-amber-500/20">
                <Crown className="w-8 h-8 text-white" />
              </div>

              <h2 className="text-xl font-extrabold text-[var(--ink)] mb-2">
                {upgradeReason === "quiz_limit" ? "Free Quiz Limit Reached" : "ProctorShield Pro Feature"}
              </h2>
              <p className="text-sm text-[var(--muted)] leading-relaxed mb-6">
                {upgradeReason === "quiz_limit"
                  ? `Your Free plan includes ${manualQuizLimit} lifetime manual quizzes, and all ${manualQuizLimit} have been used. Upgrade for unlimited quizzes.`
                  : "AI Quiz Generation is a Pro feature. Upgrade your plan to unlock AI-powered quiz creation, live monitoring, and ProctorShield Arena."}
              </p>

              <div className="space-y-2.5 text-left mb-6 bg-[var(--surface2)] rounded-xl p-4 border border-[var(--border)]">
                {[
                  "AI Quiz Generation (Gemini AI)",
                  "Real-time Live Monitoring",
                  "Evidence Replay & Timeline",
                  "AI Verdict Reports",
                  "Unlimited Quizzes",
                  `Up to ${PRO_STUDENT_LIMIT_PER_QUIZ} Students per Quiz`,
                  "ProctorShield Arena Multiplayer",
                ].map((feat) => (
                  <div key={feat} className="flex items-center gap-2 text-xs">
                    <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span className="text-[var(--ink)] font-medium">{feat}</span>
                  </div>
                ))}
              </div>

              <div className="text-center mb-5">
                <span className="text-3xl font-extrabold text-[var(--ink)]">₱500</span>
                <span className="text-sm text-[var(--muted)]">/month</span>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
                <button
                  onClick={() => setShowBillingModal(false)}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface2)] transition-all cursor-pointer"
                >
                  Maybe Later
                </button>
                <Link
                  href="/dashboard/teacher/billing"
                  className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:opacity-90 transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Crown className="w-4 h-4" /> Upgrade Now
                </Link>
              </div>

              <div className="flex items-center justify-center gap-1.5 mt-4 text-[10px] text-[var(--muted)]">
                <Shield className="w-3 h-3" />
                Secured by PayMongo · GCash &amp; Card accepted
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
