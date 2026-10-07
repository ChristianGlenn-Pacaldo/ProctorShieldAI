"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Info, RefreshCw } from "lucide-react";
import { UserSessionReauthentication, useUserSessionWork } from "@/components/user-session-lifecycle";
import type { AIReport, AIReportsResponse, ReportRole } from "@/lib/ai-reports";

function reportStatus(report: AIReport) {
  if (report.integrityInvalidated) return { label: "Result invalidated", classes: "bg-rose-500/15 text-rose-600" };
  if (!report.isCompleted) return { label: "Monitoring recorded", classes: "bg-slate-500/15 text-slate-500" };
  if (!report.analysisCurrent) return { label: "Analysis pending", classes: "bg-slate-500/15 text-slate-500" };
  if (report.violationCount === 0 && report.aiVerdict === "clean") return { label: "Clean", classes: "bg-emerald-500/15 text-emerald-600" };
  return { label: "Review", classes: "bg-amber-500/15 text-amber-600" };
}

function ReportCard({ report, role }: { report: AIReport; role: ReportRole }) {
  const status = reportStatus(report);
  return <article className="min-w-0 rounded-xl border border-[var(--border)] p-4">
    <div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h4 className="break-words text-sm font-semibold text-[var(--ink)]">{report.quiz.title}</h4>
        {role === "teacher" && <p className="mt-1 break-words text-xs font-semibold text-[var(--ink)]">{report.student?.fullName}</p>}
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Attempt {report.attemptNumber} · {new Date(report.startTime ?? report.createdAt).toLocaleString()} · {report.quizStatus?.replaceAll("_", " ") ?? "Status unavailable"}
        </p>
        <p className="mt-1 break-all text-[10px] text-[var(--muted)]">Attempt ID: {report.id}</p>
      </div>
      <span className={"inline-flex w-fit shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase " + status.classes}>{status.label}</span>
    </div>
    <p className="mb-1 text-[10px] font-semibold uppercase text-[var(--muted)]">{report.analysisCurrent ? "Saved AI summary" : "Analysis status"}</p>
    <p className="mb-3 break-words text-xs leading-relaxed text-[var(--muted)]">
      {report.analysisCurrent
        ? report.aiAnalysis?.aiExplanation || "Review the recorded events below."
        : report.aiAnalysis ? "The saved AI summary is outdated. The recorded timeline and count below are current."
        : "AI analysis is not available yet. Recorded events are listed below."}
    </p>
    <div className="mb-4 flex flex-wrap gap-2">
      <span className="rounded-full bg-indigo-500/10 px-2.5 py-1 text-[10px] font-bold text-indigo-600">Violations: {report.violationCount}</span>
      <span className="rounded-full bg-slate-500/10 px-2.5 py-1 text-[10px] font-bold text-[var(--muted)]">
        Score: {report.integrityInvalidated ? "Invalidated" : !report.isCompleted || report.score == null ? "Pending" : report.score + "%"}
      </span>
      {report.analysisCurrent && report.violationCount > 0 && report.cheatingProbability !== null && <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold text-violet-600">
        Saved AI risk estimate: {report.cheatingProbability}%
      </span>}
    </div>
    {report.violations.length === 0 ? <p className="text-xs text-[var(--muted)]">No monitoring events recorded.</p> : <ol aria-label="Recorded violation timeline" className="space-y-3 border-t border-[var(--border)] pt-3">
      {report.violations.map((event) => <li key={event.id} data-event-id={event.id} className="rounded-lg bg-[var(--surface2)] p-3 text-xs">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="font-semibold text-[var(--ink)]">{event.label}</span>
          <time dateTime={event.timestamp} className="text-[var(--muted)]">{new Date(event.timestamp).toLocaleString()}</time>
        </div>
        <p className="mt-1 break-all text-[10px] text-[var(--muted)]">Event ID: {event.id} · Type: {event.violationType ?? "Unspecified"}</p>
        <p className="mt-1 text-[var(--muted)]">
          {event.confidenceScore !== null && <span>Recorded confidence: {event.confidenceScore}%</span>}
          {event.durationSeconds !== null && <span> · Evidence duration: {event.durationSeconds}s</span>}
        </p>
        {event.evidence.metadataUnavailable && <p className="mt-2 text-[var(--muted)]">Evidence metadata could not be loaded. The recorded event is preserved.</p>}
        {(event.evidence.records.length > 0 || event.evidence.hasLegacyEvidence) && <div className="mt-2 text-[var(--muted)]">
          <p>Evidence records: {event.evidence.records.length}{event.evidence.hasLegacyEvidence ? " · Legacy capture recorded" : ""}</p>
          {event.evidence.records.map((file) => <p key={file.id} className="break-all text-[10px]">Evidence ID: {file.id} · {file.fileType ?? "Media"} · Uploaded {new Date(file.uploadedAt).toLocaleString()}</p>)}
          {role === "teacher" && event.evidence.reviewUrl
            ? <a href={event.evidence.reviewUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-semibold text-indigo-600 underline">Review retained evidence</a>
            : <p className="mt-1">Evidence media is available to your instructor, subject to retention.</p>}
        </div>}
        {event.evidence.records.length === 0 && !event.evidence.hasLegacyEvidence && !event.evidence.metadataUnavailable && <p className="mt-2 text-[var(--muted)]">No evidence media recorded for this event.</p>}
      </li>)}
    </ol>}
  </article>;
}

export default function AIReports({ role }: { role: ReportRole }) {
  const [data, setData] = useState<AIReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const filtersRef = useRef({ search: "", type: "" });
  const pageRef = useRef(1);
  const sequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const { work, loss } = useUserSessionWork(() => { setData(null); setError(""); });

  const loadReports = useCallback(async (requestedPage = pageRef.current, background = false) => {
    if (background && (activeRequest.current || document.visibilityState !== "visible")) return;
    const request = work.beginRequest();
    if (!request) return;
    activeRequest.current?.abort();
    activeRequest.current = request.controller;
    const requestId = ++sequence.current;
    const params = new URLSearchParams({ page: String(requestedPage) });
    if (filtersRef.current.search) params.set("search", filtersRef.current.search);
    if (filtersRef.current.type) params.set("type", filtersRef.current.type);
    if (!background) { pageRef.current = requestedPage; setLoading(true); }
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; request.controller.abort(); }, 15_000);
    try {
      const response = await fetch("/api/dashboard/" + role + "/reports?" + params, { cache: "no-store", signal: request.controller.signal });
      if (!await work.acceptResponse(response, request) || requestId !== sequence.current) return;
      const payload = await response.json();
      if (requestId !== sequence.current || !work.isCurrent(request.generation)) return;
      if (response.status === 403 && payload.code === "SUBSCRIPTION_REQUIRED") {
        setSubscriptionRequired(true); setData(null); setError(""); return;
      }
      if (!response.ok || !payload.success || !Array.isArray(payload.reports)
        || !Array.isArray(payload.types) || !Number.isSafeInteger(payload.totalReports) || payload.totalReports < 0
        || !Number.isSafeInteger(payload.totalViolations) || payload.totalViolations < 0
        || !Number.isSafeInteger(payload.page) || payload.page < 1
        || !Number.isSafeInteger(payload.pageSize) || payload.pageSize < 1
        || !Number.isSafeInteger(payload.pageCount) || payload.pageCount < 1) {
        throw new Error("Unable to load AI reports");
      }
      setData(payload); pageRef.current = payload.page; setSubscriptionRequired(false); setError("");
    } catch {
      if (requestId === sequence.current && work.isCurrent(request.generation) && (!request.controller.signal.aborted || timedOut)) {
        setError(timedOut ? "AI reports request timed out. Please try again." : "Could not load AI Reports. Please try again.");
      }
    } finally {
      window.clearTimeout(timeout);
      work.finishRequest(request.controller);
      if (requestId === sequence.current) { activeRequest.current = null; setLoading(false); }
    }
  }, [role, work]);

  useEffect(() => {
    void loadReports();
    const refresh = () => { void loadReports(pageRef.current, true); };
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const dispose = work.addCleanup(() => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    });
    return () => { sequence.current++; activeRequest.current?.abort(); dispose(); };
  }, [loadReports, work]);

  const filterReports = (nextType = type) => {
    filtersRef.current = { search: search.trim(), type: nextType };
    setData(null);
    void loadReports(1);
  };
  if (loss) return <UserSessionReauthentication status={loss} />;

  return <div className="animate-fade-in">
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-indigo-500" /><h3 className="text-sm font-bold text-[var(--ink)]">{role === "teacher" ? "Class AI Integrity Reports" : "My AI Integrity Reports"}</h3></div>
        <button type="button" onClick={() => void loadReports()} className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-600"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-3 rounded-xl border border-indigo-500/15 bg-indigo-500/5 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
          <div className="min-w-0"><div className="text-sm font-semibold text-[var(--ink)]">Recorded monitoring history</div><p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
            Reports list saved events from monitored quiz attempts, including attempts awaiting retakes and active attempts with recorded events. An event requires review and does not by itself prove cheating. Evidence media availability follows retention.
          </p></div>
        </div>
        {subscriptionRequired ? <div className="rounded-xl border border-indigo-500/20 p-4 text-sm text-[var(--muted)]"><p>AI Reports require an active Pro subscription.</p><a href="/dashboard/teacher/billing" className="mt-2 inline-block font-semibold text-indigo-600 underline">View Billing &amp; Plan</a></div> : <>
          <form onSubmit={(event) => { event.preventDefault(); filterReports(); }} className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 basis-52 text-xs text-[var(--muted)]">Search {role === "teacher" ? "quiz or student" : "quiz"}<input value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] p-2 text-[var(--ink)]" /></label>
            <label className="min-w-0 max-w-full text-xs text-[var(--muted)]">Reports containing event<select value={type} onChange={(event) => { setType(event.target.value); filterReports(event.target.value); }} className="mt-1 block max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] p-2 text-[var(--ink)]">
              <option value="">All recorded types</option>
              {(data?.types ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              {type && !data?.types.some((option) => option.value === type) && <option value={type}>{type}</option>}
            </select></label>
            <button type="submit" className="rounded-lg bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-600">Search</button>
            <button type="button" onClick={() => { setSearch(""); setType(""); filtersRef.current = { search: "", type: "" }; setData(null); void loadReports(1); }} className="px-3 py-2 text-xs text-[var(--muted)]">Clear filters</button>
          </form>
          {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-600"><span>{error}</span><button type="button" onClick={() => void loadReports()} className="font-bold underline">Retry</button></div>}
          {loading && <p role="status" className="text-sm text-[var(--muted)]">Loading integrity reports...</p>}
          {data && <>
            <div className="flex flex-wrap gap-3 text-xs font-semibold text-[var(--muted)]"><span>Reports: {data.totalReports}</span><span>Recorded violations: {data.totalViolations}</span></div>
            {data.filters.type && <p className="text-xs text-[var(--muted)]">Showing attempts containing the selected event type. Each timeline includes all events recorded for that attempt.</p>}
            {data.reports.length === 0 ? <p className="py-8 text-center text-sm text-[var(--muted)]">No matching monitored quiz reports.</p> : data.reports.map((report) => <ReportCard key={report.id} report={report} role={role} />)}
            <nav aria-label="Report pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4 text-xs">
              <button type="button" disabled={loading || data.page <= 1} onClick={() => void loadReports(data.page - 1)} className="font-semibold text-indigo-600 disabled:opacity-40">Previous</button>
              <span className="text-[var(--muted)]">Page {data.page} of {data.pageCount}</span>
              <button type="button" disabled={loading || data.page >= data.pageCount} onClick={() => void loadReports(data.page + 1)} className="font-semibold text-indigo-600 disabled:opacity-40">Next</button>
            </nav>
          </>}
        </>}
      </div>
    </div>
  </div>;
}
