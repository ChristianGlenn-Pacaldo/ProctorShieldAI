"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Crown,
  Eye,
  Flame,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Lock,
  Minus,
  Pencil,
  Plus,
  Save,
  Search,
  Settings as SettingsIcon,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Swords,
  Timer,
  Trash,
  Trash2,
  X,
  Zap,
} from "lucide-react";

export interface ChoiceItem {
  id?: number;
  choiceText: string;
  isCorrect: boolean;
}

export interface QuestionItem {
  id?: number;
  questionText: string;
  questionType?: string;
  points: number;
  timeLimitSeconds?: number;
  explanation?: string;
  choices: ChoiceItem[];
}

export interface QuizFormData {
  id?: number;
  title: string;
  subjectName: string;
  description: string;
  duration: number;
  passingScore: number;
  shuffleQuestions: boolean;
  allowRetake: boolean;
  isGamified: boolean;
  quizMode: "proctored" | "arena";
  quizStatus?: string;
  hasAttempts?: boolean;
  participantCount?: number;
  questions: QuestionItem[];
}

export interface ProctorShieldQuizEditorProps {
  initialQuiz?: Partial<QuizFormData>;
  isSubscribed: boolean;
  teacherName?: string;
  onClose: () => void;
  onSaveSuccess: (quiz: any) => void;
  onOpenAiGenerator?: () => void;
}

const TIME_OPTIONS = [
  { label: "10 seconds", value: 10 },
  { label: "20 seconds", value: 20 },
  { label: "30 seconds", value: 30 },
  { label: "45 seconds", value: 45 },
  { label: "60 seconds", value: 60 },
  { label: "2 minutes", value: 120 },
  { label: "5 minutes", value: 300 },
];

const POINT_OPTIONS = [
  { label: "1 point", value: 1 },
  { label: "2 points", value: 2 },
  { label: "3 points", value: 3 },
  { label: "5 points", value: 5 },
  { label: "10 points", value: 10 },
];

const QUESTION_TYPES = [
  { label: "Multiple Choice", value: "multiple_choice", icon: "🔘" },
  { label: "True / False", value: "true_false", icon: "⚖️" },
  { label: "Fill in the blank", value: "fill_in_blank", icon: "📥" },
];

// 4 Color Schemes for 2x2 Answer Grid
const CHOICE_THEMES = [
  {
    key: "A",
    letter: "A",
    border: "border-blue-500/40 focus-within:border-blue-400",
    bg: "bg-blue-950/25",
    activeBg: "bg-blue-500/20",
    accent: "text-blue-400",
    badgeBg: "bg-blue-600 text-white",
    placeholder: "Type option 1...",
  },
  {
    key: "B",
    letter: "B",
    border: "border-cyan-500/40 focus-within:border-cyan-400",
    bg: "bg-cyan-950/25",
    activeBg: "bg-cyan-500/20",
    accent: "text-cyan-400",
    badgeBg: "bg-cyan-600 text-white",
    placeholder: "Type option 2...",
  },
  {
    key: "C",
    letter: "C",
    border: "border-amber-500/40 focus-within:border-amber-400",
    bg: "bg-amber-950/25",
    activeBg: "bg-amber-500/20",
    accent: "text-amber-400",
    badgeBg: "bg-amber-600 text-white",
    placeholder: "Type option 3...",
  },
  {
    key: "D",
    letter: "D",
    border: "border-emerald-500/40 focus-within:border-emerald-400",
    bg: "bg-emerald-950/25",
    activeBg: "bg-emerald-500/20",
    accent: "text-emerald-400",
    badgeBg: "bg-emerald-600 text-white",
    placeholder: "Type option 4...",
  },
];

export default function ProctorShieldQuizEditor({
  initialQuiz,
  isSubscribed,
  teacherName = "Teacher",
  onClose,
  onSaveSuccess,
  onOpenAiGenerator,
}: ProctorShieldQuizEditorProps) {
  // Main Quiz State
  const initialMode = initialQuiz?.quizMode || (initialQuiz?.isGamified ? "arena" : "proctored");
  const [quizForm, setQuizForm] = useState<QuizFormData>({
    id: initialQuiz?.id,
    title: initialQuiz?.title || (initialMode === "arena" ? "Untitled Power Arena Match" : "Untitled Assessment"),
    subjectName: initialQuiz?.subjectName || "Computer Science",
    description: initialQuiz?.description || "",
    duration: initialQuiz?.duration || (initialMode === "arena" ? 15 : 30),
    passingScore: initialQuiz?.passingScore || 70,
    shuffleQuestions: initialQuiz?.shuffleQuestions ?? true,
    allowRetake: initialQuiz?.allowRetake ?? false,
    isGamified: initialQuiz?.isGamified ?? (initialMode === "arena"),
    quizMode: initialMode,
    quizStatus: initialQuiz?.quizStatus || "draft",
    hasAttempts: Boolean(initialQuiz?.hasAttempts || (initialQuiz?.participantCount ?? 0) > 0),
    participantCount: initialQuiz?.participantCount || 0,
    questions:
      initialQuiz?.questions && initialQuiz.questions.length > 0
        ? initialQuiz.questions
        : [
            {
              questionText: "What is the primary function of an operating system?",
              questionType: "multiple_choice",
              points: 1,
              timeLimitSeconds: 30,
              choices: [
                { choiceText: "Manage hardware and software resources", isCorrect: true },
                { choiceText: "Compile source code into bytecode", isCorrect: false },
                { choiceText: "Provide high-speed internet connectivity", isCorrect: false },
                { choiceText: "Design vector graphics and animations", isCorrect: false },
              ],
            },
          ],
  });

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Synchronize state when initialQuiz prop updates (e.g. from AI generator or quiz detail load)
  useEffect(() => {
    if (initialQuiz) {
      const mode = initialQuiz.quizMode || (initialQuiz.isGamified ? "arena" : "proctored");
      setQuizForm({
        id: initialQuiz.id,
        title: initialQuiz.title || (mode === "arena" ? "Untitled Power Arena Match" : "Untitled Assessment"),
        subjectName: initialQuiz.subjectName || "Computer Science",
        description: initialQuiz.description || "",
        duration: initialQuiz.duration || (mode === "arena" ? 15 : 30),
        passingScore: initialQuiz.passingScore || 70,
        shuffleQuestions: initialQuiz.shuffleQuestions ?? true,
        allowRetake: initialQuiz.allowRetake ?? false,
        isGamified: initialQuiz.isGamified ?? (mode === "arena"),
        quizMode: mode,
        quizStatus: initialQuiz.quizStatus || "draft",
        hasAttempts: Boolean(initialQuiz.hasAttempts || (initialQuiz.participantCount ?? 0) > 0),
        participantCount: initialQuiz.participantCount || 0,
        questions:
          initialQuiz.questions && initialQuiz.questions.length > 0
            ? initialQuiz.questions
            : [
                {
                  questionText: "What is the primary function of an operating system?",
                  questionType: "multiple_choice",
                  points: 1,
                  timeLimitSeconds: 30,
                  choices: [
                    { choiceText: "Manage hardware and software resources", isCorrect: true },
                    { choiceText: "Compile source code into bytecode", isCorrect: false },
                    { choiceText: "Provide high-speed internet connectivity", isCorrect: false },
                    { choiceText: "Design vector graphics and animations", isCorrect: false },
                  ],
                },
              ],
      });
    }
  }, [initialQuiz]);

  const isModeLocked = Boolean(
    quizForm.id &&
    (quizForm.hasAttempts ||
      (quizForm.participantCount ?? 0) > 0 ||
      (quizForm.quizStatus && quizForm.quizStatus !== "draft"))
  );

  const handleToggleMode = (targetMode: "proctored" | "arena") => {
    if (quizForm.quizMode === targetMode) return;
    if (isModeLocked) {
      setSaveError("Quiz mode cannot be changed after students have joined or attempted this quiz.");
      return;
    }
    if (targetMode === "arena" && !isSubscribed) {
      alert("Power Arena mode requires an active ProctorShield Pro subscription.\n\nPlease upgrade to Pro to unlock multiplayer Arena games.");
      return;
    }
    setQuizForm((prev) => ({
      ...prev,
      quizMode: targetMode,
      isGamified: targetMode === "arena",
      title: prev.title === "Untitled Assessment" && targetMode === "arena" ? "Untitled Power Arena Match" : prev.title,
    }));
  };

  // Studio Mode: 'quiz_overview' (ProctorShield /edit) vs 'question_studio' (ProctorShield /question/.../edit)
  const [studioMode, setStudioMode] = useState<"quiz_overview" | "question_studio">("quiz_overview");
  const [activeQuestionIndex, setActiveQuestionIndex] = useState<number>(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Question Studio Active Draft State
  const [draftQuestion, setDraftQuestion] = useState<QuestionItem>({
    questionText: "",
    questionType: "multiple_choice",
    points: 1,
    timeLimitSeconds: 30,
    choices: [
      { choiceText: "", isCorrect: true },
      { choiceText: "", isCorrect: false },
      { choiceText: "", isCorrect: false },
      { choiceText: "", isCorrect: false },
    ],
  });

  // Open question editor
  const handleOpenQuestionEditor = (index: number) => {
    const targetQ = quizForm.questions[index];
    if (targetQ) {
      setDraftQuestion({
        ...targetQ,
        choices:
          targetQ.choices && targetQ.choices.length > 0
            ? targetQ.choices.map((c) => ({ ...c }))
            : [
                { choiceText: "", isCorrect: true },
                { choiceText: "", isCorrect: false },
                { choiceText: "", isCorrect: false },
                { choiceText: "", isCorrect: false },
              ],
      });
      setActiveQuestionIndex(index);
    }
    setStudioMode("question_studio");
  };

  // Create brand new question
  const handleAddNewQuestion = () => {
    const newQ: QuestionItem = {
      questionText: "",
      questionType: "multiple_choice",
      points: 1,
      timeLimitSeconds: 30,
      choices: [
        { choiceText: "", isCorrect: true },
        { choiceText: "", isCorrect: false },
        { choiceText: "", isCorrect: false },
        { choiceText: "", isCorrect: false },
      ],
    };
    setDraftQuestion(newQ);
    setActiveQuestionIndex(quizForm.questions.length);
    setStudioMode("question_studio");
  };

  // Handle question type switching
  const handleQuestionTypeChange = (newType: string) => {
    let newChoices: ChoiceItem[] = [...draftQuestion.choices];

    if (newType === "fill_in_blank") {
      const existingCorrect = draftQuestion.choices.filter((c) => c.choiceText.trim());
      newChoices = existingCorrect.length > 0
        ? existingCorrect.map((c) => ({ choiceText: c.choiceText, isCorrect: true }))
        : [{ choiceText: "", isCorrect: true }];
    } else if (newType === "true_false") {
      newChoices = [
        { choiceText: "True", isCorrect: true },
        { choiceText: "False", isCorrect: false },
      ];
    } else {
      // multiple_choice
      if (newChoices.length < 4) {
        while (newChoices.length < 4) {
          newChoices.push({ choiceText: "", isCorrect: false });
        }
      } else if (newChoices.length > 4) {
        newChoices = newChoices.slice(0, 4);
      }
      if (!newChoices.some((c) => c.isCorrect)) {
        newChoices[0].isCorrect = true;
      }
    }

    setDraftQuestion({
      ...draftQuestion,
      questionType: newType,
      choices: newChoices,
    });
  };

  // Save current question back to quizForm
  const handleSaveQuestionDraft = () => {
    if (!draftQuestion.questionText.trim()) {
      alert("Please enter question text before saving.");
      return;
    }

    if (draftQuestion.questionType === "fill_in_blank") {
      const hasAcceptedAnswer = draftQuestion.choices.some((c) => c.choiceText.trim());
      if (!hasAcceptedAnswer) {
        alert("Please enter at least one accepted answer for this fill in the blank question.");
        return;
      }
    } else {
      const hasCorrectChoice = draftQuestion.choices.some((c) => c.isCorrect && c.choiceText.trim());
      if (!hasCorrectChoice) {
        alert("Please mark at least one non-empty choice as the correct answer.");
        return;
      }
    }

    setQuizForm((prev) => {
      const updated = [...prev.questions];
      if (activeQuestionIndex < updated.length) {
        updated[activeQuestionIndex] = { ...draftQuestion };
      } else {
        updated.push({ ...draftQuestion });
      }
      return { ...prev, questions: updated };
    });

    setStudioMode("quiz_overview");
  };

  // Duplicate question
  const handleDuplicateQuestion = (index: number) => {
    setQuizForm((prev) => {
      const target = prev.questions[index];
      const copy: QuestionItem = {
        ...target,
        questionText: `${target.questionText} (Copy)`,
        choices: target.choices.map((c) => ({ ...c })),
      };
      const updated = [...prev.questions];
      updated.splice(index + 1, 0, copy);
      return { ...prev, questions: updated };
    });
  };

  // Delete question
  const handleDeleteQuestion = (index: number) => {
    if (quizForm.questions.length <= 1) {
      alert("A quiz must have at least one question.");
      return;
    }
    setQuizForm((prev) => {
      const updated = prev.questions.filter((_, i) => i !== index);
      return { ...prev, questions: updated };
    });
  };

  // Save full quiz to backend
  const handleSaveAndPublish = async () => {
    if (!quizForm.title.trim()) {
      setSaveError("Quiz title is required.");
      return;
    }
    if (quizForm.questions.length === 0) {
      setSaveError("At least one question is required.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const isEditingExisting = Boolean(quizForm.id);
      const url = isEditingExisting ? `/api/quizzes/${quizForm.id}` : "/api/quizzes";
      const method = isEditingExisting ? "PUT" : "POST";

      const payload = {
        title: quizForm.title.trim(),
        subjectName: quizForm.subjectName.trim(),
        description: quizForm.description.trim(),
        duration: quizForm.duration,
        passingScore: quizForm.passingScore,
        shuffleQuestions: quizForm.shuffleQuestions,
        allowRetake: quizForm.quizMode === "arena" ? false : quizForm.allowRetake,
        isGamified: quizForm.quizMode === "arena" ? true : quizForm.isGamified,
        quizMode: quizForm.quizMode,
        totalQuestions: quizForm.questions.length,
        questions: quizForm.questions.map((q) => {
          let choices = q.choices
            .filter((c) => c.choiceText.trim())
            .map((c) => ({
              choiceText: c.choiceText.trim(),
              isCorrect: Boolean(c.isCorrect),
            }));

          if (q.questionType === "fill_in_blank") {
            // All teacher-entered answers for fill in the blank are accepted (isCorrect: true)
            choices = choices.map((c) => ({ ...c, isCorrect: true }));
            // Add fallback choice to ensure backend question validator compatibility
            if (choices.length === 1) {
              choices.push({ choiceText: "[Other]", isCorrect: false });
            }
          }

          return {
            questionText: q.questionText.trim(),
            points: q.points,
            questionType: q.questionType || "multiple_choice",
            choices,
          };
        }),
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.code === "QUIZ_MODE_CHANGE_NOT_ALLOWED" || res.status === 409) {
          throw new Error("Quiz mode cannot be changed after students have joined or attempted this quiz.");
        }
        throw new Error(data.error || data.message || "Failed to save quiz");
      }

      onSaveSuccess(data.quiz || data);
    } catch (err: any) {
      console.error("Error saving quiz:", err);
      setSaveError(err.message || "An unexpected error occurred");
    } finally {
      setIsSaving(false);
    }
  };

  // Insert math symbol into question draft
  const handleInsertSymbol = (symbol: string) => {
    setDraftQuestion((prev) => ({
      ...prev,
      questionText: `${prev.questionText} ${symbol} `,
    }));
  };

  // Filter questions in overview
  const filteredQuestions = quizForm.questions.filter((q) =>
    q.questionText.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[900] bg-slate-950 text-white flex flex-col font-sans select-none overflow-hidden animate-in fade-in duration-200">
      {/* ─────────────────────────────────────────────────────────────
          1. TOP APP HEADER (PROCTORSHIELD ACTIVITY BAR)
      ───────────────────────────────────────────────────────────── */}
      <header className="h-16 px-4 sm:px-6 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between shrink-0 z-40">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => {
              if (studioMode === "question_studio") {
                setStudioMode("quiz_overview");
              } else {
                onClose();
              }
            }}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer shrink-0"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {/* Editable Quiz Title & Subject Pill */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative flex items-center group min-w-0">
              <input
                type="text"
                value={quizForm.title}
                onChange={(e) => setQuizForm({ ...quizForm, title: e.target.value })}
                className="bg-transparent text-xs sm:text-base font-black text-white px-2 py-1 rounded-lg hover:bg-slate-800/80 focus:bg-slate-900 border border-transparent focus:border-indigo-500/50 outline-hidden transition-all truncate max-w-[120px] xs:max-w-[180px] sm:max-w-xs md:max-w-md font-[family-name:var(--font-display)]"
                placeholder="Enter quiz title..."
              />
              <Pencil className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-400 transition-colors pointer-events-none -ml-5 shrink-0" />
            </div>

            <span className="hidden sm:inline-block px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[11px] font-bold shrink-0">
              {quizForm.subjectName}
            </span>

            {/* Mode Switcher Segmented Control */}
            <div className="inline-flex items-center p-0.5 rounded-xl bg-slate-950 border border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => handleToggleMode("proctored")}
                disabled={isModeLocked && quizForm.quizMode !== "proctored"}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  quizForm.quizMode === "proctored"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white"
                } ${isModeLocked && quizForm.quizMode !== "proctored" ? "opacity-40 cursor-not-allowed" : ""}`}
                title={isModeLocked ? "Quiz mode cannot be changed after students have joined or attempted this quiz." : "Switch to Live Monitored Exam"}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Live Exam</span>
              </button>

              <button
                type="button"
                onClick={() => handleToggleMode("arena")}
                disabled={isModeLocked && quizForm.quizMode !== "arena"}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  quizForm.quizMode === "arena"
                    ? "bg-amber-500 text-slate-950 shadow-sm"
                    : "text-slate-400 hover:text-white"
                } ${isModeLocked && quizForm.quizMode !== "arena" ? "opacity-40 cursor-not-allowed" : ""}`}
                title={isModeLocked ? "Quiz mode cannot be changed after students have joined or attempted this quiz." : "Switch to Power Arena"}
              >
                <Swords className="w-3.5 h-3.5" />
                <span>Power Arena</span>
                {!isSubscribed && <Crown className="w-3 h-3 text-amber-400" />}
              </button>
            </div>

            {isModeLocked && (
              <span
                className="hidden lg:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800/80 border border-slate-700 text-slate-400 text-[10px] font-semibold shrink-0"
                title="Quiz mode cannot be changed after students have joined or attempted this quiz."
              >
                <Lock className="w-3 h-3" />
                Mode Locked
              </span>
            )}
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          {studioMode === "quiz_overview" && (
            <>
              {onOpenAiGenerator && (
                <button
                  type="button"
                  onClick={() => {
                    if (!isSubscribed) {
                      alert("AI Generator requires an active ProctorShield Pro subscription.\n\nPlease upgrade to Pro to unlock automated question generation.");
                      return;
                    }
                    onOpenAiGenerator();
                  }}
                  className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 text-xs font-bold transition-all cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  AI Generator
                  {!isSubscribed && <Crown className="w-3 h-3 text-amber-400" />}
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsPreviewOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-all cursor-pointer"
                title="Preview Student Experience"
              >
                <Eye className="w-4 h-4 text-blue-400" />
                <span className="hidden sm:inline">Preview</span>
              </button>

              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
                title="Quiz Settings"
              >
                <SettingsIcon className="w-4 h-4" />
              </button>

              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveAndPublish}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-rose-500 via-pink-500 to-purple-600 hover:opacity-95 text-white font-black text-xs sm:text-sm shadow-md shadow-pink-500/20 active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Publish Quiz
                  </>
                )}
              </button>
            </>
          )}

          {studioMode === "question_studio" && (
            <button
              type="button"
              onClick={handleSaveQuestionDraft}
              className="inline-flex items-center gap-2 px-6 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black text-xs sm:text-sm shadow-md shadow-emerald-500/20 active:scale-95 transition-all cursor-pointer"
            >
              <Check className="w-4 h-4" />
              Save Question
            </button>
          )}
        </div>
      </header>

      {/* Save Error Notification Banner */}
      {saveError && (
        <div className="bg-rose-500/15 border-b border-rose-500/30 px-6 py-2.5 text-rose-300 text-xs font-bold flex items-center justify-between">
          <span>⚠️ {saveError}</span>
          <button onClick={() => setSaveError(null)} className="text-rose-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          2. VIEW A: QUIZ OVERVIEW CANVAS (PROCTORSHIELD /edit)
      ───────────────────────────────────────────────────────────── */}
      {studioMode === "quiz_overview" && (
        <main className="flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Quiz Info & Telemetry Card (4 / 12 span) */}
            <aside className="lg:col-span-4 space-y-4">
              <div className="rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-xl">
                <div className="h-32 rounded-2xl bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-950 border border-indigo-500/30 p-4 flex flex-col justify-between relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/15 rounded-full blur-xl pointer-events-none" />
                  <span className="px-2.5 py-0.5 rounded-full bg-black/40 backdrop-blur-xs text-[10px] font-mono font-bold text-indigo-300 self-start">
                    {quizForm.subjectName.toUpperCase()}
                  </span>
                  <div>
                    <h3 className="text-base font-black text-white font-[family-name:var(--font-display)] truncate">
                      {quizForm.title}
                    </h3>
                    <p className="text-xs text-indigo-200/60 truncate">
                      {quizForm.description || "No description set"}
                    </p>
                  </div>
                </div>

                {/* Quick Meta Indicators */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="text-lg font-black text-white">{quizForm.questions.length}</div>
                    <div className="text-[10px] text-slate-400 font-semibold">Questions</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="text-lg font-black text-amber-400">{quizForm.duration}m</div>
                    <div className="text-[10px] text-slate-400 font-semibold">Duration</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="text-lg font-black text-emerald-400">{quizForm.passingScore}%</div>
                    <div className="text-[10px] text-slate-400 font-semibold">Pass Mark</div>
                  </div>
                </div>

                {/* Mode-Specific Telemetry Card */}
                {quizForm.quizMode === "arena" ? (
                  <div className="p-3.5 rounded-2xl bg-amber-950/25 border border-amber-500/30 flex items-center gap-3">
                    <Swords className="w-6 h-6 text-amber-400 shrink-0" />
                    <div className="text-xs">
                      <div className="font-bold text-amber-300">Power Arena Mode Active</div>
                      <div className="text-slate-400 text-[11px]">
                        Multiplayer battle arena • Zero proctoring • No webcam or mic
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-2xl bg-blue-950/20 border border-blue-500/30 flex items-center gap-3">
                    <ShieldCheck className="w-6 h-6 text-blue-400 shrink-0" />
                    <div className="text-xs">
                      <div className="font-bold text-white">Live Exam Proctoring Active</div>
                      <div className="text-slate-400 text-[11px]">
                        AI monitoring, webcam/mic verification &amp; live teacher oversight
                      </div>
                    </div>
                  </div>
                )}

                {/* AI Question Assistant Banner */}
                {onOpenAiGenerator && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!isSubscribed) {
                        alert("AI Generator Assistant requires an active ProctorShield Pro subscription.\n\nPlease upgrade to Pro to unlock automated question generation.");
                        return;
                      }
                      onOpenAiGenerator();
                    }}
                    className="w-full p-4 rounded-2xl bg-gradient-to-r from-purple-900/40 via-indigo-900/40 to-slate-900 border border-purple-500/40 hover:border-purple-400 text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-black text-purple-300">
                        <Sparkles className="w-4 h-4 text-purple-400 group-hover:rotate-12 transition-transform" />
                        AI Generator Assistant
                        {!isSubscribed && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-400 font-extrabold uppercase">
                            <Crown className="w-2.5 h-2.5" /> PRO
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-purple-400">→</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Scan documents, paste text, or snap photos of exams to generate questions automatically.
                    </p>
                  </button>
                )}
              </div>
            </aside>

            {/* Right Column: Questions Canvas (8 / 12 span) */}
            <section className="lg:col-span-8 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
                <div>
                  <h2 className="text-lg font-black text-white font-[family-name:var(--font-display)] flex items-center gap-2">
                    Questions ({quizForm.questions.length})
                  </h2>
                  <p className="text-xs text-slate-400">
                    Create questions or click on any question card to edit in the studio.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleAddNewQuestion}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-gradient-to-r from-pink-500 to-purple-600 text-white font-black text-xs shadow-md shadow-pink-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Add Question
                </button>
              </div>

              {/* Questions List */}
              <div className="space-y-3">
                {filteredQuestions.map((q, idx) => {
                  const qIndex = quizForm.questions.indexOf(q);
                  return (
                    <div
                      key={idx}
                      onClick={() => handleOpenQuestionEditor(qIndex)}
                      className="group p-5 rounded-2xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/50 shadow-md transition-all cursor-pointer space-y-3"
                    >
                      {/* Question Card Topbar */}
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white font-black flex items-center justify-center text-xs">
                            {qIndex + 1}
                          </span>
                          <span className="font-bold text-slate-300 capitalize">
                            {q.questionType?.replace("_", " ") || "Multiple Choice"}
                          </span>
                          <span className="text-slate-600">•</span>
                          <span className="text-amber-400 font-semibold">{q.points} pt</span>
                          <span className="text-slate-600">•</span>
                          <span className="text-slate-400">{q.timeLimitSeconds || 30}s</span>
                        </div>

                        {/* Actions */}
                        <div
                          className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenQuestionEditor(qIndex)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicateQuestion(qIndex)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                            title="Duplicate"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(qIndex)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Question Text */}
                      <h4 className="text-sm sm:text-base font-bold text-white group-hover:text-indigo-200 transition-colors">
                        {q.questionText || "Untitled question..."}
                      </h4>

                      {/* Choices Preview Chips (2x2) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        {q.choices.map((c, cIdx) => (
                          <div
                            key={cIdx}
                            className={`px-3 py-2 rounded-xl text-xs flex items-center justify-between border ${
                              c.isCorrect
                                ? "bg-emerald-950/30 border-emerald-500/50 text-emerald-200 font-bold"
                                : "bg-slate-950/60 border-slate-800 text-slate-400"
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate pr-2">
                              <span
                                className={`w-4 h-4 rounded-md text-[10px] font-black flex items-center justify-center ${
                                  CHOICE_THEMES[cIdx % 4]?.badgeBg || "bg-slate-700"
                                }`}
                              >
                                {String.fromCharCode(65 + cIdx)}
                              </span>
                              <span className="truncate">{c.choiceText || "(Empty choice)"}</span>
                            </div>
                            {c.isCorrect && (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Big Prominent "Add Question" Card */}
                <button
                  type="button"
                  onClick={handleAddNewQuestion}
                  className="w-full p-8 rounded-3xl border-2 border-dashed border-slate-800 hover:border-pink-500/50 bg-slate-900/40 hover:bg-slate-900/80 flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-white transition-all cursor-pointer group"
                >
                  <div className="w-12 h-12 rounded-2xl bg-pink-500/10 group-hover:bg-pink-500/20 text-pink-400 flex items-center justify-center text-xl transition-all shadow-sm">
                    <Plus className="w-6 h-6" />
                  </div>
                  <div className="font-bold text-sm text-white">Create Another Question</div>
                  <div className="text-xs text-slate-500">
                    Add multiple choice, true/false, or open-ended questions
                  </div>
                </button>
              </div>
            </section>
          </div>
        </main>
      )}

      {/* ─────────────────────────────────────────────────────────────
          3. VIEW B: PROCTORSHIELD QUESTION STUDIO (/question/.../edit)
      ───────────────────────────────────────────────────────────── */}
      {studioMode === "question_studio" && (
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
          {/* Main Question Editor Workspace */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-8 space-y-6 max-w-4xl mx-auto w-full">
            {/* Studio Toolbar (Question Type, Time Limit, Points) */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-xl bg-pink-500/20 text-pink-300 text-xs font-black uppercase tracking-wider">
                  QUESTION #{activeQuestionIndex + 1}
                </span>

                {/* Question Type Selector */}
                <div className="relative">
                  <select
                    value={draftQuestion.questionType || "multiple_choice"}
                    onChange={(e) => handleQuestionTypeChange(e.target.value)}
                    className="appearance-none bg-slate-950 border border-slate-800 text-xs font-bold text-white py-1.5 pl-3 pr-8 rounded-xl focus:border-indigo-500 outline-hidden cursor-pointer"
                  >
                    {QUESTION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.icon} {t.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                {/* Time Limit Selector */}
                <div className="flex items-center gap-1 text-xs">
                  <Timer className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={draftQuestion.timeLimitSeconds || 30}
                    onChange={(e) =>
                      setDraftQuestion({
                        ...draftQuestion,
                        timeLimitSeconds: parseInt(e.target.value, 10),
                      })
                    }
                    className="bg-slate-950 border border-slate-800 text-xs font-bold text-white py-1.5 px-2.5 rounded-xl focus:border-indigo-500 outline-hidden cursor-pointer"
                  >
                    {TIME_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Points Selector */}
                <div className="flex items-center gap-1 text-xs">
                  <Crown className="w-3.5 h-3.5 text-amber-400" />
                  <select
                    value={draftQuestion.points || 1}
                    onChange={(e) =>
                      setDraftQuestion({ ...draftQuestion, points: parseInt(e.target.value, 10) })
                    }
                    className="bg-slate-950 border border-slate-800 text-xs font-bold text-white py-1.5 px-2.5 rounded-xl focus:border-indigo-500 outline-hidden cursor-pointer"
                  >
                    {POINT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Question Prompt Card */}
            <div className="p-6 sm:p-8 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black uppercase tracking-wider text-slate-400">
                  Question Prompt
                </label>
                {/* Math & Formatting helpers */}
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  <span className="text-[11px] font-semibold text-slate-500 mr-1 hidden sm:inline">
                    Insert Math:
                  </span>
                  {["π", "√", "x²", "÷", "±", "≠"].map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => handleInsertSymbol(sym)}
                      className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs cursor-pointer"
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                value={draftQuestion.questionText}
                onChange={(e) =>
                  setDraftQuestion({ ...draftQuestion, questionText: e.target.value })
                }
                placeholder="Type your question here (e.g. Which layer of the OSI model handles routing?)..."
                rows={3}
                className="w-full p-4 rounded-2xl bg-slate-950 border-2 border-slate-800 focus:border-indigo-500/70 text-base sm:text-lg font-bold text-white placeholder:text-slate-600 outline-hidden leading-relaxed resize-none transition-all font-[family-name:var(--font-display)]"
              />
            </div>

            {/* Answer Section: Fill in the Blank vs Multiple Choice / True False */}
            {draftQuestion.questionType === "fill_in_blank" ? (
              <div className="p-6 sm:p-7 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
                  <div>
                    <label className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-2 font-[family-name:var(--font-display)]">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                      Accepted Correct Answers (Fill in the blank)
                    </label>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Students will see a blank input. Student answers are evaluated case-insensitively.
                    </p>
                  </div>
                  <span className="text-xs text-emerald-300 font-bold bg-emerald-950/50 border border-emerald-500/40 px-3 py-1 rounded-full self-start sm:self-auto">
                    {draftQuestion.choices.filter((c) => c.choiceText.trim()).length} Accepted Alternative(s)
                  </span>
                </div>

                {/* List of Accepted Alternative Inputs */}
                <div className="space-y-3 pt-1">
                  {draftQuestion.choices.map((choice, cIdx) => (
                    <div
                      key={cIdx}
                      className="p-4 rounded-2xl bg-slate-950 border-2 border-emerald-500/40 hover:border-emerald-500/80 transition-all flex flex-col sm:flex-row items-start sm:items-center gap-3 shadow-md"
                    >
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="w-8 h-8 rounded-xl bg-emerald-500 text-slate-950 text-sm font-black flex items-center justify-center shadow-md shadow-emerald-500/30">
                          ✓
                        </span>
                        <div className="min-w-28">
                          <div className="text-xs font-black text-white">
                            {cIdx === 0 ? "Primary Answer" : `Alternative #${cIdx + 1}`}
                          </div>
                          <div className="text-[10px] text-emerald-400/80 font-semibold">Exact Match</div>
                        </div>
                      </div>

                      <div className="flex-1 w-full">
                        <input
                          type="text"
                          value={choice.choiceText}
                          onChange={(e) => {
                            const updated = [...draftQuestion.choices];
                            updated[cIdx] = { ...choice, choiceText: e.target.value, isCorrect: true };
                            setDraftQuestion({ ...draftQuestion, choices: updated });
                          }}
                          placeholder={
                            cIdx === 0
                              ? "Type the accepted answer (e.g. Mitochondria, Paris, 1945)..."
                              : "Type alternative valid spelling or synonym (e.g. US, USA)..."
                          }
                          className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-sm font-bold text-white placeholder:text-slate-600 focus:outline-hidden focus:border-emerald-500 transition-colors"
                        />
                      </div>

                      {draftQuestion.choices.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const updated = draftQuestion.choices.filter((_, i) => i !== cIdx);
                            setDraftQuestion({ ...draftQuestion, choices: updated });
                          }}
                          className="p-2.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0 cursor-pointer"
                          title="Remove this alternative answer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add Alternative Answer Button */}
                <div className="pt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      const updated = [...draftQuestion.choices, { choiceText: "", isCorrect: true }];
                      setDraftQuestion({ ...draftQuestion, choices: updated });
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-emerald-500/50 hover:border-emerald-400 text-emerald-400 hover:bg-emerald-500/10 text-xs font-bold transition-all cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Add Alternative Accepted Answer
                  </button>
                  <span className="text-[11px] text-slate-500 hidden sm:inline">
                    e.g. Add acronyms, common spellings, or numerals
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-400">
                    Answer Options (Click checkmark to mark correct)
                  </label>
                  <span className="text-xs text-slate-500">
                    {draftQuestion.choices.filter((c) => c.isCorrect).length} Correct Answer(s)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {draftQuestion.choices.map((choice, cIdx) => {
                    const theme = CHOICE_THEMES[cIdx % 4];
                    return (
                      <div
                        key={cIdx}
                        className={`p-4 rounded-2xl border-2 ${theme.border} ${
                          choice.isCorrect ? "bg-emerald-950/30 border-emerald-500" : theme.bg
                        } shadow-lg transition-all space-y-3 relative group`}
                      >
                        {/* Header of Option */}
                        <div className="flex items-center justify-between">
                          <span
                            className={`w-7 h-7 rounded-xl text-xs font-black flex items-center justify-center ${
                              choice.isCorrect ? "bg-emerald-500 text-white" : theme.badgeBg
                            }`}
                          >
                            {theme.letter}
                          </span>

                          {/* Correct Answer Checkbox Pill */}
                          <button
                            type="button"
                            onClick={() => {
                              const updated = draftQuestion.choices.map((c, i) => {
                                if (i === cIdx) {
                                  return { ...c, isCorrect: !c.isCorrect };
                                }
                                return c;
                              });
                              setDraftQuestion({ ...draftQuestion, choices: updated });
                            }}
                            className={`px-3 py-1 rounded-full text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer ${
                              choice.isCorrect
                                ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30"
                                : "bg-slate-800/80 text-slate-400 hover:text-white"
                            }`}
                          >
                            {choice.isCorrect ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 fill-slate-950 text-emerald-400" />
                                CORRECT
                              </>
                            ) : (
                              <>
                                <div className="w-3.5 h-3.5 rounded-full border border-slate-500" />
                                Mark Correct
                              </>
                            )}
                          </button>
                        </div>

                        {/* Text Input */}
                        <textarea
                          value={choice.choiceText}
                          onChange={(e) => {
                            const updated = [...draftQuestion.choices];
                            updated[cIdx] = { ...choice, choiceText: e.target.value };
                            setDraftQuestion({ ...draftQuestion, choices: updated });
                          }}
                          placeholder={theme.placeholder}
                          rows={2}
                          className="w-full p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-sm font-bold text-white placeholder:text-slate-600 outline-hidden resize-none transition-all"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Answer Explanation Box */}
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
              <label className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-purple-400" />
                Explanation (Optional)
              </label>
              <textarea
                value={draftQuestion.explanation || ""}
                onChange={(e) =>
                  setDraftQuestion({ ...draftQuestion, explanation: e.target.value })
                }
                placeholder="Explain why this answer is correct (shown to students during result review)..."
                rows={2}
                className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-600 outline-hidden resize-none"
              />
            </div>
          </div>

          {/* Right Panel: Live Student Mobile / Screen Preview */}
          <aside className="hidden xl:flex w-96 border-l border-slate-800 bg-slate-900/60 p-6 flex-col justify-between shrink-0">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-pink-400" />
                  Live Student Preview
                </span>
                <span className="text-[10px] text-emerald-400 font-mono font-bold">● LIVE</span>
              </div>

              {/* Mock Student Phone Frame */}
              <div className="rounded-3xl border-4 border-slate-800 bg-slate-950 p-4 shadow-2xl space-y-4 min-h-[460px] flex flex-col justify-between">
                {/* Phone Header */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Q{activeQuestionIndex + 1} of {quizForm.questions.length || 1}</span>
                    <span className="font-mono text-amber-400 font-bold">
                      ⏱️ {draftQuestion.timeLimitSeconds || 30}s
                    </span>
                  </div>
                  <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div className="w-3/4 h-full bg-indigo-500" />
                  </div>
                </div>

                {/* Question on Phone */}
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-center min-h-[90px] flex items-center justify-center">
                  <p className="text-xs font-bold text-white line-clamp-3">
                    {draftQuestion.questionText || "Question preview will appear here..."}
                  </p>
                </div>

                {/* Choices or Blank on Phone */}
                {draftQuestion.questionType === "fill_in_blank" ? (
                  <div className="space-y-2 p-1">
                    <div className="h-10 rounded-xl bg-slate-900 border border-emerald-500/40 px-3 flex items-center justify-between text-xs text-slate-400">
                      <span className="text-emerald-300 font-mono text-[11px] truncate">
                        {draftQuestion.choices[0]?.choiceText
                          ? `Accepted: "${draftQuestion.choices[0].choiceText}"`
                          : "Type your answer in the blank..."}
                      </span>
                      <span className="text-emerald-400 font-bold">↵</span>
                    </div>
                    <div className="text-[10px] text-emerald-400/80 text-center font-semibold">
                      Student types answer in blank box
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {draftQuestion.choices.map((c, i) => (
                      <div
                        key={i}
                        className={`p-2.5 rounded-xl border text-[11px] font-bold text-center truncate ${
                          c.isCorrect
                            ? "bg-emerald-500/20 border-emerald-500 text-emerald-300"
                            : "bg-slate-900 border-slate-800 text-slate-300"
                        }`}
                      >
                        {c.choiceText || `Choice ${String.fromCharCode(65 + i)}`}
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-center text-[10px] text-slate-500 font-semibold">
                  ProctorShieldAI Gamified Exam View
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveQuestionDraft}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white font-black text-xs shadow-md cursor-pointer"
            >
              Apply Question
            </button>
          </aside>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          4. QUIZ SETTINGS MODAL
      ───────────────────────────────────────────────────────────── */}
      {isSettingsOpen && (
        <div
          className="fixed inset-0 z-[950] flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsSettingsOpen(false);
          }}
        >
          <div
            className="relative w-full max-w-lg max-h-[calc(100dvh-2rem)] rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl p-5 sm:p-6 space-y-5 overflow-y-auto my-auto flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <SettingsIcon className="w-5 h-5 text-indigo-400" />
                Quiz Settings
              </h3>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs flex-1 min-h-0 overflow-y-auto pr-1">
              {/* Quiz Mode Selector */}
              <div className="space-y-1.5">
                <label className="block font-bold text-slate-300">Quiz Mode</label>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleToggleMode("proctored")}
                    disabled={isModeLocked && quizForm.quizMode !== "proctored"}
                    className={`flex items-center justify-center gap-2 p-2.5 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                      quizForm.quizMode === "proctored"
                        ? "bg-indigo-600 text-white shadow-md"
                        : "text-slate-400 hover:text-white"
                    } ${isModeLocked && quizForm.quizMode !== "proctored" ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>Live Monitored Exam</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleMode("arena")}
                    disabled={isModeLocked && quizForm.quizMode !== "arena"}
                    className={`flex items-center justify-center gap-2 p-2.5 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                      quizForm.quizMode === "arena"
                        ? "bg-amber-500 text-slate-950 shadow-md"
                        : "text-slate-400 hover:text-white"
                    } ${isModeLocked && quizForm.quizMode !== "arena" ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    <Swords className="w-4 h-4" />
                    <span>Power Arena</span>
                    {!isSubscribed && <Crown className="w-3 h-3 text-amber-400" />}
                  </button>
                </div>
                {isModeLocked && (
                  <p className="text-[11px] text-amber-400/90 flex items-center gap-1.5 mt-1">
                    <Lock className="w-3 h-3 shrink-0" />
                    Quiz mode cannot be changed after students have joined or attempted this quiz.
                  </p>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Subject Name</label>
                <input
                  type="text"
                  value={quizForm.subjectName}
                  onChange={(e) => setQuizForm({ ...quizForm, subjectName: e.target.value })}
                  className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-semibold outline-hidden focus:border-indigo-500"
                />
              </div>

              {/* Mode-Specific Settings: Live Monitored Exam */}
              {quizForm.quizMode === "proctored" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-300 mb-1">Exam Duration (Minutes)</label>
                      <input
                        type="number"
                        min={5}
                        max={480}
                        value={quizForm.duration}
                        onChange={(e) =>
                          setQuizForm({ ...quizForm, duration: parseInt(e.target.value, 10) || 30 })
                        }
                        className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-semibold outline-hidden focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-300 mb-1">Passing Score (%)</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={quizForm.passingScore}
                        onChange={(e) =>
                          setQuizForm({ ...quizForm, passingScore: parseInt(e.target.value, 10) || 70 })
                        }
                        className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-semibold outline-hidden focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={quizForm.shuffleQuestions}
                        onChange={(e) =>
                          setQuizForm({ ...quizForm, shuffleQuestions: e.target.checked })
                        }
                        className="w-4 h-4 rounded text-indigo-600"
                      />
                      <div>
                        <div className="font-bold text-white">Shuffle Questions</div>
                        <div className="text-[11px] text-slate-400">
                          Randomize question order for each student
                        </div>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={quizForm.allowRetake}
                        onChange={(e) => setQuizForm({ ...quizForm, allowRetake: e.target.checked })}
                        className="w-4 h-4 rounded text-indigo-600"
                      />
                      <div>
                        <div className="font-bold text-white">Allow Retakes</div>
                        <div className="text-[11px] text-slate-400">
                          Permit students to request re-attempts
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-indigo-950/20 border border-indigo-500/30 text-indigo-300 text-[11px] leading-relaxed">
                    <div className="font-bold text-white flex items-center gap-1.5 mb-1">
                      <ShieldCheck className="w-4 h-4 text-indigo-400" />
                      Academic Integrity Configuration
                    </div>
                    Camera, microphone, tab lock, and AI proctoring are automatically active for this exam. No game boosters or score multipliers are permitted.
                  </div>
                </>
              )}

              {/* Mode-Specific Settings: Power Arena */}
              {quizForm.quizMode === "arena" && (
                <>
                  <div>
                    <label className="block font-bold text-slate-300 mb-1">Match Duration (Minutes)</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={quizForm.duration}
                      onChange={(e) =>
                        setQuizForm({ ...quizForm, duration: parseInt(e.target.value, 10) || 15 })
                      }
                      className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-semibold outline-hidden focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={quizForm.shuffleQuestions}
                        onChange={(e) =>
                          setQuizForm({ ...quizForm, shuffleQuestions: e.target.checked })
                        }
                        className="w-4 h-4 rounded text-amber-500"
                      />
                      <div>
                        <div className="font-bold text-white">Shuffle Questions</div>
                        <div className="text-[11px] text-slate-400">
                          Randomize question order for all arena combatants
                        </div>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={quizForm.isGamified}
                        onChange={(e) => {
                          if (!isSubscribed && e.target.checked) {
                            alert("Power Arena Battle Powers require an active Pro subscription.");
                            return;
                          }
                          setQuizForm({ ...quizForm, isGamified: e.target.checked });
                        }}
                        className="w-4 h-4 rounded text-amber-500"
                      />
                      <div>
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <Swords className="w-3.5 h-3.5 text-amber-400" />
                          Arena Battle Powers
                          {!isSubscribed && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-400 font-extrabold uppercase">
                              PRO
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Enable Meteors, Earthquakes, Blizzards &amp; Guardian Shields during combat
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-amber-950/25 border border-amber-500/30 text-amber-300 text-[11px] leading-relaxed">
                    <div className="font-bold text-amber-200 flex items-center gap-1.5 mb-1">
                      <Swords className="w-4 h-4 text-amber-400" />
                      Multiplayer Arena Configuration
                    </div>
                    Competitive game mechanics, live leaderboards, and podium rewards are enabled. Camera, microphone, and AI cheating checks are completely disabled.
                  </div>
                </>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          5. STUDENT EXAM PREVIEW MODAL
      ───────────────────────────────────────────────────────────── */}
      {isPreviewOpen && (
        <div
          className="fixed inset-0 z-[950] flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsPreviewOpen(false);
          }}
        >
          <div
            className="relative w-full max-w-3xl max-h-[calc(100dvh-2rem)] rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl p-5 sm:p-8 space-y-6 overflow-y-auto my-auto flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-black text-white">Student Quiz Preview</h3>
              </div>
              <button
                onClick={() => setIsPreviewOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6 flex-1 min-h-0 overflow-y-auto pr-1">
              {quizForm.questions.map((q, idx) => (
                <div
                  key={idx}
                  className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-black text-indigo-400">Question {idx + 1}</span>
                    <span>{q.points} pt</span>
                  </div>
                  <h4 className="text-sm font-bold text-white">{q.questionText}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {q.choices.map((c, cIdx) => (
                      <div
                        key={cIdx}
                        className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                          c.isCorrect
                            ? "bg-emerald-950/40 border-emerald-500/60 text-emerald-300 font-bold"
                            : "bg-slate-900 border-slate-800 text-slate-300"
                        }`}
                      >
                        <span>
                          {String.fromCharCode(65 + cIdx)}. {c.choiceText}
                        </span>
                        {c.isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
