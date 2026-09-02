"use client";

import { useState, useEffect } from "react";
import { Users, BookOpen, Brain, CreditCard } from "lucide-react";

interface AnalyticsData {
  userStats: { totalUsers: number; totalStudents: number; totalTeachers: number; totalAdmins: number; newUsersThisMonth: number };
  subscriptionStats: { proTeachers: number; freeTeachers: number; conversionPct: number };
  quizStats: { totalQuizzes: number; completedQuizzes: number; totalAttempts: number };
  aiStats: { totalVerdicts: number; totalViolations: number; cleanCount: number; suspiciousCount: number; cheatedCount: number; cleanPct: number; suspiciousPct: number; cheatedPct: number; flaggedPct: number };
}

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-5">
      <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center mb-3`}>
        {icon}
      </div>
      <div className="text-2xl font-extrabold text-[var(--ink)]">{value}</div>
      <div className="text-xs font-semibold text-[var(--ink2)] mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-[var(--muted)] mt-0.5">{sub}</div>}
    </div>
  );
}

function Bar({ label, value, pct, color }: { label: string; value: number | string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[var(--muted)] w-36 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2.5 bg-[var(--surface2)] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${Math.max(1, pct)}%` }} />
      </div>
      <span className="text-xs font-bold text-[var(--ink)] w-10 text-right">{value}</span>
    </div>
  );
}

export default function AnalyticsContent() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/admin/analytics")
      .then((res) => res.json())
      .then((json) => { if (json.success) setData(json); })
      .catch((err) => console.error("Failed to load analytics:", err))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="animate-fade-in flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <div className="animate-fade-in text-center py-10 text-sm text-[var(--muted)]">Failed to load analytics data.</div>;
  }

  const totalUsersSafe = Math.max(1, data.userStats.totalUsers);

  return (
    <div className="animate-fade-in space-y-4">
      {/* Top Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Users className="w-5 h-5 text-blue-600" />}
          label="Total Users"
          value={data.userStats.totalUsers}
          sub={`+${data.userStats.newUsersThisMonth} this month`}
          color="bg-blue-500/10"
        />
        <StatCard
          icon={<BookOpen className="w-5 h-5 text-violet-600" />}
          label="Total Quizzes"
          value={data.quizStats.totalQuizzes}
          sub={`${data.quizStats.completedQuizzes} completed`}
          color="bg-violet-500/10"
        />
        <StatCard
          icon={<Brain className="w-5 h-5 text-rose-500" />}
          label="AI Violations"
          value={data.aiStats.totalViolations}
          sub={`${data.aiStats.flaggedPct}% flagged rate`}
          color="bg-rose-500/10"
        />
        <StatCard
          icon={<CreditCard className="w-5 h-5 text-emerald-500" />}
          label="Pro Teachers"
          value={data.subscriptionStats.proTeachers}
          sub={`${data.subscriptionStats.conversionPct}% conversion`}
          color="bg-emerald-500/10"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Platform Distribution */}
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">📊 Platform Distribution</h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">User breakdown by role</p>
          </div>
          <div className="p-5 space-y-4">
            <Bar label="Students" value={data.userStats.totalStudents} pct={Math.round((data.userStats.totalStudents / totalUsersSafe) * 100)} color="bg-blue-500" />
            <Bar label="Teachers" value={data.userStats.totalTeachers} pct={Math.round((data.userStats.totalTeachers / totalUsersSafe) * 100)} color="bg-violet-500" />
            <Bar label="Admins" value={data.userStats.totalAdmins} pct={Math.round((data.userStats.totalAdmins / totalUsersSafe) * 100)} color="bg-rose-500" />
          </div>
        </div>

        {/* AI Verdict Distribution */}
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">🛡️ AI Verdict Distribution</h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">{data.aiStats.totalVerdicts} total verdicts analyzed</p>
          </div>
          <div className="p-5 space-y-4">
            {data.aiStats.totalVerdicts === 0 ? (
              <div className="text-center text-sm text-[var(--muted)] py-4">No AI verdicts have been issued yet.</div>
            ) : (
              <>
                <Bar label="Clean Sessions" value={`${data.aiStats.cleanPct}%`} pct={data.aiStats.cleanPct} color="bg-emerald-500" />
                <Bar label="Suspicious" value={`${data.aiStats.suspiciousPct}%`} pct={data.aiStats.suspiciousPct} color="bg-amber-500" />
                <Bar label="Cheated" value={`${data.aiStats.cheatedPct}%`} pct={data.aiStats.cheatedPct} color="bg-rose-500" />
              </>
            )}
          </div>
        </div>

        {/* Subscription Breakdown */}
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">💳 Subscription Breakdown</h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">Teacher plan adoption</p>
          </div>
          <div className="p-5 space-y-4">
            <Bar label="PRO (Active)" value={data.subscriptionStats.proTeachers} pct={data.subscriptionStats.conversionPct} color="bg-emerald-500" />
            <Bar label="Free Plan" value={data.subscriptionStats.freeTeachers} pct={100 - data.subscriptionStats.conversionPct} color="bg-slate-400" />
            <div className="pt-3 border-t border-[var(--border)]">
              <div className="text-3xl font-extrabold text-[var(--ink)]">{data.subscriptionStats.conversionPct}%</div>
              <p className="text-xs text-[var(--muted)] mt-0.5">Conversion rate (Free → PRO)</p>
            </div>
          </div>
        </div>

        {/* Quiz Activity */}
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--ink)] font-[family-name:var(--font-display)]">📝 Quiz Activity</h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">Platform-wide exam statistics</p>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-extrabold text-[var(--ink)]">{data.quizStats.totalQuizzes}</div>
                <div className="text-[10px] text-[var(--muted)] mt-0.5">Quizzes Created</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-extrabold text-[var(--ink)]">{data.quizStats.totalAttempts}</div>
                <div className="text-[10px] text-[var(--muted)] mt-0.5">Total Attempts</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-extrabold text-[var(--ink)]">{data.quizStats.completedQuizzes}</div>
                <div className="text-[10px] text-[var(--muted)] mt-0.5">Completed</div>
              </div>
            </div>
            <Bar
              label="Completion Rate"
              value={`${data.quizStats.totalAttempts > 0 ? Math.round((data.quizStats.completedQuizzes / data.quizStats.totalAttempts) * 100) : 0}%`}
              pct={data.quizStats.totalAttempts > 0 ? Math.round((data.quizStats.completedQuizzes / data.quizStats.totalAttempts) * 100) : 0}
              color="bg-blue-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
