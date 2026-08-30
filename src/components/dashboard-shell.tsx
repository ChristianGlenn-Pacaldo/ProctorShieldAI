"use client";

import { useState, useEffect } from "react";
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
        { label: "Billing", icon: <CreditCard className="w-4 h-4" />, href: "/dashboard/teacher/billing" },
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
  student: { title: "Proctor Shield", sub: "Student Portal", logoColor: "from-indigo-600 to-violet-600" },
  teacher: { title: "Proctor Shield", sub: "Teacher Portal", logoColor: "from-indigo-600 to-violet-600" },
  admin: { title: "Proctor Shield", sub: "Admin Panel", logoColor: "from-red-500 to-rose-500" },
};

export default function DashboardShell({
  children,
  role,
  userName,
  userAvatar,
  avatarColor = "from-indigo-600 to-violet-600",
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState("light");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const pathname = usePathname();
  const nav = navConfig[role] || [];
  const portal = portalConfig[role];
  const unreadCount = notifications.filter(n => !n.isRead).length;

  // Initialize Theme

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") || 
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    if (savedTheme === "dark") {
      setTheme("dark");
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
    await fetch("/api/auth/logout", { method: "POST" });
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
          const pusher = new PusherClient(pusherKey, { cluster: pusherCluster });
          const channel = pusher.subscribe(`user-${session.userId}`);
          
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
          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${portal.logoColor} flex items-center justify-center text-sm`}>
            {role === "admin" ? "🔒" : "🛡️"}
          </div>
          <div>
            <div className="text-sm font-bold text-[var(--ink)]">{portal.title}</div>
            <div className="text-[10px] text-[var(--muted)] font-semibold tracking-wide uppercase">
              {portal.sub}
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {nav.map((group) => (
            <div key={group.section} className="mb-4">
              <div className="px-3 mb-2 text-[10px] font-bold tracking-widest uppercase text-[var(--muted2)]">
                {group.section}
              </div>
              {group.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all mb-0.5",
                      isActive
                        ? "bg-indigo-600/10 text-indigo-600 font-semibold"
                        : "text-[var(--muted)] hover:bg-[var(--surface2)] hover:text-[var(--ink)]"
                    )}
                  >
                    {item.icon}
                    <span className="flex-1">{item.label}</span>
                    {item.badge && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-600/15 text-indigo-600 text-[10px] font-bold">
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
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[var(--muted)] hover:bg-red-500/10 hover:text-red-500 transition-all w-full"
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </button>
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${avatarColor} flex items-center justify-center text-xs font-extrabold text-white`}>
              {userAvatar}
            </div>
            <div>
              <div className="text-sm font-semibold text-[var(--ink)]">{userName}</div>
              <div className="text-xs text-[var(--muted)] capitalize">{role}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
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
                Welcome, <span className="font-semibold">{userName}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2 rounded-lg bg-[var(--surface2)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors border border-[var(--border)] relative"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center animate-bounce">
                    {unreadCount}
                  </span>
                )}
              </button>
              
              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl z-50 overflow-hidden animate-fade-in">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                    <h3 className="text-sm font-bold text-[var(--ink)]">Notifications</h3>
                    {unreadCount > 0 && (
                      <button 
                        onClick={() => markAsRead("all")}
                        className="text-[10px] text-indigo-500 font-semibold hover:text-indigo-400"
                      >
                        Mark all as read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[var(--muted)]">
                        No notifications yet.
                      </div>
                    ) : (
                      notifications.map(n => (
                        <div 
                          key={n.id} 
                          onClick={() => !n.isRead && markAsRead(n.id)}
                          className={`p-4 border-b border-[var(--border)] transition-colors cursor-pointer ${n.isRead ? 'opacity-60' : 'bg-[var(--surface2)]'}`}
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-xs font-bold text-[var(--ink)]">{n.title}</span>
                            {!n.isRead && <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />}
                          </div>
                          <p className="text-[10px] text-[var(--muted)]">{n.message}</p>
                          <p className="text-[9px] text-[var(--muted2)] mt-2">
                            {new Date(n.createdAt).toLocaleString()}
                          </p>
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
                className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/20"
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
