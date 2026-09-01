"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  FileText,
  Radio,
  Camera,
  Brain,
  Settings,
  LogOut,
  Menu,
  X,
  ClipboardList,
  TrendingUp,
  FileBarChart,
  Sun,
  Moon,
  CreditCard,
  Bell,
} from "lucide-react";
import { clsx } from "clsx";
import PusherClient from "pusher-js";

interface Notification {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface NavItem {
  label: string;
  icon: React.ReactNode;
  href: string;
  badge?: string;
}

interface DashboardShellProps {
  children: React.ReactNode;
  role: "student" | "teacher" | "admin";
  userName: string;
  userAvatar: string;
  avatarColor?: string;
}

const navConfig: Record<string, { section: string; items: NavItem[] }[]> = {
  student: [
    {
      section: "Main",
      items: [
        { label: "Dashboard", icon: <BarChart3 className="w-4 h-4" />, href: "/dashboard/student" },
        { label: "My Quizzes", icon: <FileText className="w-4 h-4" />, href: "/dashboard/student/quizzes" },
        { label: "Results", icon: <TrendingUp className="w-4 h-4" />, href: "/dashboard/student/results" },
        { label: "AI Reports", icon: <FileBarChart className="w-4 h-4" />, href: "/dashboard/student/reports" },
      ],
    },
    {
      section: "Account",
      items: [
        { label: "Settings", icon: <Settings className="w-4 h-4" />, href: "/dashboard/student/settings" },
      ],
    },
  ],
  teacher: [
    {
      section: "Main",
      items: [
        { label: "Dashboard", icon: <BarChart3 className="w-4 h-4" />, href: "/dashboard/teacher" },
        { label: "My Quizzes", icon: <ClipboardList className="w-4 h-4" />, href: "/dashboard/teacher/quizzes" },
        { label: "Live Monitor", icon: <Radio className="w-4 h-4" />, href: "/dashboard/teacher/monitor" },
        { label: "Evidence Replay", icon: <Camera className="w-4 h-4" />, href: "/dashboard/teacher/evidence" },
        { label: "AI Reports", icon: <Brain className="w-4 h-4" />, href: "/dashboard/teacher/reports" },
      ],
    },
    {
      section: "Account",
      items: [
        { label: "Billing & Plan", icon: <CreditCard className="w-4 h-4" />, href: "/dashboard/teacher/billing" },
        { label: "Settings", icon: <Settings className="w-4 h-4" />, href: "/dashboard/teacher/settings" },
      ],
    },
  ],
  admin: [
    {
      section: "Overview",
      items: [
        { label: "Dashboard", icon: <BarChart3 className="w-4 h-4" />, href: "/dashboard/admin" },
        { label: "Users", icon: <FileText className="w-4 h-4" />, href: "/dashboard/admin/users" },
        { label: "All Quizzes", icon: <ClipboardList className="w-4 h-4" />, href: "/dashboard/admin/quizzes" },
      ],
    },
    {
      section: "System",
      items: [
        { label: "AI Logs", icon: <Brain className="w-4 h-4" />, href: "/dashboard/admin/logs" },
        { label: "Analytics", icon: <TrendingUp className="w-4 h-4" />, href: "/dashboard/admin/analytics" },
        { label: "Settings", icon: <Settings className="w-4 h-4" />, href: "/dashboard/admin/settings" },
      ],
    },
  ],
};

const portalConfig = {
  student: { title: "Proctor Shield", sub: "Student Portal", logoColor: "from-blue-600 to-indigo-700" },
  teacher: { title: "Proctor Shield", sub: "Teacher Portal", logoColor: "from-blue-600 to-indigo-700" },
  admin: { title: "Proctor Shield", sub: "Admin Panel", logoColor: "from-slate-800 to-rose-700" },
};

export default function DashboardShell({
  children,
  role,
  userName,
  userAvatar,
  avatarColor = "from-blue-600 to-slate-800",
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState("light");
  const pathname = usePathname();
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);

  const loadNotifications = async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setNotifications(data.notifications || []);
          setUnreadCount(data.unreadCount || 0);
        }
      }
    } catch (e) {
      console.error("Failed to load notifications:", e);
    }
  };

  // Fetch notifications on mount + setup Pusher listener & 3.5s polling
  useEffect(() => {
    let isMounted = true;
    const fetchNotifs = async () => {
      try {
        const res = await fetch("/api/notifications");
        if (res.ok && isMounted) {
          const data = await res.json();
          if (data.success) {
            setNotifications(data.notifications || []);
            setUnreadCount(data.unreadCount || 0);
          }
        }
      } catch (e) {
        console.error("Failed to load notifications:", e);
      }
    };

    fetchNotifs();

    const pollInterval = setInterval(() => {
      fetchNotifs();
    }, 3500);

    let pusher: any;
    try {
      import("pusher-js").then((PusherClient) => {
        const key = process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774";
        const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1";
        pusher = new PusherClient.default(key, { cluster, authEndpoint: "/api/pusher/auth" });
        const channel = pusher.subscribe("private-admin-dashboard");
        channel.bind("activity", () => {
          fetchNotifs();
        });
      });
    } catch {}

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      if (pusher) pusher.disconnect();
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const openNotifications = async () => {
    const nextState = !notifOpen;
    setNotifOpen(nextState);
    if (nextState) {
      // Re-fetch latest notifications from DB when opening dropdown
      await loadNotifications();
      // Mark as read in DB
      try {
        await fetch("/api/notifications", { method: "PUT" });
        setUnreadCount(0);
      } catch (e) {
        console.error("Failed to mark notifications read:", e);
      }
    }
  };
  const nav = navConfig[role] || navConfig.student;
  const portal = portalConfig[role];

  // Initialize Theme

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") || 
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: role }),
    });
    window.location.href = "/login";
  };

  // Fetch Notifications & Listen to Pusher
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const res = await fetch("/api/notifications");
        if (res.ok) {
          const data = await res.json();
          setNotifications(data.notifications || []);
        }
      } catch (e) {
        console.error("Failed to fetch notifications", e);
      }
    };
    
    fetchNotifications();

    const getUserId = async () => {
      try {
        const res = await fetch("/api/auth/session");
        const session = await res.json();
        if (session && session.userId) {
          const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774";
          const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1";
          const pusher = new PusherClient(pusherKey, { cluster: pusherCluster, authEndpoint: "/api/pusher/auth" });
          const channel = pusher.subscribe(`private-user-${session.userId}`);
          
          channel.bind("notification", (data: any) => {
            const newNotif: Notification = {
              id: data.id || Math.random().toString(),
              title: data.title,
              message: data.message,
              createdAt: data.createdAt,
              isRead: false,
            };
            setNotifications(prev => [newNotif, ...prev]);
          });
        }
      } catch (e) {
        console.error("Session fetch failed", e);
      }
    };

    getUserId();
  }, []);

  const markAsRead = async (id: string) => {
    setNotifications(prev => 
      id === "all" 
        ? prev.map(n => ({ ...n, isRead: true })) 
        : prev.map(n => n.id === id ? { ...n, isRead: true } : n)
    );
    try {
      await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch (e) {
      console.error("Failed to mark as read", e);
    }
  };

  return (
    <div className="flex h-screen bg-[var(--background)]">
      {/* ── SIDEBAR ─────────────────────────────── */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 w-60 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-[var(--border)]">
          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${portal.logoColor} flex items-center justify-center text-sm text-white shadow-sm`}>
            {role === "admin" ? "🔒" : "🛡️"}
          </div>
          <div>
            <div className="text-sm font-bold text-[var(--ink)] tracking-tight font-[family-name:var(--font-display)]">{portal.title}</div>
            <div className="text-[10px] text-[var(--muted)] font-semibold tracking-wider uppercase">
              {portal.sub}
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {nav.map((group) => (
            <div key={group.section} className="mb-5">
              <div className="px-3 mb-2 text-[10px] font-bold tracking-widest uppercase text-[var(--muted)] opacity-80">
                {group.section}
              </div>
              {group.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all mb-1",
                      isActive
                        ? "bg-blue-600/10 text-blue-600 dark:text-blue-400 font-semibold border-l-2 border-blue-600 rounded-r-lg rounded-l-none pl-2.5"
                        : "text-[var(--muted)] hover:bg-[var(--surface2)] hover:text-[var(--ink)]"
                    )}
                  >
                    {item.icon}
                    <span className="flex-1">{item.label}</span>
                    {item.badge && (
                      <span className="px-2 py-0.5 rounded-full bg-blue-600/15 text-blue-600 dark:text-blue-400 text-[10px] font-bold">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--muted)] hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 transition-all w-full mt-2"
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </button>
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${avatarColor} flex items-center justify-center text-xs font-bold text-white shadow-sm shrink-0`}>
              {userAvatar}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)] truncate">{userName}</div>
              <div className="text-xs text-[var(--muted)] capitalize">{role}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── MAIN CONTENT ───────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-16 bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-[var(--surface2)] text-[var(--muted)]"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div>
              <div className="text-sm font-bold text-[var(--ink)] capitalize">
                {role === "admin" ? "System Administration" : `${role} Dashboard`}
              </div>
              <div className="text-xs text-[var(--muted)]">
                Welcome, <span className="font-semibold text-[var(--ink2)]">{userName}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Notification Bell */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={openNotifications}
                className="relative p-2 rounded-lg bg-[var(--surface2)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors border border-[var(--border)]"
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-600 text-white text-[9px] font-extrabold rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
              {/* Dropdown */}
              {notifOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in">
                  <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
                    <h4 className="text-xs font-bold text-[var(--ink)] uppercase tracking-wide">Notifications</h4>
                    {notifications.length > 0 && (
                      <span className="text-[10px] text-[var(--muted)]">All caught up</span>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="py-8 text-center text-xs text-[var(--muted)]">
                        <Bell className="w-5 h-5 mx-auto mb-2 opacity-30" />
                        No notifications yet.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className={`px-4 py-3 border-b border-[var(--border)] last:border-0 transition-colors ${
                            n.isRead ? "" : "bg-blue-500/5"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {!n.isRead && <span className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-semibold ${n.isRead ? "text-[var(--muted)]" : "text-[var(--ink)]"}`}>{n.title}</p>
                              <p className="text-[11px] text-[var(--muted)] mt-0.5 leading-relaxed">{n.message}</p>
                              <p className="text-[10px] text-[var(--muted2)] mt-1">
                                {new Date(n.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg bg-[var(--surface2)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors border border-[var(--border)]"
              title="Toggle Theme"
            >
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
            {role === "teacher" && (
              <Link
                href="/dashboard/teacher/quizzes?new=true"
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-all shadow-xs"
              >
                + New Quiz
              </Link>
            )}
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
