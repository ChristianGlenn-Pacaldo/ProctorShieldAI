"use client";

import { useState, useEffect } from "react";
import PusherClient from "pusher-js";

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  roleClass: string;
  status: string;
  statusClass: string;
  joined: string;
}

export default function UsersContent() {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<UserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch online users from admin dashboard API
  const fetchOnlineUsers = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch("/api/dashboard/admin");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error("Failed to load online users:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOnlineUsers();

    // Set up Pusher subscription for real-time user online status updates
    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774";
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1";

    const pusher = new PusherClient(pusherKey, {
      cluster: pusherCluster,
    });

    const channel = pusher.subscribe("admin-dashboard");

    // Re-fetch online users on any login/logout activity
    channel.bind("activity", (data: any) => {
      console.log("Admin Users page received real-time activity:", data);
      if (data.type === "login" || data.type === "logout") {
        fetchOnlineUsers(true);
      }
    });

    return () => {
      pusher.unsubscribe("admin-dashboard");
      pusher.disconnect();
    };
  }, []);

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-sm font-bold text-[var(--ink)]">👥 Online Users</h3>
            <p className="text-[10px] text-[var(--muted)] mt-0.5">Currently active logged-in sessions</p>
          </div>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search online users..."
              className="w-48 px-3 py-1.5 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-indigo-500/50"
            />
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
              {isLoading && users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <div className="inline-block w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-xs text-[var(--muted)]">
                    No online users found matching criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-[var(--surface2)] transition-colors animate-fade-in">
                    <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">{u.name}</td>
                    <td className="px-5 py-3 text-sm text-[var(--muted)]">{u.email}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${u.roleClass}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${u.statusClass}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-[var(--muted)]">{u.joined}</td>
                    <td className="px-5 py-3 flex gap-2">
                      <button className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500 cursor-pointer">Edit</button>
                      {u.status === "Suspended" ? (
                        <button className="text-xs font-semibold text-emerald-500 hover:text-emerald-600 cursor-pointer">Restore</button>
                      ) : (
                        <button className="text-xs font-semibold text-red-400 hover:text-red-500 cursor-pointer">Suspend</button>
                      )}
                    </td>
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
