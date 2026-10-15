"use client";
import { Search, Sparkles, Crown, Plus, Trophy, Gamepad2, Radio, Pencil } from "lucide-react";
import { FREE_STUDENT_LIMIT_PER_QUIZ, PRO_STUDENT_LIMIT_PER_QUIZ } from "@/lib/subscription-rules";
import type { TeacherQuizSummary } from "../types";
interface Props {
 quizzes: TeacherQuizSummary[]; filtered: TeacherQuizSummary[];
 search: string; setSearch: (value: string) => void;
 isSubscribed: boolean; isCheckingSub: boolean; manualQuizCount: number; manualQuizLimit: number;
 loadError: string | null; isLoading: boolean;
 fetchQuizzes: () => Promise<boolean>;
 openNewQuizStudio: (mode: "proctored" | "arena") => void;
 onOpenAiGenerator: () => void;
 handleEditQuizInStudio: (quiz: TeacherQuizSummary) => Promise<void>;
 setManageQuiz: (quiz: TeacherQuizSummary | null) => void;
 startQuiz: (quiz: TeacherQuizSummary) => Promise<void>;
 router: {push: (href: string) => void};
}
export default function TeacherQuizLibrary({quizzes,filtered,search,setSearch,isSubscribed,isCheckingSub,manualQuizCount,manualQuizLimit,loadError,isLoading,fetchQuizzes,openNewQuizStudio,onOpenAiGenerator,handleEditQuizInStudio,setManageQuiz,startQuiz,router}: Props) {
 return (
      <div className="ps-teacher-glass-card bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-xs">
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
                className="ps-teacher-glass-dense w-full sm:w-48 pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            <button
              onClick={onOpenAiGenerator}
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
              onClick={() => openNewQuizStudio("proctored")}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> {isSubscribed ? "New Quiz" : "Manual Quiz"}
            </button>
          </div>
        </div>

        <div role="region" aria-label="Teacher quiz library" tabIndex={0} className="ps-teacher-glass-dense min-w-0 max-w-full overflow-x-auto min-h-[300px]">
          {loadError && (
            <div role="alert" className="flex items-center justify-between gap-4 border-b border-rose-500/30 bg-rose-500/10 px-5 py-3 text-sm text-rose-600 dark:text-rose-400">
              <span>{loadError}</span>
              <button type="button" onClick={() => void fetchQuizzes()} className="font-bold underline">Retry</button>
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : loadError && quizzes.length === 0 ? null : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-[var(--muted)]">
              <span className="text-2xl mb-2">📄</span>
              <p className="text-sm font-semibold">No quizzes found</p>
            </div>
          ) : (
            <table className="ps-teacher-quiz-table w-full min-w-[1180px]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Quiz Title", "Mode", "Subject", "Join Code", "Questions", "Students", "Status", "Actions"].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide"
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
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex whitespace-nowrap text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                          e.quizMode === "arena"
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25"
                            : "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/20"
                        }`}
                      >
                        {e.quizMode === "arena" ? "Power Arena" : "Live Monitored Exam"}
                      </span>
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
                        className={`inline-flex whitespace-nowrap text-[10px] font-bold px-2.5 py-1 rounded-full ${
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
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        {/* Arena Host vs Review Results vs Live Monitor Flow */}
                        {e.quizMode === "arena" ? (
                          e.quizStatus === "ended" ? (
                            <button
                              onClick={() => router.push(`/dashboard/teacher/playground/arena/${e.id}`)}
                              className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 transition-all cursor-pointer"
                              title="Review Final Power Arena Results"
                            >
                              <Trophy className="w-3.5 h-3.5" />
                              <span>Review Results</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => router.push(`/dashboard/teacher/playground/arena/${e.id}`)}
                              className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 hover:bg-amber-500/20 transition-all cursor-pointer"
                              title="Host Power Arena Game Station"
                            >
                              <Gamepad2 className="w-3.5 h-3.5" />
                              <span>Host Arena</span>
                            </button>
                          )
                        ) : (
                          <button
                            onClick={() => router.push(`/dashboard/teacher/monitor?quizId=${e.id}`)}
                            className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20 transition-all cursor-pointer"
                            title="Open Live Examination Monitor"
                          >
                            <Radio className="w-3.5 h-3.5" />
                            <span>Monitor Exam</span>
                          </button>
                        )}

                        {/* Edit in ProctorShield Studio (Dual Overview & 2x2 Question Studio) */}
                        <button
                          onClick={() => handleEditQuizInStudio(e)}
                          className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 hover:bg-indigo-500/20 transition-all cursor-pointer"
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

                        {e.quizStatus === "active" && e.quizMode !== "arena" && (
                          <button
                            onClick={() => startQuiz(e)}
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


 );
}
