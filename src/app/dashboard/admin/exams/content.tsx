"use client";

const exams = [
  { title: "CS101 Midterm", instructor: "Sir Ramos", date: "May 12, 2025", status: "Live", statusClass: "bg-amber-500/15 text-amber-600" },
  { title: "MATH201 Quiz 3", instructor: "Prof. Ana Lim", date: "May 14, 2025", status: "Scheduled", statusClass: "bg-indigo-500/15 text-indigo-600" },
  { title: "CS101 Quiz 2", instructor: "Sir Ramos", date: "May 5, 2025", status: "Completed", statusClass: "bg-emerald-500/15 text-emerald-600" },
];

export default function ExamsContent() {
  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">📝 All System Exams</h3>
          <input placeholder="Search exams..." className="w-48 px-3 py-1.5 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-indigo-500/50" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Exam Title", "Instructor", "Date", "Status", "Actions"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {exams.map((e) => (
                <tr key={e.title} className="hover:bg-[var(--surface2)] transition-colors">
                  <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{e.title}</td>
                  <td className="px-5 py-3 text-sm text-[var(--muted)]">{e.instructor}</td>
                  <td className="px-5 py-3 text-sm text-[var(--muted)]">{e.date}</td>
                  <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${e.statusClass}`}>{e.status}</span></td>
                  <td className="px-5 py-3"><button className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500">View Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
