"use client";

const logs = [
  { time: "14:23:45 today", event: "Object Detected: Phone", severity: "High", severityClass: "bg-red-500/15 text-red-500", student: "Ethan Reyes", examId: "EX-1044", rowBg: "bg-red-50 dark:bg-red-500/5" },
  { time: "14:31:12 today", event: "Multiple Faces Detected", severity: "Medium", severityClass: "bg-amber-500/15 text-amber-600", student: "Carlo Mendoza", examId: "EX-1044", rowBg: "bg-amber-50 dark:bg-amber-500/5" },
  { time: "09:15:00 yesterday", event: "Tab Switched", severity: "Medium", severityClass: "bg-amber-500/15 text-amber-600", student: "Maria Santos", examId: "EX-1042", rowBg: "" },
];

export default function LogsContent() {
  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">🧠 Global AI Event Logs</h3>
          <button className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500 transition-colors">Export CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Timestamp", "Event Type", "Severity", "Student", "Exam ID"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {logs.map((l) => (
                <tr key={l.time + l.student} className={`${l.rowBg} hover:bg-[var(--surface2)] transition-colors`}>
                  <td className="px-5 py-3 text-sm text-[var(--muted)]">{l.time}</td>
                  <td className="px-5 py-3 text-sm font-medium text-[var(--ink)]">{l.event}</td>
                  <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${l.severityClass}`}>{l.severity}</span></td>
                  <td className="px-5 py-3 text-sm text-[var(--ink)]">{l.student}</td>
                  <td className="px-5 py-3 text-sm text-[var(--muted)] font-mono">{l.examId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
