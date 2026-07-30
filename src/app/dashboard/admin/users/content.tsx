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
  subscription?: string;
  subClass?: string;
  joined: string;
}

export default function UsersContent() {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<UserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Edit User Modal State
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editSubStatus, setEditSubStatus] = useState(false);

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
                      <button 
                        onClick={() => {
                          setEditUser(u);
                          setEditSubStatus(u.subscription?.includes("PRO") || false);
                        }}
                        className="text-xs font-semibold text-[var(--muted)] hover:text-indigo-500 cursor-pointer"
                      >
                        Edit
                      </button>
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

      {/* ── EDIT USER MODAL ────────────────────────────────────── */}
      {editUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl scale-in flex flex-col">
            <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface2)]">
              <h3 className="font-bold text-[var(--ink)]">Edit User</h3>
              <button onClick={() => setEditUser(null)} className="text-[var(--muted)] hover:text-white transition-colors">✕</button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto space-y-6">
              
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Name</label>
                <div className="text-sm font-bold text-[var(--ink)] bg-[var(--surface2)] px-3 py-2 rounded-lg border border-[var(--border)]">
                  {editUser.name}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Email</label>
                <div className="text-sm font-bold text-[var(--ink)] bg-[var(--surface2)] px-3 py-2 rounded-lg border border-[var(--border)]">
                  {editUser.email}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Role</label>
                <div className="text-sm font-bold text-[var(--ink)] bg-[var(--surface2)] px-3 py-2 rounded-lg border border-[var(--border)]">
                  {editUser.role}
                </div>
              </div>

              {editUser.role.toLowerCase() === "teacher" && (
                <div className="space-y-2 pt-4 border-t border-[var(--border)]">
                  <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Subscription Status</label>
                  <div className="flex items-center justify-between bg-[var(--surface2)] p-4 rounded-xl border border-[var(--border)]">
                    <div>
                      <h4 className="text-sm font-bold text-[var(--ink)]">AI Pro Subscription</h4>
                      <p className="text-xs text-[var(--muted)] mt-0.5">Manually grant or revoke Pro access</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={editSubStatus}
                        onChange={(e) => setEditSubStatus(e.target.checked)}
                      />
                      <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>
                </div>
              )}

            </div>
            <div className="p-4 border-t border-[var(--border)] bg-[var(--surface2)] flex justify-end gap-3">
              <button 
                onClick={() => setEditUser(null)}
                className="px-4 py-2 rounded-lg font-semibold text-sm border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface)] transition-all"
              >
                Cancel
              </button>
              <button 
                disabled={isSaving}
                onClick={async () => {
                  setIsSaving(true);
                  try {
                    const res = await fetch(`/api/dashboard/admin/users/${editUser.id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        subscriptionStatus: editSubStatus ? "active" : "expired"
                      })
                    });
                    if (res.ok) {
                      setEditUser(null);
                      fetchOnlineUsers(true);
                    } else {
                      const data = await res.json().catch(() => ({}));
                      alert("Failed to update user: " + (data.error || res.statusText));
                    }
                  } catch (e) {
                    alert("Network error.");
                  } finally {
                    setIsSaving(false);
                  }
                }}
                className="px-6 py-2 rounded-lg font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isSaving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
