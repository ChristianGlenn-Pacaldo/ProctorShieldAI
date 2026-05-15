"use client";

import { useState } from "react";

const allUsers = [
  { name: "Juan Dela Cruz", email: "student@demo.com", role: "Student", roleClass: "bg-indigo-500/10 text-indigo-600", status: "Active", statusClass: "bg-emerald-500/10 text-emerald-600", joined: "Mar 15, 2025" },
  { name: "Sir Ramos", email: "teacher@demo.com", role: "Teacher", roleClass: "bg-violet-500/10 text-violet-600", status: "Active", statusClass: "bg-emerald-500/10 text-emerald-600", joined: "Feb 8, 2025" },
  { name: "Admin User", email: "admin@proctorshield.ai", role: "Admin", roleClass: "bg-red-500/10 text-red-500", status: "Active", statusClass: "bg-emerald-500/10 text-emerald-600", joined: "Jan 1, 2025" },
  { name: "Maria Santos", email: "maria@demo.com", role: "Student", roleClass: "bg-indigo-500/10 text-indigo-600", status: "Active", statusClass: "bg-emerald-500/10 text-emerald-600", joined: "Apr 2, 2025" },
  { name: "Ethan Reyes", email: "ethan@demo.com", role: "Student", roleClass: "bg-indigo-500/10 text-indigo-600", status: "Suspended", statusClass: "bg-red-500/10 text-red-500", joined: "Jan 20, 2025" },
  { name: "Prof. Ana Lim", email: "ana@demo.com", role: "Teacher", roleClass: "bg-violet-500/10 text-violet-600", status: "Active", statusClass: "bg-emerald-500/10 text-emerald-600", joined: "May 10, 2025" },
];

export default function UsersContent() {
  const [search, setSearch] = useState("");
  const filtered = allUsers.filter((u) => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">👥 All Users</h3>
          <div className="flex gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users..." className="w-48 px-3 py-1.5 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-indigo-500/50" />
            <button className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-all">+ Add User</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["User", "Email", "Role", "Status", "Joined Date", "Actions"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.map((u) => (
                <tr key={u.email} className="hover:bg-[var(--surface2)] transition-colors">
                  <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{u.name}</td>
                  <td className="px-5 py-3 text-sm text-[var(--muted)]">{u.email}</td>
                  <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${u.roleClass}`}>{u.role}</span></td>
                  <td className="px-5 py-3"><span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${u.statusClass}`}>{u.status}</span></td>
                  <td className="px-5 py-3 text-sm text-[var(--muted)]">{u.joined}</td>
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
