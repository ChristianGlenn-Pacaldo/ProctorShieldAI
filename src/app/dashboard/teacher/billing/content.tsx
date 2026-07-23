"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle, CreditCard, Brain, Zap, Shield } from "lucide-react";

export default function BillingContent({
  isSubscribed,
  planName,
  endDate,
  success,
  canceled,
}: {
  isSubscribed: boolean;
  planName?: string;
  endDate?: string;
  success: boolean;
  canceled: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Only in development: If returning with success=true, mock the webhook
    if (success && !isSubscribed) {
      const activate = async () => {
        try {
          const res = await fetch("/api/billing/sync-dev", { method: "POST" });
          if (res.ok) {
            window.location.href = "/dashboard/teacher/billing";
          }
        } catch (err) {
          console.error("Dev sync failed", err);
        }
      };
      activate();
    }
  }, [success, isSubscribed]);

  const handleSubscribe = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to initialize checkout.");
      
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--ink)]">Billing & Subscription</h1>
        <p className="text-[var(--muted)] mt-1">Manage your ProctorShield AI Pro plan</p>
      </div>

      {success && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-3 text-emerald-600">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-semibold">Payment Successful!</p>
            <p className="text-sm opacity-90">Your subscription has been activated. Thank you!</p>
          </div>
        </div>
      )}

      {canceled && (
        <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl flex items-center gap-3 text-orange-600">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-semibold">Payment Canceled</p>
            <p className="text-sm opacity-90">You have canceled the checkout process.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-500">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="font-medium">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Current Plan Card */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2.5 rounded-xl bg-indigo-600/10 text-indigo-600">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--ink)]">Current Plan</h2>
              <p className="text-sm text-[var(--muted)]">Your active subscription</p>
            </div>
          </div>

          {isSubscribed ? (
            <div className="space-y-4">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 text-sm font-semibold">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Active
              </div>
              <div>
                <p className="text-[var(--muted)] text-sm mb-1">Plan</p>
                <p className="font-bold text-lg text-[var(--ink)]">{planName}</p>
              </div>
              <div>
                <p className="text-[var(--muted)] text-sm mb-1">Valid Until</p>
                <p className="font-medium text-[var(--ink)]">
                  {new Date(endDate!).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--surface2)] text-[var(--muted)] text-sm font-semibold">
                Free Tier
              </div>
              <p className="text-[var(--muted)] text-sm">
                You are currently on the free tier. You can create quizzes manually, but AI generation is disabled.
              </p>
            </div>
          )}
        </div>

        {/* Upgrade Card */}
        <div className="bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl p-1 shadow-lg">
          <div className="bg-[var(--surface)] rounded-[14px] h-full p-6 flex flex-col">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-indigo-600 text-white">
                <Brain className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[var(--ink)]">ProctorShield AI Pro</h2>
                <p className="text-sm text-[var(--muted)] capitalize">Boost your productivity</p>
              </div>
            </div>

            <div className="mb-6">
              <div className="flex items-end gap-1">
                <span className="text-3xl font-extrabold text-[var(--ink)]">₱500</span>
                <span className="text-[var(--muted)] mb-1">/ 30 Days</span>
              </div>
            </div>

            <ul className="space-y-3 mb-8 flex-1">
              <li className="flex items-start gap-2 text-sm text-[var(--muted)]">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <span>Unlimited AI Quiz Generation</span>
              </li>
              <li className="flex items-start gap-2 text-sm text-[var(--muted)]">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <span>Generate from text topics or images</span>
              </li>
              <li className="flex items-start gap-2 text-sm text-[var(--muted)]">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <span>Priority support</span>
              </li>
            </ul>

            <button
              onClick={handleSubscribe}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-500 transition-all disabled:opacity-70 shadow-md shadow-indigo-600/20"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <CreditCard className="w-5 h-5" />
                  {isSubscribed ? "Extend Subscription" : "Subscribe via GCash / Card"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
