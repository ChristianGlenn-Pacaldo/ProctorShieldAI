"use client";
import { createPortal } from "react-dom";
import { Trophy, Gamepad2, Radio, Pencil, Trash } from "lucide-react";
import { FREE_STUDENT_LIMIT_PER_QUIZ, PRO_STUDENT_LIMIT_PER_QUIZ } from "@/lib/subscription-rules";
import type { TeacherQuizSummary } from "../types";
interface Props {
 manageQuiz: TeacherQuizSummary; isSubscribed: boolean; actionError: string | null;
 isUpdatingStatus: boolean; isDeleting: boolean;
 setManageQuiz: (quiz: TeacherQuizSummary | null) => void;
 updateQuizDuration: (quiz: TeacherQuizSummary, value: string) => Promise<void>;
 handleEditQuizInStudio: (quiz: TeacherQuizSummary) => Promise<void>;
 toggleQuizStatus: (quiz: TeacherQuizSummary) => Promise<void>;
 endQuiz: (quiz: TeacherQuizSummary) => Promise<void>;
 deleteQuiz: (quiz: TeacherQuizSummary) => Promise<void>;
 updateRetakeSetting: (quiz: TeacherQuizSummary, allowRetake: boolean) => Promise<void>;
 router: {push: (href: string) => void};
}
export default function ManageQuizDialog({manageQuiz,isSubscribed,actionError,isUpdatingStatus,isDeleting,setManageQuiz,updateQuizDuration,handleEditQuizInStudio,toggleQuizStatus,endQuiz,deleteQuiz,updateRetakeSetting,router}: Props) {
 return createPortal(
        <div
          className="teacher-content app-modal-backdrop bg-black/80 backdrop-blur-md"
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
              {actionError && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-600 dark:text-rose-400">{actionError}</div>}
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
                    max="480"
                    disabled={["in_progress", "ended"].includes(manageQuiz.quizStatus)}
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

              {/* Host Arena or Monitor Flow */}
              <div className="flex items-center justify-between p-3.5 bg-[var(--surface2)] rounded-xl border border-[var(--border)]">
                <div>
                  <div className="text-xs font-bold text-[var(--ink)] flex items-center gap-1.5">
                    {manageQuiz.quizMode === "arena" ? (
                      manageQuiz.quizStatus === "ended" ? (
                        <>
                          <Trophy className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Power Arena Results</span>
                        </>
                      ) : (
                        <>
                          <Gamepad2 className="w-3.5 h-3.5 text-amber-500" />
                          <span>Power Arena Host</span>
                        </>
                      )
                    ) : (
                      <>
                        <Radio className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Live Proctoring Monitor</span>
                      </>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--muted)] mt-0.5">
                    {manageQuiz.quizMode === "arena"
                      ? manageQuiz.quizStatus === "ended"
                        ? "Review the final championship podium, scores, and full leaderboard"
                        : "Launch the interactive Arena game board and battle controls"
                      : "Monitor examinee webcams, audio anomalies, and AI violations"}
                  </div>
                </div>
                {manageQuiz.quizMode === "arena" ? (
                  manageQuiz.quizStatus === "ended" ? (
                    <button
                      onClick={() => {
                        const qId = manageQuiz.id;
                        setManageQuiz(null);
                        router.push(`/dashboard/teacher/playground/arena/${qId}`);
                      }}
                      className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <Trophy className="w-3.5 h-3.5" /> Review Results
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const qId = manageQuiz.id;
                        setManageQuiz(null);
                        router.push(`/dashboard/teacher/playground/arena/${qId}`);
                      }}
                      className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <Gamepad2 className="w-3.5 h-3.5" /> Arena Host
                    </button>
                  )
                ) : (
                  <button
                    onClick={() => {
                      const qId = manageQuiz.id;
                      setManageQuiz(null);
                      router.push(`/dashboard/teacher/monitor?quizId=${qId}`);
                    }}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <Radio className="w-3.5 h-3.5" /> Open Monitor
                  </button>
                )}
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

              {manageQuiz.quizMode !== "arena" && <>
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
                  onChange={(event) => updateRetakeSetting(manageQuiz, event.target.checked)}
                  className="h-4 w-4"
                />
              </label>
              </>}
              {manageQuiz.quizMode === "arena" && <p className="text-xs text-[var(--muted)]">One-time match. Use Arena Host to open the lobby, start or end the match, and review results.</p>}
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
      );
}
