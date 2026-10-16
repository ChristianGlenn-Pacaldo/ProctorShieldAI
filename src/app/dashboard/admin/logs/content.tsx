"use client";

import { useState, useEffect } from "react";
import { Printer } from "lucide-react";

interface LogEntry {
  id: string;
  timestamp: string;
  event: string;
  severity?: "High" | "Medium" | "Low";
  student: string;
  quiz: string;
  confidence: string;
}

export default function LogsContent() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchLogs = async (requestedPage = page) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/dashboard/admin/logs?page=${requestedPage}`);
      if (!response.ok) throw new Error(`Logs request failed: ${response.status}`);
      const data = await response.json();
      if (!data.success) throw new Error("Logs response was unsuccessful");
      setLogs(data.logs || []);
      setTotal(data.total || 0);
      setPage(data.page);
      setPageSize(data.pageSize);
      setLoadError(null);
    } catch (error) {
      console.error("Failed to load logs:", error);
      setLoadError("Could not load Admin AI Logs. Existing data may be out of date.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1);
  }, []);

  const handlePrint = () => {
    if (isLoading || loadError || logs.length === 0) return;
    window.print();
  };

  return (
    <div className="ps-ai-log-report ps-admin-glass-canvas animate-fade-in">
      <div className="ps-admin-glass-card bg-[var(--surface)] rounded-xl border border-[var(--border)]">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">🧠 Global AI Event Logs</h3>
            <p className="ps-admin-glass-caption text-[10px] text-[var(--muted)] mt-0.5">{total} violation events recorded</p>
            <div className="ps-ai-log-legend" aria-label="Event review priority">
              <span>Review priority:</span>
              {(["High", "Medium", "Low"] as const).map((priority) => (
                <span key={priority} className="ps-ai-log-badge" data-priority={priority}>
                  <span className="ps-ai-log-dot" aria-hidden="true" />{priority}
                </span>
              ))}
            </div>
            <p className="ps-ai-log-print-summary hidden">ProctorShieldAI · Page {page} of {Math.max(1, Math.ceil(total / pageSize))} · Displayed records {total === 0 ? 0 : (page - 1) * pageSize + 1}–{(page - 1) * pageSize + logs.length} of {total}</p>
          </div>
          <button
            type="button"
            onClick={handlePrint}
            disabled={isLoading || !!loadError || logs.length === 0}
            title="Print the displayed page or choose Save as PDF in the print dialog"
            className="ps-ai-log-print-controls flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)] hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-40"
          >
            <Printer aria-hidden="true" className="w-3.5 h-3.5" />
            Print / Save as PDF
          </button>
        </div>
        {loadError && (
          <div role="alert" className="flex items-center justify-between gap-3 border-b border-rose-500/30 bg-rose-500/10 px-5 py-3 text-xs text-rose-600 dark:text-rose-400">
            <span>{loadError}</span>
            <button type="button" disabled={isLoading} onClick={() => fetchLogs()} className="font-semibold underline disabled:opacity-50">
              {isLoading ? "Retrying..." : "Retry"}
            </button>
          </div>
        )}
        <div className="ps-admin-table-scroll ps-admin-glass-dense overflow-x-auto" role="region" aria-label="Admin AI event logs" tabIndex={0}>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface2)]/50">
                {["Timestamp", "Event Type", "Confidence", "Student", "Quiz"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading && logs.length === 0 && !loadError ? (
                <tr>
                  <td colSpan={5} className="text-center py-12">
                    <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  </td>
                </tr>
              ) : loadError && logs.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-10 text-sm text-[var(--muted)]">AI Logs are unavailable. Use Retry above.</td></tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-sm text-[var(--muted)]">
                    No AI violation events recorded yet.
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className="ps-ai-log-row transition-colors">
                    <td className="px-5 py-3 text-xs text-[var(--muted)] font-mono whitespace-nowrap">{l.timestamp}</td>
                    <td className="px-5 py-3 text-sm font-medium text-[var(--ink)]">
                      <span className="ps-ai-log-badge" data-priority={l.severity || "Low"} aria-label={`${l.severity || "Low"} review priority: ${l.event}`}>
                        <span className="ps-ai-log-dot" aria-hidden="true" />{l.event}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-[var(--muted)] font-mono">{l.confidence}</td>
                    <td className="px-5 py-3 text-sm text-[var(--ink)] font-medium">{l.student}</td>
                    <td className="px-5 py-3 text-xs text-[var(--muted)] max-w-[160px] truncate">{l.quiz}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="ps-admin-pagination flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--muted)]">
          <span>
            Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}–{(page - 1) * pageSize + logs.length} of {total}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={isLoading || page <= 1} onClick={() => fetchLogs(page - 1)} className="font-semibold text-[var(--ink)] disabled:opacity-40">Previous</button>
            <span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
            <button type="button" disabled={isLoading || page >= Math.ceil(total / pageSize)} onClick={() => fetchLogs(page + 1)} className="font-semibold text-[var(--ink)] disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
