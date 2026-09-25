"use client";

import { useState, useEffect } from "react";
import PusherClient from "pusher-js";
import { Search, CheckCircle2, XCircle, RefreshCw } from "lucide-react";

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
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Edit User Modal State
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editSubStatus, setEditSubStatus] = useState(false);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchUsers = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch("/api/dashboard/admin");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error("Failed to load users:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();

    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774";
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1";
    const pusher = new PusherClient(pusherKey, { cluster: pusherCluster, authEndpoint: "/api/pusher/auth" });
    const channel = pusher.subscribe("private-admin-dashboard");
    channel.bind("activity", (data: any) => {
      if (["login", "logout", "user_update"].includes(data.type)) {
        fetchUsers(true);
      }
    });
    return () => {
      pusher.unsubscribe("private-admin-dashboard");
      pusher.disconnect();
    };
  }, []);

  const handleStatusChange = async (userId: string, newStatus: "active" | "suspended", userName: string) => {
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/dashboard/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        showToast(
          newStatus === "suspended" ? `${userName} has been suspended.` : `${userName} has been restored.`,
          "success"
        );
        fetchUsers(true);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Failed to update user.", "error");
      }
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-6 right-6 z-[200] flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg border text-sm font-semibold animate-fade-in
          ${toast.type === "success"
            ? "bg-emerald-950/90 border-emerald-500/30 text-emerald-300"
            : "bg-rose-950/90 border-rose-500/30 text-rose-300"
          }`}>
          {toast.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </div>
      )}

      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">👥 Platform Users</h3>
            <p className="text-[10px] text-[var(--muted)] mt-0.5">{users.length} registered users</p>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users..."
              className="pl-8 pr-3 py-1.5 w-48 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface2)]/50">
                {["User", "Email", "Role", "Status", "Joined Date", "Actions"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading && users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-xs text-[var(--muted)]">
                    No users found matching your search.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-[var(--surface2)]/60 transition-colors">
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
                    <td className="px-5 py-3 flex gap-2 items-center">
                      <button
                        onClick={() => { setEditUser(u); setEditSubStatus(u.subscription?.includes("PRO") || false); }}
                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Edit
                      </button>
                      {u.status === "Suspended" ? (
                        <button
                          disabled={actionLoading === u.id}
                          onClick={() => handleStatusChange(u.id, "active", u.name)}
                          className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 disabled:opacity-50"
                        >
                          {actionLoading === u.id && <RefreshCw className="w-3 h-3 animate-spin" />}
                          Restore
                        </button>
                      ) : (
                        <button
                          disabled={actionLoading === u.id}
                          onClick={() => handleStatusChange(u.id, "suspended", u.name)}
                          className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1 disabled:opacity-50"
                        >
                          {actionLoading === u.id && <RefreshCw className="w-3 h-3 animate-spin" />}
                          Suspend
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* EDIT USER MODAL */}
      {editUser && (
        <div className="app-modal-backdrop bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="app-modal-panel min-h-0 bg-[var(--surface)] border border-[var(--border)] rounded-xl max-w-md overflow-hidden shadow-2xl flex flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface2)] px-4 py-3 sm:px-6 sm:py-4">
              <h3 className="font-bold text-[var(--ink)]">Edit User</h3>
              <button onClick={() => setEditUser(null)} className="text-[var(--muted)] hover:text-[var(--ink)] transition-colors text-lg">✕</button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Name</label>
                <div className="text-sm font-bold text-[var(--ink)] bg-[var(--surface2)] px-3 py-2 rounded-lg border border-[var(--border)]">{editUser.name}</div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Email</label>
                <div className="break-all text-sm text-[var(--muted)] bg-[var(--surface2)] px-3 py-2 rounded-lg border border-[var(--border)]">{editUser.email}</div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Role</label>
                <div className="text-sm font-bold text-[var(--ink)] bg-[var(--surface2)] px-3 py-2 rounded-lg border border-[var(--border)]">{editUser.role}</div>
              </div>
              {editUser.role.toLowerCase() === "teacher" && (
                <div className="pt-4 border-t border-[var(--border)]">
                  <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Subscription Status</label>
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-[var(--ink)]">AI Pro Subscription</h4>
                      <p className="text-xs text-[var(--muted)] mt-0.5">Manually grant or revoke Pro access</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={editSubStatus} onChange={(e) => setEditSubStatus(e.target.checked)} />
                      <div className="w-11 h-6 bg-[var(--border)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface2)] p-4 sm:flex-row sm:justify-end sm:gap-3">
              <button onClick={() => setEditUser(null)} className="w-full px-4 py-2 rounded-lg font-semibold text-sm border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface)] transition-all sm:w-auto">Cancel</button>
              <button
                disabled={isSaving}
                onClick={async () => {
                  const wasSubscribed = editUser.subscription?.includes("PRO") || false;
                  if (editSubStatus === wasSubscribed) {
                    setEditUser(null);
                    return;
                  }
                  setIsSaving(true);
                  try {
                    const res = await fetch(`/api/dashboard/admin/users/${editUser.id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ subscriptionStatus: editSubStatus ? "active" : "expired" })
                    });
                    if (res.ok) {
                      setEditUser(null);
                      showToast("User subscription updated successfully.", "success");
                      fetchUsers(true);
                    } else {
                      const data = await res.json().catch(() => ({}));
                      showToast("Failed to update: " + (data.error || "Unknown error"), "error");
                    }
                  } catch {
                    showToast("Network error.", "error");
                  } finally {
                    setIsSaving(false);
                  }
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-bold text-white transition-all hover:bg-blue-700 disabled:opacity-50 sm:w-auto"
              >
                {isSaving && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
