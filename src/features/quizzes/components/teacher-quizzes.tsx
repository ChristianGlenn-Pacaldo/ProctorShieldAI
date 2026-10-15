"use client";
import { PRO_STUDENT_LIMIT_PER_QUIZ } from "@/lib/subscription-rules";
import { responseRequestId } from "@/shared/http/request-id";
import TeacherQuizLibrary from "./teacher-quiz-library";
import QuizRequestPanels from "./quiz-request-panels";
import ManageQuizDialog from "./manage-quiz-dialog";
import type { TeacherQuizSummary, PendingQuizRequest } from "../types";
import { filterTeacherQuizzes } from "../domain/teacher-quiz-library";

import { usePowerArenaEnabled } from "@/components/power-arena-feature";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { prepareQuizScan, captureQuizScan, quizScanPayload, startQuizScannerCamera, type QuizScanSource } from "@/lib/quiz-scanner";
import {
  Sparkles,
  Camera,
  Upload,
  Trash,
  Check,
  Crown,
  Shield,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProctorShieldQuizEditor, { QuizFormData } from "@/components/teacher/proctorshield-quiz-editor";
import ProctorShieldCreateHub from "@/components/teacher/proctorshield-create-hub";

interface TeacherQuizzesPageProps {
  isSubscribed?: boolean;
  initialManualQuizCount?: number;
  initialManualQuizLimit?: number;
  teacherName?: string;
}


async function actionErrorMessage(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return data.error || fallback;
}

export default function TeacherQuizzesPage({
  isSubscribed: initialIsSubscribed = false,
  initialManualQuizCount = 0,
  initialManualQuizLimit = 5,
  teacherName = "Teacher",
}: TeacherQuizzesPageProps) {
  const arenaEnabled = usePowerArenaEnabled();
  const router = useRouter();
  const [portalMounted, setPortalMounted] = useState(false);
  useEffect(() => {
    setPortalMounted(true);
  }, []);
  const [quizzes, setQuizzes] = useState<TeacherQuizSummary[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  const [aiQuestionCount, setAiQuestionCount] = useState(5);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<"upload" | "scan">("upload");
  const [scanSource, setScanSource] = useState<QuizScanSource | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isPreparingScan, setIsPreparingScan] = useState(false);
  const scanGenerationRef = useRef(0);
  const cameraCleanupRef = useRef<(() => void) | null>(null);
  const aiRequestRef = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Quick Manage Quiz Modal State
  const [manageQuiz, setManageQuiz] = useState<TeacherQuizSummary | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Pending Retake Requests State
  const [pendingRetakes, setPendingRetakes] = useState<PendingQuizRequest[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingQuizRequest[]>([]);
  const [approvalInProgressId, setApprovalInProgressId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const stopCamera = () => {
    cameraCleanupRef.current?.(); cameraCleanupRef.current = null;
  };
  const closeAiModal = () => {
    aiRequestRef.current?.abort();
    aiRequestRef.current = null;
    setIsAiModalOpen(false);
    setIsAiGenerating(false);
    stopCamera();
  };
  useEffect(() => {
    if (isAiModalOpen && activeTab === "scan" && cameraOpen && !scanSource && videoRef.current) {
      cameraCleanupRef.current = startQuizScannerCamera(videoRef.current, setScannerError);
    }
    return stopCamera;
  }, [isAiModalOpen, activeTab, cameraOpen, scanSource]);
  useEffect(() => {
    if (!isAiModalOpen) { setIsPreparingScan(false); setIsAiGenerating(false); }
    return () => {
      scanGenerationRef.current++;
      aiRequestRef.current?.abort();
      aiRequestRef.current = null;
    };
  }, [isAiModalOpen]);

  const fetchQuizzes = async () => {
    let requestId: string | null = null;
    try {
      const res = await fetch("/api/quizzes");
      requestId = responseRequestId(res);
      if (!res.ok) throw new Error(`Quizzes request failed (${res.status})`);
      const data = await res.json();
      setQuizzes(data.quizzes || []);
      setPendingRetakes(data.pendingRetakes || []);
      setPendingApprovals(data.pendingApprovals || []);
      if (data.entitlements) {
        setIsSubscribed(data.entitlements.isSubscribed);
        setManualQuizCount(data.entitlements.manualQuizCount ?? 0);
        setManualQuizLimit(data.entitlements.manualQuizLimit ?? initialManualQuizLimit);
      }
      setLoadError(null);
      return true;
    } catch {
      // Details are recorded on the server under the request ID; avoid logging private payloads.
      setLoadError("Could not load My Quizzes. Please try again." + (requestId ? ` Reference: ${requestId}` : ""));
    } finally {
      setIsLoading(false);
    }
    return false;
  };

  useEffect(() => {
    fetchQuizzes();
  }, []);

  const openNewQuizStudio = (mode: "proctored" | "arena" = "proctored") => {
    if (mode === "arena" && !isSubscribed) {
      setUpgradeReason("quiz_limit");
      setShowBillingModal(true);
      return;
    }
    if (!isSubscribed && manualQuizCount >= manualQuizLimit) {
      setUpgradeReason("quiz_limit");
      setShowBillingModal(true);
      return;
    }
    setEditingQuizData({
      title: mode === "arena" ? "Untitled Power Arena Match" : "Untitled Monitored Assessment",
      quizMode: mode,
      isGamified: mode === "arena",
      duration: mode === "arena" ? 15 : 30,
      passingScore: 70,
      shuffleQuestions: true,
      allowRetake: false,
      hasAttempts: false,
      participantCount: 0,
      quizStatus: "draft",
      questions: [],
    });
    setIsEditorOpen(true);
  };

  // Handle URL query parameters (e.g. ?create=true or ?ai=true)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const modeParam = arenaEnabled && params.get("mode") === "arena" ? "arena" : "proctored";
      if (params.get("create") === "true" || params.get("new") === "true") {
        openNewQuizStudio(modeParam);
        const url = new URL(window.location.href);
        url.searchParams.delete("create");
        url.searchParams.delete("new");
        url.searchParams.delete("mode");
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

  // Open Quiz in ProctorShield Studio (Overview & Question Editor)
  const handleEditQuizInStudio = async (quiz: TeacherQuizSummary) => {
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
          duration: data.quiz.duration ?? 60,
          passingScore: data.quiz.passingScore || 70,
          shuffleQuestions: data.quiz.shuffleQuestions ?? true,
          allowRetake: data.quiz.allowRetake ?? true,
          isGamified: data.quiz.isGamified ?? (data.quiz.quizMode === "arena"),
          quizMode: data.quiz.quizMode || "proctored",
          quizStatus: data.quiz.quizStatus || "draft",
          hasAttempts: Boolean(data.quiz.hasAttempts || (data.quiz.attemptsCount && data.quiz.attemptsCount > 0) || (quiz.participantCount && quiz.participantCount > 0)),
          participantCount: quiz.participantCount ?? 0,
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

  const handleRetakeApprove = async (studentQuizId: string, action: "accept" | "reject") => {
    setActionError(null);
    try {
      const res = await fetch("/api/quizzes/retake/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentQuizId, action }),
      });
      if (!res.ok) throw new Error(await actionErrorMessage(res, "Unable to update the retake request."));
      if (!await fetchQuizzes()) throw new Error("Decision saved, but the request list could not be refreshed. Please reload My Quizzes.");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Unable to update the retake request.");
    }
  };

  const startQuiz = async (quiz: TeacherQuizSummary) => {
    if (!confirm(`Are you sure you want to start "${quiz.title}"? Students in the lobby will immediately enter the quiz.`)) return;
    setActionError(null);
    try {
      const response = await fetch(`/api/quizzes/${quiz.id}/start`, { method: "POST" });
      if (!response.ok) throw new Error(await actionErrorMessage(response, "Unable to start the quiz."));
      await fetchQuizzes();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to start the quiz.");
    }
  };

  const handlePendingApproval = async (studentQuizId: string, action: "accept" | "reject") => {
    if (approvalInProgressId) return;
    setApprovalInProgressId(studentQuizId);
    setApprovalError(null);
    try {
      const response = await fetch("/api/quizzes/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentQuizId, action }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Unable to update the late-join request.");
      }
      if (!await fetchQuizzes()) {
        throw new Error("Decision saved, but the request list could not be refreshed. Please reload My Quizzes.");
      }
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "Unable to update the late-join request.");
    } finally {
      setApprovalInProgressId(null);
    }
  };

  const toggleQuizStatus = async (quiz: TeacherQuizSummary) => {
    setIsUpdatingStatus(true);
    setActionError(null);
    const newStatus = quiz.quizStatus === "active" ? "draft" : "active";
    try {
      const res = await fetch(`/api/quizzes/${quiz.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizStatus: newStatus }),
      });
      if (!res.ok) throw new Error(await actionErrorMessage(res, "Unable to update quiz status."));
      const data = await res.json();
      setManageQuiz({ ...quiz, quizStatus: data.quiz.quizStatus });
      void fetchQuizzes();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to update quiz status.");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const endQuiz = async (quiz: TeacherQuizSummary) => {
    if (!confirm("Are you sure you want to end this quiz? Students will no longer be able to join.")) return;
    setIsUpdatingStatus(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/quizzes/${quiz.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizStatus: "ended" }),
      });
      if (!res.ok) throw new Error(await actionErrorMessage(res, "Unable to end the quiz."));
      const data = await res.json();
      setManageQuiz({ ...quiz, quizStatus: data.quiz.quizStatus });
      void fetchQuizzes();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to end the quiz.");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const updateQuizDuration = async (quiz: TeacherQuizSummary, newDuration: string) => {
    const durationInt = Number(newDuration);
    if (!Number.isInteger(durationInt) || durationInt < 1 || durationInt > 480) {
      setActionError("Duration must be a whole number between 1 and 480 minutes.");
      return;
    }
    if (durationInt === quiz.duration) return;
    setActionError("");
    try {
      const res = await fetch(`/api/quizzes/${quiz.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: durationInt }),
      });
      if (res.ok) {
        setManageQuiz({ ...quiz, duration: durationInt });
        fetchQuizzes();
      } else {
        const data = await res.json();
        setActionError(data.error || "Unable to update quiz duration.");
      }
    } catch (err) {
      console.error(err);
      setActionError("Unable to update quiz duration. Please try again.");
    }
  };

  const updateRetakeSetting = async (quiz: TeacherQuizSummary, allowRetake: boolean) => {
    setActionError(null);
    try {
      const response = await fetch(`/api/quizzes/${quiz.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowRetake }),
      });
      if (!response.ok) throw new Error(await actionErrorMessage(response, "Unable to update retake settings."));
      const data = await response.json();
      setManageQuiz({ ...quiz, allowRetake: data.quiz.allowRetake });
      void fetchQuizzes();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update retake settings.");
    }
  };

  const deleteQuiz = async (quiz: TeacherQuizSummary) => {
    if (
      !confirm(
        `Are you sure you want to remove "${quiz.title}"?\n\nStudents will no longer see or join this quiz. Completed results and violation evidence will remain available for historical review. This action cannot be undone from the dashboard.`
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
    try { setScanSource(captureQuizScan(videoRef.current)); setScannerError(null); stopCamera(); setCameraOpen(false); }
    catch (error) { setScannerError(error instanceof Error ? error.message : "Capture failed."); }
  };
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    stopCamera(); setCameraOpen(false); setScanSource(null); setScannerError(null); setIsPreparingScan(true);
    const generation = ++scanGenerationRef.current;
    try {
      const source = await prepareQuizScan(file);
      if (generation === scanGenerationRef.current) setScanSource(source);
    } catch (error) {
      if (generation === scanGenerationRef.current) setScannerError(error instanceof Error ? error.message : "Upload failed.");
    } finally { if (generation === scanGenerationRef.current) setIsPreparingScan(false); }
  };

  const handleAiGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (aiRequestRef.current) return;
    const controller = new AbortController();
    aiRequestRef.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 120_000);
    setScannerError(null);
    setIsAiGenerating(true);

    try {
      const body: any = { type: "scanner" };
      if (!scanSource || isPreparingScan) throw new Error("Scan with camera or upload a file first.");
      if (!Number.isInteger(aiQuestionCount) || aiQuestionCount < 1 || aiQuestionCount > 50) throw new Error("Choose between 1 and 50 questions.");
      Object.assign(body, quizScanPayload(scanSource), { numQuestions: aiQuestionCount });

      const res = await fetch("/api/ai/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = await res.json().catch(() => { throw new Error("The AI service returned an unreadable response. Please try again shortly."); });
      if (controller.signal.aborted || aiRequestRef.current !== controller) return;
      if (res.status === 403 && data.code === "SUBSCRIPTION_REQUIRED") {
        setUpgradeReason("ai");
        setShowBillingModal(true);
        return;
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || "AI generation failed");
      }
      if (typeof data.aiGenerationReceipt !== "string" || !data.aiGenerationReceipt) {
        throw new Error("AI generation verification is unavailable. Please try again.");
      }

      const displayTopic = scanSource?.name || "Scanned Document";

      setEditingQuizData((previous) => ({
        duration: 60,
        passingScore: 70,
        shuffleQuestions: true,
        allowRetake: true,
        isGamified: false,
        quizMode: "proctored",
        // AI enhancement keeps the open quiz identity and teacher-configured settings.
        ...(isEditorOpen ? previous : {}),
        aiGenerationReceipt: data.aiGenerationReceipt,
        title: data.detectedTitle || `AI Assessment - ${displayTopic.slice(0, 30)}`,
        subjectName: data.detectedSubject || "General",
        description:
          data.detectedDescription ||
          `This quiz was auto-generated by ProctorShield AI based on: ${displayTopic}.`,
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
      }));

      setIsAiModalOpen(false);
      setIsEditorOpen(true);

      // Reset inputs

      setAiQuestionCount(5);
      setScanSource(null);
      setCameraOpen(false);
      setActiveTab("upload");
    } catch (err: unknown) {
      if (aiRequestRef.current !== controller || (controller.signal.aborted && !timedOut)) return;
      setScannerError(timedOut ? "AI generation took too long. Your source is still available; try again with fewer questions."
        : err instanceof Error ? err.message : "Could not reach the AI service. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
      if (aiRequestRef.current === controller) { aiRequestRef.current = null; setIsAiGenerating(false); }
    }
  };

  const filtered = filterTeacherQuizzes(quizzes, search, arenaEnabled);

  return (
    <div className="ps-teacher-glass-canvas space-y-6">
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

      {actionError && !manageQuiz && <div role="alert" className="fixed bottom-4 right-4 z-[100] max-w-sm rounded-xl border border-rose-500/30 bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-rose-600 shadow-xl dark:text-rose-400">{actionError}</div>}

      <QuizRequestPanels pendingApprovals={pendingApprovals} pendingRetakes={pendingRetakes}
        approvalError={approvalError} approvalInProgressId={approvalInProgressId}
        handlePendingApproval={handlePendingApproval} handleRetakeApprove={handleRetakeApprove}
      />

      {/* ─────────────────────────────────────────────────────────────
          3. QUIZZES TABLE SECTION
      ───────────────────────────────────────────────────────────── */}
      <TeacherQuizLibrary quizzes={quizzes} filtered={filtered} search={search} setSearch={setSearch}
        isSubscribed={isSubscribed} isCheckingSub={isCheckingSub} manualQuizCount={manualQuizCount}
        manualQuizLimit={manualQuizLimit} loadError={loadError} isLoading={isLoading} fetchQuizzes={fetchQuizzes}
        openNewQuizStudio={openNewQuizStudio} onOpenAiGenerator={() => {
          if (!isSubscribed) { setUpgradeReason("ai"); setShowBillingModal(true); return; }
          setIsAiModalOpen(true);
        }} handleEditQuizInStudio={handleEditQuizInStudio} setManageQuiz={setManageQuiz} startQuiz={startQuiz} router={router}
      />

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
          onOpenAiGenerator={(quiz) => {
            if (!isSubscribed) {
              setUpgradeReason("ai");
              setShowBillingModal(true);
            } else if (quiz.id && (quiz.hasAttempts || (quiz.participantCount ?? 0) > 0)) {
              alert("Questions cannot be changed after students have joined or attempted this quiz.");
            } else {
              setEditingQuizData(quiz);
              setIsAiModalOpen(true);
            }
          }}
        />
      )}

      {/* ─────────────────────────────────────────────────────────────
          5. QUICK MANAGE QUIZ MODAL
      ───────────────────────────────────────────────────────────── */}
      {manageQuiz && portalMounted && <ManageQuizDialog
        manageQuiz={manageQuiz} isSubscribed={isSubscribed} actionError={actionError}
        isUpdatingStatus={isUpdatingStatus} isDeleting={isDeleting} setManageQuiz={setManageQuiz}
        updateQuizDuration={updateQuizDuration} handleEditQuizInStudio={handleEditQuizInStudio}
        toggleQuizStatus={toggleQuizStatus} endQuiz={endQuiz} deleteQuiz={deleteQuiz}
        updateRetakeSetting={updateRetakeSetting} router={router}
      />}

      {/* ─────────────────────────────────────────────────────────────
          6. AI AUTO-GENERATE MODAL
      ───────────────────────────────────────────────────────────── */}
      {isAiModalOpen && portalMounted && createPortal(
        <div
          className="teacher-content app-modal-backdrop bg-black/80 backdrop-blur-md"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeAiModal();
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
                aria-label="Close AI generator"
                onClick={closeAiModal}
                className="text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAiGenerate} aria-busy={isAiGenerating} className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4">
              <div className="flex border-b border-[var(--border)]" role="tablist" aria-label="AI source">
                {(["upload", "scan"] as const).map(mode => (
                  <button key={mode} type="button" role="tab" disabled={isAiGenerating} aria-selected={activeTab === mode}
                    onClick={() => { stopCamera(); setCameraOpen(false); setScannerError(null); setActiveTab(mode); }}
                    className={`pb-2 text-sm font-semibold flex-1 border-b-2 cursor-pointer ${activeTab === mode ? "border-purple-500 text-purple-600" : "border-transparent text-[var(--muted)]"}`}>
                    {mode === "upload" ? "Upload" : "Scan"}
                  </button>
                ))}
              </div>
              <div role="tabpanel" aria-label={activeTab === "upload" ? "Upload" : "Scan"}>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-3">
                    {activeTab === "scan" && <button type="button" disabled={isAiGenerating} onClick={() => { setScanSource(null); setScannerError(null); setCameraOpen(true); }} className="px-4 py-2 rounded-lg bg-purple-600 text-white">Scan with Camera</button>}
                    {activeTab === "upload" && <label className="px-4 py-2 rounded-lg border border-[var(--border)] cursor-pointer">Upload from Device
                      <input type="file" accept="image/*,application/pdf,.pdf,text/plain,.txt" onChange={handleFileUpload} className="sr-only" disabled={isPreparingScan || isAiGenerating} />
                    </label>}
                  </div>
                  <p className="text-xs text-[var(--muted)]">Images up to 10 MB, PDF up to 4 MB, or plain text up to 60 KB.</p>
                  {scannerError && <p role="alert" className="text-sm text-rose-500">{scannerError}</p>}
                  {isPreparingScan && <p role="status">Preparing scan…</p>}
                  {cameraOpen && !scanSource && <div className="teacher-media relative rounded-xl overflow-hidden bg-black aspect-video">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
                    <button type="button" onClick={handleCapture} className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-purple-600 text-white rounded-xl">Capture Photo</button>
                  </div>}
                  {scanSource && <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
                    {scanSource.dataUrl?.startsWith("data:image/") && <img src={scanSource.dataUrl} alt="Scan preview" className="w-full max-h-[220px] object-contain" />}
                    <p className="text-sm">{scanSource.name}</p>
                    <button type="button" disabled={isAiGenerating} onClick={() => setScanSource(null)} className="text-sm text-rose-500">Remove scan</button>
                  </div>}
                  <label className="block text-xs font-semibold" htmlFor="scan-question-count">Number of Questions (1–50)</label>
                  <input id="scan-question-count" type="number" min={1} max={50} step={1} required disabled={isAiGenerating} value={aiQuestionCount} onChange={e => setAiQuestionCount(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg" />
                  {isAiGenerating && <p role="status" className="text-sm text-[var(--muted)]">Generating questions. This may take up to two minutes. Review the questions in Studio before saving your quiz.</p>}
                </div>
              </div>

              </div>

              <div className="shrink-0 flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface2)] p-4 sm:flex-row sm:gap-3">
                <button
                  type="button"
                  onClick={closeAiModal}
                  className="flex-1 py-2 rounded-lg font-semibold text-sm border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface2)] transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAiGenerating || isPreparingScan}
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
          className="teacher-content ps-teacher-glass-dialog app-modal-backdrop bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowBillingModal(false);
          }}
        >
          <div
            className="app-modal-panel ps-teacher-glass-card relative flex min-h-0 max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
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
                  : "AI Quiz Generation is a Pro feature. Upgrade your plan to unlock AI-powered quiz creation, live monitoring, and evidence review."}
              </p>

              <div className="ps-teacher-glass-dense space-y-2.5 text-left mb-6 bg-[var(--surface2)] rounded-xl p-4 border border-[var(--border)]">
                {[
                  "AI Quiz Generation (Gemini AI)",
                  "Real-time Live Monitoring",
                  "Evidence Replay & Timeline",
                  "AI Verdict Reports",
                  "Unlimited Quizzes",
                  `Up to ${PRO_STUDENT_LIMIT_PER_QUIZ} Students per Quiz`,
                  ...(arenaEnabled ? ["ProctorShield Arena Multiplayer"] : []),
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
