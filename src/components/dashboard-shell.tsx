"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import BrandImage from "./brand-image";
import { visibleStudentNotifications } from "@/lib/notification-presentation";
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
  UserRound,
  ArrowUpRight,
  Swords,
} from "lucide-react";
import { clsx } from "clsx";
import PusherClient from "pusher-js";
import { AdminSessionLifecycleContext, createAdminSessionLifecycle, type AdminSessionLoss } from "./admin-session-lifecycle";
import { UserSessionLifecycleContext, createUserSessionLifecycle, getUserSessionLoss, UserSessionReauthentication, type UserSessionLoss } from "./user-session-lifecycle";

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
  userInitials: string;
  identityColor?: string;
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
        { label: "Playground Arena", icon: <Swords className="w-4 h-4" />, href: "/dashboard/teacher/playground", badge: "PRO" },
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
  userInitials,
  identityColor = "from-blue-600 to-slate-800",
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const themePreference = useRef<"light" | "dark" | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const [sessionLifecycle] = useState(createAdminSessionLifecycle);
  const adminSession = role === "admin" ? sessionLifecycle : null;
  const [userLifecycle] = useState(createUserSessionLifecycle);
  const userSession = role === "admin" ? null : userLifecycle;
  const scopeSession = adminSession ?? userSession;
  const [userSessionLost, setUserSessionLost] = useState<UserSessionLoss | null>(null);
  const [adminSessionLost, setAdminSessionLost] = useState<AdminSessionLoss | null>(null);
  const notificationLifecycle = useRef({ active: false, generation: 0 });
  const notificationRequests = useRef(new Set<AbortController>());
  const notificationRefresh = useRef(0);
  const stopNotifications = useRef<(() => void) | null>(null);
  const consumerScope = role === "admin" ? "scope=admin" : `scope=user&role=${role}`;

  const reportNotificationLoss = (status: AdminSessionLoss) => {
    scopeSession?.reportLoss(status);
  };

  const notificationResponseLoss = async (res: Response, generation: number) => {
    const loss = adminSession ? (res.status === 401 || res.status === 403 ? res.status : null) : await getUserSessionLoss(res);
    if (!isNotificationActive(generation)) return true;
    if (loss) { reportNotificationLoss(loss); return true; }
    return false;
  };

  const isNotificationActive = (generation: number) =>
    notificationLifecycle.current.active && notificationLifecycle.current.generation === generation && !scopeSession?.getLoss();

  const beginNotificationRequest = () => {
    const generation = notificationLifecycle.current.generation;
    if (!isNotificationActive(generation)) return null;
    const controller = new AbortController();
    notificationRequests.current.add(controller);
    return { controller, generation };
  };

  const loadNotifications = async () => {
    const request = beginNotificationRequest();
    if (!request) return;
    const refresh = ++notificationRefresh.current;
    try {
      const res = await fetch(`/api/notifications?${consumerScope}`, { signal: request.controller.signal, cache: "no-store" });
      if (!isNotificationActive(request.generation) || request.controller.signal.aborted) return;
      if (await notificationResponseLoss(res, request.generation)) return;
      if (res.ok) {
        const data = await res.json();
        if (isNotificationActive(request.generation) && !request.controller.signal.aborted && refresh === notificationRefresh.current && data.success) {
          const visible = visibleStudentNotifications<Notification>(data.notifications || []);
          setNotifications(visible);
          setUnreadCount(visible.filter((notification) => !notification.isRead).length);
        }
      }
    } catch (e) {
      if (isNotificationActive(request.generation) && !request.controller.signal.aborted) console.error("Failed to load notifications:", e);
    } finally {
      notificationRequests.current.delete(request.controller);
    }
  };

  // Load notifications and maintain one role-aware realtime connection.
  useEffect(() => {
    const lifecycle = notificationLifecycle.current;
    const requests = notificationRequests.current;
    const generation = ++lifecycle.generation;
    lifecycle.active = true;
    setNotifications([]);
    setUnreadCount(0);
    setNotifOpen(false);
    const isActive = () => lifecycle.active && lifecycle.generation === generation && !scopeSession?.getLoss();
    let pusher: PusherClient | null = null;
    const channels: Array<{ name: string; channel: ReturnType<PusherClient["subscribe"]> }> = [];
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      lifecycle.active = false;
      lifecycle.generation++;
      if (pollInterval !== null) clearInterval(pollInterval);
      for (const controller of requests) controller.abort();
      requests.clear();
      try {
        for (const { name, channel } of channels) {
          channel.unbind_all();
          pusher?.unsubscribe(name);
        }
      } finally {
        pusher?.disconnect();
      }
    };
    stopNotifications.current = stop;

    const loseAuthorization = (status: AdminSessionLoss) => {
      stop();
      setNotifications([]);
      setUnreadCount(0);
      setNotifOpen(false);
      setProfileOpen(false);
      if (adminSession) setAdminSessionLost(status);
      else setUserSessionLost(status);
    };
    const unsubscribeSession = scopeSession?.subscribe(loseAuthorization);
    const knownLoss = scopeSession?.getLoss();
    if (knownLoss) loseAuthorization(knownLoss);
    else {
      setAdminSessionLost(null);
      setUserSessionLost(null);
      void loadNotifications();
      pollInterval = setInterval(() => { if (isActive()) void loadNotifications(); }, 15_000);
    }

    const connectRealtime = async () => {
      const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
      const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
      if (!key || !cluster || !isActive()) return;

      const request = beginNotificationRequest();
      if (!request) return;
      try {
        const response = await fetch(`/api/auth/session?${consumerScope}`, { signal: request.controller.signal, cache: "no-store" });
        if (!isActive() || request.controller.signal.aborted) return;
        if (await notificationResponseLoss(response, request.generation)) return;
        if (!response.ok) return;

        const session = await response.json() as {
          user?: { userId?: string | number; role?: string } | null;
        };
        const userId = session.user?.userId;
        if (!isActive() || request.controller.signal.aborted) return;
        if (session.user?.role !== role) { reportNotificationLoss(403); return; }
        if (!userId) return;

        pusher = new PusherClient(key, {
          cluster,
          authEndpoint: `/api/pusher/auth?${consumerScope}`,
        });

        const userChannel = pusher.subscribe(`private-user-${userId}`);
        channels.push({ name: `private-user-${userId}`, channel: userChannel });
        userChannel.bind("notification", () => { if (isActive()) void loadNotifications(); });
        userChannel.bind("pusher:subscription_error", (error: unknown) => {
          if (isActive() && userSession && (error as {status?: number})?.status === 401) { userSession.reportLoss(401); return; }
          if (isActive()) console.warn("Notification channel subscription failed:", error);
        });

        if (role === "admin") {
          const adminChannel = pusher.subscribe("private-admin-dashboard");
          channels.push({ name: "private-admin-dashboard", channel: adminChannel });
          adminChannel.bind("activity", () => { if (isActive()) void loadNotifications(); });
          adminChannel.bind("pusher:subscription_error", (error: unknown) => {
            if (isActive()) console.warn("Admin activity channel subscription failed:", error);
          });
        }
      } catch (error) {
        if (isActive() && !request.controller.signal.aborted) console.error("Failed to initialize realtime notifications:", error);
      } finally {
        requests.delete(request.controller);
      }
    };

    void connectRealtime();

    return () => {
      unsubscribeSession?.();
      stop();
      if (stopNotifications.current === stop) stopNotifications.current = null;
    };
  }, [role, scopeSession]);

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
    const generation = notificationLifecycle.current.generation;
    if (!isNotificationActive(generation)) return;
    const nextState = !notifOpen;
    setNotifOpen(nextState);
    if (nextState) {
      setProfileOpen(false);
      // Re-fetch latest notifications from DB when opening dropdown
      await loadNotifications();
      if (!isNotificationActive(generation)) return;
      // Mark as read in DB
      const request = beginNotificationRequest();
      if (!request) return;
      try {
        const response = await fetch(`/api/notifications?${consumerScope}`, {
          method: "PUT",
          signal: request.controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "all" }),
        });
        if (!isNotificationActive(request.generation) || request.controller.signal.aborted) return;
        if (await notificationResponseLoss(response, request.generation)) return;
        if (!response.ok) {
          throw new Error(`Failed to mark notifications read (${response.status})`);
        }
        notificationRefresh.current++;
        setNotifications((current) => isNotificationActive(request.generation) ? current.map((notification) => ({
          ...notification,
          isRead: true,
        })) : current);
        setUnreadCount(0);
      } catch (e) {
        if (isNotificationActive(request.generation) && !request.controller.signal.aborted) console.error("Failed to mark notifications read:", e);
      } finally {
        notificationRequests.current.delete(request.controller);
      }
    }
  };
  const nav = navConfig[role] || navConfig.student;
  const portal = portalConfig[role];

  const applyTheme = (nextTheme: "light" | "dark") => {
    setTheme(nextTheme);
    if (nextTheme === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  };

  useEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    try {
      const savedTheme = localStorage.getItem("theme");
      themePreference.current = savedTheme === "light" || savedTheme === "dark" ? savedTheme : null;
    } catch {
      themePreference.current = null;
    }
    const updateTheme = () => applyTheme(themePreference.current ?? (systemTheme.matches ? "dark" : "light"));
    updateTheme();
    systemTheme.addEventListener?.("change", updateTheme);
    return () => systemTheme.removeEventListener?.("change", updateTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    themePreference.current = nextTheme;
    applyTheme(nextTheme);
    // A blocked storage write must not prevent the selected appearance.
    try { localStorage.setItem("theme", nextTheme); } catch {}
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
    if (!isNotificationActive(notificationLifecycle.current.generation)) return;
    setNotifOpen(false);
    router.push(notification.actionUrl);
  };

  return (
    <AdminSessionLifecycleContext.Provider value={adminSession}>
    <UserSessionLifecycleContext.Provider value={userSession}>
    <div data-portal={role} className={role === "student" ? "dashboard-ambient app-gradient-shell flex h-screen ps-student-glass-shell" : role === "teacher" ? "dashboard-ambient app-gradient-shell flex h-screen ps-teacher-glass-shell" : role === "admin" ? "dashboard-ambient app-gradient-shell flex h-screen ps-admin-glass-shell" : "dashboard-ambient app-gradient-shell flex h-screen"}>
      {/* ── SIDEBAR ─────────────────────────────── */}
      <aside
        className={clsx(
          "dashboard-sidebar fixed inset-y-0 left-0 z-40 w-60 border-r border-[var(--border)] flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          role === "student" ? "ps-glass-chrome" : role === "teacher" ? "ps-teacher-glass-chrome" : role === "admin" && "ps-admin-glass-chrome"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-[var(--border)]">
          <BrandImage width={34} decorative />
          <div>
            <div className="text-sm font-bold text-[var(--ink)] tracking-tight font-[family-name:var(--font-display)]">ProctorShieldAI</div>
            <div className="text-[10px] text-[var(--muted)] font-semibold tracking-wider uppercase">
              {portal.sub}
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {nav.map((group) => (
            <div key={group.section} className="mb-5">
              <div className="px-3 mb-2 text-[10px] font-bold tracking-widest uppercase text-[var(--muted)]">
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
                        ? "dashboard-nav-active font-semibold"
                        : ""
                    )}
                  >
                    {item.icon}
                    <span className="flex-1">{item.label}</span>
                    {item.badge && (
                      <span
                        className={clsx(
                          "text-[10px] font-extrabold px-1.5 py-0.5 rounded-md shadow-xs",
                          item.badge === "PRO"
                            ? "dashboard-nav-badge shadow-md"
                            : "bg-[var(--surface2)] text-[var(--ink2)]"
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
            className="dashboard-nav-item dashboard-sign-out flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all w-full mt-2"
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </button>
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-[var(--border)] bg-[var(--surface2)]">
          <div className="flex items-center gap-3">
            <div className={`dashboard-identity w-9 h-9 rounded-full bg-gradient-to-br ${identityColor} flex items-center justify-center text-xs font-bold text-white shadow-sm shrink-0`}>
              {userSessionLost ? "—" : userInitials}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)] truncate">{userSessionLost ? "Session ended" : userName}</div>
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
        <header className={clsx("dashboard-topbar relative z-30 h-16 border-b border-[var(--border)] flex items-center justify-between px-4 sm:px-6 shrink-0", role === "student" ? "ps-glass-chrome" : role === "teacher" ? "ps-teacher-glass-chrome" : role === "admin" && "ps-admin-glass-chrome")}>
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
                {userSessionLost ? "Sign in again to continue" : <>Welcome, <span className="font-semibold text-[var(--ink2)]">{userName}</span></>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Notification Bell */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={openNotifications}
                disabled={adminSessionLost !== null || userSessionLost !== null}
                aria-label="Open notifications"
                aria-expanded={notifOpen}
                className="dashboard-icon-button relative p-2 rounded-xl bg-[var(--surface2)] text-[var(--muted)] hover:text-[var(--dashboard-accent)] transition-colors border border-[var(--border)]"
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
                            <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted2)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--dashboard-accent)]" aria-hidden="true" />
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
              className="dashboard-icon-button p-2 rounded-xl bg-[var(--surface2)] text-[var(--muted)] hover:text-[var(--dashboard-accent)] transition-colors border border-[var(--border)]"
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
                disabled={userSessionLost !== null}
                aria-expanded={profileOpen}
                className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 pr-2.5 text-left shadow-sm hover:border-blue-400/50"
              >
                <span className={`dashboard-identity w-7 h-7 rounded-lg bg-gradient-to-br ${identityColor} flex items-center justify-center text-[10px] font-bold text-white`}>
                  {userSessionLost ? "—" : userInitials}
                </span>
                <span className="hidden xl:block max-w-28 truncate text-xs font-semibold text-[var(--ink)]">{userSessionLost ? "Session ended" : userName}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-[var(--muted)] transition-transform ${profileOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
              {profileOpen && (
                <div className="dashboard-dropdown absolute right-0 top-full mt-2 w-56 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-2xl animate-dropdown">
                  <div className="px-3 py-2.5 border-b border-[var(--border)] mb-1">
                    <p className="text-xs font-bold text-[var(--ink)] truncate">{userName}</p>
                    <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--dashboard-accent)]">{role} account</p>
                  </div>
                  <Link
                    href={`/dashboard/${role}/settings`}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-[var(--ink2)] hover:bg-blue-500/10 hover:text-[var(--dashboard-accent)]"
                  >
                    <UserRound className="w-4 h-4" aria-hidden="true" /> Profile &amp; Settings
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-[var(--dashboard-danger)] hover:bg-rose-500/10"
                  >
                    <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main key={pathname} className="dashboard-main app-page-enter flex-1 overflow-y-auto p-4 sm:p-6 scroll-smooth">{userSessionLost ? <UserSessionReauthentication status={userSessionLost} /> : children}</main>
      </div>
    </div>
    </UserSessionLifecycleContext.Provider>
    </AdminSessionLifecycleContext.Provider>
  );
}
