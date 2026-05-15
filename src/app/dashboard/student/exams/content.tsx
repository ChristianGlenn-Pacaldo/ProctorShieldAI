"use client";

const exams = [
  { title: "CS101 Midterm", subject: "Intro to Computing", date: "May 12, 2025 · 2:00 PM", duration: "90 min", status: "Pending", statusClass: "bg-indigo-500/15 text-indigo-600", canTake: true },
  { title: "MATH201 Quiz 3", subject: "Calculus II", date: "May 14, 2025 · 10:00 AM", duration: "45 min", status: "Upcoming", statusClass: "bg-amber-500/15 text-amber-600", canTake: false },
  { title: "ENG102 Finals", subject: "Technical Writing", date: "May 18, 2025 · 1:00 PM", duration: "120 min", status: "Upcoming", statusClass: "bg-amber-500/15 text-amber-600", canTake: false },
  { title: "CS101 Quiz 2", subject: "Intro to Computing", date: "May 5, 2025 · 2:00 PM", duration: "60 min", status: "Completed", statusClass: "bg-emerald-500/15 text-emerald-600", canTake: false },
];

export default function ExamsContent() {
  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">📝 All Exams</h3>
          <input placeholder="Search exams..." className="w-48 px-3 py-1.5 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-indigo-500/50" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Exam Title", "Subject", "Date & Time", "Duration", "Status", "Action"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {exams.map((e) => (
                <tr key={e.title} className="hover:bg-[var(--surface2)] transition-colors">
                  <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{e.title}</td>
                  <td className="px-5 py-3 text-sm text-[var(--muted)]">{e.subject}</td>
                  <td className="px-5 py-3 text-sm text-[var(--muted)]">{e.date}</td>
                  <td className="px-5 py-3 text-sm text-[var(--ink)]">{e.duration}</td>
                  <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${e.statusClass}`}>{e.status}</span></td>
                  <td className="px-5 py-3">
                    {e.canTake ? (
                      <button className="text-xs font-bold text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-500 transition-all">Take Exam</button>
                    ) : e.status === "Completed" ? (
                      <button className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500">View Result</button>
                    ) : (
                      <button disabled className="text-xs font-semibold text-[var(--muted2)] cursor-not-allowed">Not Yet</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
