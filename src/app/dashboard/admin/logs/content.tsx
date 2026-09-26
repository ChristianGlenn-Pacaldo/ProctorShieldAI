"use client";

import { useState, useEffect } from "react";
import { Download } from "lucide-react";

interface LogEntry {
  id: string;
  timestamp: string;
  event: string;
  severity: string;
  severityClass: string;
  rowBg: string;
  student: string;
  quiz: string;
  confidence: string;
}

export default function LogsContent() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/dashboard/admin/logs");
      if (!response.ok) throw new Error(`Logs request failed: ${response.status}`);
      const data = await response.json();
      if (!data.success) throw new Error("Logs response was unsuccessful");
      setLogs(data.logs || []);
      setTotal(data.total || 0);
      setLoadError(null);
    } catch (error) {
      console.error("Failed to load logs:", error);
      setLoadError("Could not load Admin AI Logs. Existing data may be out of date.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleExportCSV = () => {
    if (logs.length === 0) return;
    const headers = ["Timestamp", "Event Type", "Severity", "Confidence", "Student", "Quiz"];
    const rows = logs.map((l) => [l.timestamp, l.event, l.severity, l.confidence, l.student, l.quiz]);
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-violation-logs-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">🧠 Global AI Event Logs</h3>
            <p className="text-[10px] text-[var(--muted)] mt-0.5">{total} violation events recorded</p>
          </div>
          <button
            onClick={handleExportCSV}
            disabled={logs.length === 0}
            className="flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)] hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
        {loadError && (
          <div role="alert" className="flex items-center justify-between gap-3 border-b border-rose-500/30 bg-rose-500/10 px-5 py-3 text-xs text-rose-600 dark:text-rose-400">
            <span>{loadError}</span>
            <button type="button" disabled={isLoading} onClick={fetchLogs} className="font-semibold underline disabled:opacity-50">
              {isLoading ? "Retrying..." : "Retry"}
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface2)]/50">
                {["Timestamp", "Event Type", "Severity", "Confidence", "Student", "Quiz"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading && logs.length === 0 && !loadError ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  </td>
                </tr>
              ) : loadError && logs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-sm text-[var(--muted)]">AI Logs are unavailable. Use Retry above.</td></tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-sm text-[var(--muted)]">
                    No AI violation events recorded yet.
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className={`${l.rowBg} hover:bg-[var(--surface2)]/70 transition-colors`}>
                    <td className="px-5 py-3 text-xs text-[var(--muted)] font-mono whitespace-nowrap">{l.timestamp}</td>
                    <td className="px-5 py-3 text-sm font-medium text-[var(--ink)]">{l.event}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${l.severityClass}`}>{l.severity}</span>
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
      </div>
    </div>
  );
}
