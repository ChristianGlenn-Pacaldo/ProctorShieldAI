"use client";
import type { PendingQuizRequest, QuizRequestAction } from "../types";
interface Props {
 pendingApprovals: PendingQuizRequest[];
 pendingRetakes: PendingQuizRequest[];
 approvalError: string | null;
 approvalInProgressId: string | null;
 handlePendingApproval: (id: string, action: QuizRequestAction) => Promise<void>;
 handleRetakeApprove: (id: string, action: QuizRequestAction) => Promise<void>;
}
export default function QuizRequestPanels({pendingApprovals,pendingRetakes,approvalError,approvalInProgressId,handlePendingApproval,handleRetakeApprove}: Props) {
 return <>
      {pendingApprovals.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 shadow-xs">
          <h3 className="text-sm font-bold text-amber-500 mb-3 font-[family-name:var(--font-display)]">
            Pending Late-Join Requests ({pendingApprovals.length})
          </h3>
          {approvalError && <p role="alert" className="text-xs font-semibold text-red-500 mb-3">{approvalError}</p>}
          <div className="space-y-2">
            {pendingApprovals.map((request) => (
              <div key={request.studentQuizId} className="flex items-center justify-between gap-3 bg-[var(--surface)] p-3.5 rounded-xl border border-[var(--border)]">
                <div>
                  <div className="text-sm font-bold text-[var(--ink)]">{request.studentName}</div>
                  <div className="text-xs text-[var(--muted)]">Requested late entry for &quot;{request.quizTitle}&quot;</div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={approvalInProgressId !== null}
                    onClick={() => handlePendingApproval(request.studentQuizId, "reject")}
                    className="px-3.5 py-1.5 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-lg border border-red-500/20 disabled:opacity-50"
                  >
                    {approvalInProgressId === request.studentQuizId ? "Working..." : "Reject"}
                  </button>
                  <button
                    type="button"
                    disabled={approvalInProgressId !== null}
                    onClick={() => handlePendingApproval(request.studentQuizId, "accept")}
                    className="px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg disabled:opacity-50"
                  >
                    {approvalInProgressId === request.studentQuizId ? "Working..." : "Approve"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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


 </>;
}
