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
  plan?: string;
  subscription?: string;
  subClass?: string;
  joined: string;
}

function subscriptionLabel(user: UserItem) {
  if (user.plan === "Premium" || user.plan === "PRO (Active)" || user.subscription === "PRO (Active)") return "Premium";
  if (user.plan === "Free Tier" || user.subscription === "Free Plan") return "Free Tier";
  return "Unavailable";
}

export default function UsersContent() {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<UserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Read-only user details
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchUsers = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch("/api/dashboard/admin");
      if (!res.ok) throw new Error(`Users request failed: ${res.status}`);
      const data = await res.json();
      setUsers(data.users || []);
      setLoadError(null);
    } catch (err) {
      console.error("Failed to load users:", err);
      setLoadError("Could not load Admin Users. Existing data may be out of date.");
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
      if (["register", "login", "logout", "user_update"].includes(data.type)) {
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
    <div className="ps-admin-glass-canvas">
      {/* Toast Notification */}
      {toast && (
        <div role="status" className={`ps-admin-toast fixed top-6 right-6 z-[200] flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg border text-sm font-semibold animate-fade-in
          ${toast.type === "success"
            ? "bg-emerald-950/90 border-emerald-500/30 text-emerald-300"
            : "bg-rose-950/90 border-rose-500/30 text-rose-300"
          }`}>
          {toast.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </div>
      )}

      <div className="ps-admin-glass-card bg-[var(--surface)] rounded-xl border border-[var(--border)]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">👥 Platform Users</h3>
            <p className="ps-admin-glass-caption text-[10px] text-[var(--muted)] mt-0.5">{users.length} registered users</p>
          </div>
          <div className="ps-admin-search relative w-full sm:w-auto">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search users"
              placeholder="Search users..."
              className="pl-8 pr-3 py-1.5 w-full sm:w-64 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        {loadError && (
          <div role="alert" className="flex items-center justify-between gap-3 border-b border-rose-500/30 bg-rose-500/10 px-5 py-3 text-xs text-rose-600 dark:text-rose-400">
            <span>{loadError}</span>
            <button type="button" disabled={isLoading} onClick={() => fetchUsers()} className="font-semibold underline disabled:opacity-50">
              {isLoading ? "Retrying..." : "Retry"}
            </button>
          </div>
        )}
        <div className="ps-table-scroll ps-admin-table-scroll ps-admin-glass-dense overflow-x-auto" role="region" aria-label="Admin user management" tabIndex={0}>
          <table className="ps-dashboard-table w-full">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface2)]/50">
                {["User", "Email", "Role", "Subscription", "Status", "Joined Date", "Actions"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading && users.length === 0 && !loadError ? (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  </td>
                </tr>
              ) : loadError && users.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-xs text-[var(--muted)]">User data is unavailable. Use Retry above.</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-xs text-[var(--muted)]">
                    No users found matching your search.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-[var(--surface2)]/60 transition-colors">
                    <td className="ps-table-text px-5 py-3 text-sm font-semibold text-[var(--ink)]">{u.name}</td>
                    <td className="ps-table-text px-5 py-3 text-sm text-[var(--muted)]">{u.email}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${u.roleClass}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {u.role.toLowerCase() === "teacher" ? (
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${subscriptionLabel(u) === "Premium" ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" : "bg-slate-500/10 text-[var(--muted)] border border-[var(--border)]"}`}>
                          {subscriptionLabel(u)}
                        </span>
                      ) : <span className="text-xs text-[var(--muted)]">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${u.statusClass}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-sm text-[var(--muted)]">{u.joined}</td>
                    <td className="px-5 py-3">
                      <div className="flex gap-3 items-center">
                      <button
                        onClick={() => setSelectedUser(u)}
                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        View
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
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* USER DETAILS MODAL */}
      {selectedUser && (
        <div className="app-modal-backdrop bg-black/60 backdrop-blur-sm animate-fade-in">
          <div role="dialog" aria-modal="true" aria-labelledby="admin-user-heading" className="ps-admin-glass-card ps-admin-glass-dialog app-modal-panel min-h-0 bg-[var(--surface)] border border-[var(--border)] rounded-xl max-w-md overflow-hidden shadow-2xl flex flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface2)] px-4 py-3 sm:px-6 sm:py-4">
              <h3 id="admin-user-heading" className="font-bold text-[var(--ink)]">User Details</h3>
              <button aria-label="Close user details" onClick={() => setSelectedUser(null)} className="text-[var(--muted)] hover:text-[var(--ink)] transition-colors text-lg">✕</button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Name</label>
                <div className="text-sm font-bold text-[var(--ink)] bg-[var(--surface2)] px-3 py-2 rounded-lg border border-[var(--border)]">{selectedUser.name}</div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Email</label>
                <div className="break-all text-sm text-[var(--muted)] bg-[var(--surface2)] px-3 py-2 rounded-lg border border-[var(--border)]">{selectedUser.email}</div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Role</label>
                <div className="text-sm font-bold text-[var(--ink)] bg-[var(--surface2)] px-3 py-2 rounded-lg border border-[var(--border)]">{selectedUser.role}</div>
              </div>
              {selectedUser.role.toLowerCase() === "teacher" && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Subscription Status</p>
                  <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full ${subscriptionLabel(selectedUser) === "Premium" ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" : "bg-slate-500/10 text-[var(--muted)] border border-[var(--border)]"}`}>
                    {subscriptionLabel(selectedUser)}
                  </span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface2)] p-4 sm:flex-row sm:justify-end sm:gap-3">
              <button onClick={() => setSelectedUser(null)} className="w-full px-4 py-2 rounded-lg font-semibold text-sm border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface)] transition-all sm:w-auto">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
