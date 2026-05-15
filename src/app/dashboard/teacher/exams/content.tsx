"use client";

import { useState } from "react";

const exams = [
  { title: "CS101 Midterm", code: "PS-8821", date: "May 12, 2025 · 2:00 PM", students: 142, proctoring: "AI Enabled", status: "Live Now", statusClass: "bg-amber-500/15 text-amber-600" },
  { title: "ENG102 Finals", code: "PS-3047", date: "May 18, 2025 · 1:00 PM", students: 86, proctoring: "AI Enabled", status: "Scheduled", statusClass: "bg-indigo-500/15 text-indigo-600" },
  { title: "CS101 Quiz 2", code: "PS-7412", date: "May 5, 2025 · 2:00 PM", students: 140, proctoring: "AI Enabled", status: "Completed", statusClass: "bg-emerald-500/15 text-emerald-600" },
];

export default function TeacherExamsPage() {
  const [search, setSearch] = useState("");
  const filtered = exams.filter((e) => e.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">📝 My Created Exams</h3>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search exams..."
              className="w-48 px-3 py-1.5 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-indigo-500/50"
            />
            <button className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface2)] transition-all">
              📸 AI Create
            </button>
            <button className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-all">
              + New Exam
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Exam Title", "Join Code", "Date Scheduled", "Students", "Proctoring", "Status", "Actions"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.map((e) => (
                <tr key={e.title} className="hover:bg-[var(--surface2)] transition-colors">
                  <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{e.title}</td>
                  <td className="px-5 py-3"><code className="join-code">{e.code}</code></td>
                  <td className="px-5 py-3 text-sm text-[var(--muted)]">{e.date}</td>
                  <td className="px-5 py-3 text-sm text-[var(--ink)]">{e.students}</td>
                  <td className="px-5 py-3"><span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-600">{e.proctoring}</span></td>
                  <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${e.statusClass}`}>{e.status}</span></td>
                  <td className="px-5 py-3"><button className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
