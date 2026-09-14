"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  ChevronDown,
  ShieldCheck,
  UserRound,
  ArrowUpRight,
  Swords,
} from "lucide-react";
import { clsx } from "clsx";
import PusherClient from "pusher-js";

interface Notification {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  actionUrl: string;
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
        { label: "Playground Arena", icon: <Swords className="w-4 h-4 text-amber-400" />, href: "/dashboard/teacher/playground", badge: "PRO" },
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
  admin: { title: "Proctor Shield", sub: "Admin Panel", logoColor: "from-blue-600 to-cyan-500" },
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
  const router = useRouter();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

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

  // Load notifications and maintain one role-aware realtime connection.
  useEffect(() => {
    let isMounted = true;
    let pusher: PusherClient | null = null;

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

    void fetchNotifs();

    const pollInterval = setInterval(() => {
      void fetchNotifs();
    }, 15_000);

    const connectRealtime = async () => {
      const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
      const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
      if (!key || !cluster) return;

      try {
        const response = await fetch("/api/auth/session");
        if (!response.ok || !isMounted) return;

        const session = await response.json() as {
          user?: { userId?: number } | null;
        };
        const userId = session.user?.userId;
        if (!userId || !isMounted) return;

        pusher = new PusherClient(key, {
          cluster,
          authEndpoint: "/api/pusher/auth",
        });

        const userChannel = pusher.subscribe(`private-user-${userId}`);
        userChannel.bind("notification", () => void fetchNotifs());
        userChannel.bind("pusher:subscription_error", (error: unknown) => {
          console.warn("Notification channel subscription failed:", error);
        });

        if (role === "admin") {
          const adminChannel = pusher.subscribe("private-admin-dashboard");
          adminChannel.bind("activity", () => void fetchNotifs());
          adminChannel.bind("pusher:subscription_error", (error: unknown) => {
            console.warn("Admin activity channel subscription failed:", error);
          });
        }
      } catch (error) {
        console.error("Failed to initialize realtime notifications:", error);
      }
    };

    void connectRealtime();

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      pusher?.disconnect();
    };
  }, [role]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const openNotifications = async () => {
    const nextState = !notifOpen;
    setNotifOpen(nextState);
    if (nextState) {
      setProfileOpen(false);
      // Re-fetch latest notifications from DB when opening dropdown
      await loadNotifications();
      // Mark as read in DB
      try {
        const response = await fetch("/api/notifications", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "all" }),
        });
        if (!response.ok) {
          throw new Error(`Failed to mark notifications read (${response.status})`);
        }
        setNotifications((current) => current.map((notification) => ({
          ...notification,
          isRead: true,
        })));
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
    setTheme(savedTheme);
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

  const handleNotificationClick = (notification: Notification) => {
    setNotifOpen(false);
    router.push(notification.actionUrl);
  };

  return (
    <div className="dashboard-ambient app-gradient-shell flex h-screen">
      {/* ── SIDEBAR ─────────────────────────────── */}
      <aside
        className={clsx(
          "dashboard-sidebar fixed inset-y-0 left-0 z-40 w-60 border-r border-white/10 flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${portal.logoColor} flex items-center justify-center text-sm text-white shadow-sm`}>
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm font-bold text-white tracking-tight font-[family-name:var(--font-display)]">{portal.title}</div>
            <div className="text-[10px] text-blue-200/55 font-semibold tracking-wider uppercase">
              {portal.sub}
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {nav.map((group) => (
            <div key={group.section} className="mb-5">
              <div className="px-3 mb-2 text-[10px] font-bold tracking-widest uppercase text-blue-200/45">
                {group.section}
              </div>
              {group.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx(
                      "dashboard-nav-item group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all mb-1",
                      isActive
                        ? "dashboard-nav-active text-white font-semibold"
                        : "text-blue-100/60 hover:bg-white/[0.07] hover:text-white"
                    )}
                  >
                    {item.icon}
                    <span className="flex-1">{item.label}</span>
                    {item.badge && (
                      <span
                        className={clsx(
                          "px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider uppercase",
                          item.badge === "PRO"
                            ? "bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 shadow-xs shadow-amber-500/40"
                            : "bg-blue-600/15 text-blue-600 dark:text-blue-400 font-bold"
                        )}
                      >
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
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-blue-100/60 hover:bg-rose-500/10 hover:text-rose-300 transition-all w-full mt-2"
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </button>
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-white/10 bg-black/10">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${avatarColor} flex items-center justify-center text-xs font-bold text-white shadow-sm shrink-0`}>
              {userAvatar}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{userName}</div>
              <div className="text-xs text-blue-200/50 capitalize">{role}</div>
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
        <header className="dashboard-topbar relative z-30 h-16 border-b border-[var(--border)] flex items-center justify-between px-4 sm:px-6 shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label={sidebarOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={sidebarOpen}
              className="lg:hidden p-2 rounded-lg hover:bg-[var(--surface2)] text-[var(--muted)]"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="hidden min-w-0 sm:block">
              <div className="truncate text-sm font-bold text-[var(--ink)] capitalize">
                {role === "admin" ? "System Administration" : `${role} Dashboard`}
              </div>
              <div className="truncate text-xs text-[var(--muted)]">
                Welcome, <span className="font-semibold text-[var(--ink2)]">{userName}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Notification Bell */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={openNotifications}
                aria-label="Open notifications"
                aria-expanded={notifOpen}
                className="dashboard-icon-button relative p-2 rounded-xl bg-[var(--surface2)] text-[var(--muted)] hover:text-blue-600 transition-colors border border-[var(--border)]"
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
                <div className="dashboard-dropdown fixed inset-x-4 top-[4.5rem] z-50 w-auto overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl animate-dropdown sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[min(22rem,calc(100vw-2rem))]">
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
                        <button
                          type="button"
                          key={n.id}
                          onClick={() => handleNotificationClick(n)}
                          aria-label={`${n.title}. Open related page`}
                          className={`px-4 py-3 border-b border-[var(--border)] last:border-0 transition-colors ${
                            n.isRead ? "" : "bg-blue-500/5"
                          } group w-full text-left hover:bg-blue-500/10 focus-visible:bg-blue-500/10`}
                        >
                          <div className="flex items-start gap-2">
                            {!n.isRead && <span className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className={`break-words text-xs font-semibold ${n.isRead ? "text-[var(--muted)]" : "text-[var(--ink)]"}`}>{n.title}</p>
                              <p className="mt-0.5 break-words text-[11px] leading-relaxed text-[var(--muted)]">{n.message}</p>
                              <p className="text-[10px] text-[var(--muted2)] mt-1">
                                {new Date(n.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                            <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted2)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-blue-500" aria-hidden="true" />
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
              className="dashboard-icon-button p-2 rounded-xl bg-[var(--surface2)] text-[var(--muted)] hover:text-blue-600 transition-colors border border-[var(--border)]"
              title="Toggle Theme"
            >
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
            <div className="relative" ref={profileRef}>
              <button
                type="button"
                onClick={() => {
                  setProfileOpen((current) => !current);
                  setNotifOpen(false);
                }}
                aria-label="Open profile menu"
                aria-expanded={profileOpen}
                className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 pr-2.5 text-left shadow-sm hover:border-blue-400/50"
              >
                <span className={`w-7 h-7 rounded-lg bg-gradient-to-br ${avatarColor} flex items-center justify-center text-[10px] font-bold text-white`}>
                  {userAvatar}
                </span>
                <span className="hidden xl:block max-w-28 truncate text-xs font-semibold text-[var(--ink)]">{userName}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-[var(--muted)] transition-transform ${profileOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
              {profileOpen && (
                <div className="dashboard-dropdown absolute right-0 top-full mt-2 w-56 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-2xl animate-dropdown">
                  <div className="px-3 py-2.5 border-b border-[var(--border)] mb-1">
                    <p className="text-xs font-bold text-[var(--ink)] truncate">{userName}</p>
                    <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-600">{role} account</p>
                  </div>
                  <Link
                    href={`/dashboard/${role}/settings`}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-[var(--ink2)] hover:bg-blue-500/10 hover:text-blue-600"
                  >
                    <UserRound className="w-4 h-4" aria-hidden="true" /> Profile &amp; Settings
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-500/10"
                  >
                    <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main key={pathname} className="dashboard-main app-page-enter flex-1 overflow-y-auto p-4 sm:p-6 scroll-smooth">{children}</main>
      </div>
    </div>
  );
}
