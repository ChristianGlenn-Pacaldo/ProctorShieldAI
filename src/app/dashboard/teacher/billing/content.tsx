"use client";

import { useState, useEffect } from "react";

import {
  CreditCard,
  Crown,
  Sparkles,
  Radio,
  Camera,
  Brain,
  ClipboardList,
  Shield,
  Check,
  ExternalLink,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from "lucide-react";

interface Subscription {
  id: string;
  planName: string;
  startDate: string;
  endDate: string;
  status: string;
  price: string;
}

interface PaymentRecord {
  id: string;
  amount: string;
  method: string;
  status: string;
  reference: string;
  paidAt: string;
}

const premiumFeatures = [
  { icon: <Sparkles className="w-4 h-4" />, title: "AI Quiz Generation", desc: "Auto-generate quizzes from topics, images, or webcam captures using Gemini AI" },
  { icon: <Radio className="w-4 h-4" />, title: "Live Monitoring", desc: "Real-time webcam feed of all students with 1-second snapshot updates" },
  { icon: <Camera className="w-4 h-4" />, title: "Evidence Replay", desc: "Full timeline replay of all violations with captured screenshot evidence" },
  { icon: <Brain className="w-4 h-4" />, title: "AI Verdict Reports", desc: "Gemini AI analyzes violations and delivers cheating probability verdicts" },
  { icon: <ClipboardList className="w-4 h-4" />, title: "Unlimited Quizzes", desc: "Create as many quizzes as you need with no restrictions" },
  { icon: <Shield className="w-4 h-4" />, title: "Priority Support", desc: "Dedicated support channel for premium subscribers" },
];

export default function BillingContent() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [paymentResult, setPaymentResult] = useState<"success" | "cancelled" | null>(null);

  // Fetch billing data function (moved up so it can be used in the first useEffect)
  const fetchBilling = async () => {
    try {
      const res = await fetch("/api/billing");
      if (res.ok) {
        const data = await res.json();
        setIsSubscribed(data.isSubscribed);
        setSubscription(data.subscription);
        setPayments(data.payments || []);
      }
    } catch (err) {
      console.error("Failed to load billing:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Check URL params for payment result
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const payment = params.get("payment");
      if (payment === "success") {
        setPaymentResult("success");
        // Confirm payment and activate subscription locally
        fetch("/api/billing/confirm", { method: "POST" })
          .then(() => {
            fetchBilling(); // Refresh billing data to show premium status
          })
          .catch((err) => console.error("Confirmation error:", err));

        // Clean URL
        const url = new URL(window.location.href);
        url.searchParams.delete("payment");
        window.history.replaceState({}, "", url.pathname);
      } else if (payment === "cancelled") {
        setPaymentResult("cancelled");
        const url = new URL(window.location.href);
        url.searchParams.delete("payment");
        window.history.replaceState({}, "", url.pathname);
      }
    }
  }, []);

  // Initial fetch billing data
  useEffect(() => {
    fetchBilling();
  }, []);

  const handleUpgrade = async () => {
    setIsUpgrading(true);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok && data.checkoutUrl) {
        // Redirect to PayMongo checkout (GCash/Card)
        window.location.href = data.checkoutUrl;
      } else {
        alert(data.error || "Failed to initiate checkout. Please try again.");
        setIsUpgrading(false);
      }
    } catch (err) {
      alert("Network error. Please check your connection.");
      setIsUpgrading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6 max-w-4xl mx-auto">
      {/* Payment Result Banners */}
      {paymentResult === "success" && (
        <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl animate-fade-in">
          <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
          <div>
            <p className="text-sm font-bold text-emerald-500">Payment Successful!</p>
            <p className="text-xs text-[var(--muted)]">Your Premium subscription is now active. It may take a moment to reflect. Refresh the page if needed.</p>
          </div>
        </div>
      )}
      {paymentResult === "cancelled" && (
        <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl animate-fade-in">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-bold text-amber-500">Payment Cancelled</p>
            <p className="text-xs text-[var(--muted)]">Your checkout was cancelled. No charges were made. You can try again anytime.</p>
          </div>
        </div>
      )}

      {/* Current Plan Card */}
      <div className={`rounded-2xl border overflow-hidden ${
        isSubscribed
          ? "bg-gradient-to-br from-indigo-600/10 via-violet-600/5 to-transparent border-indigo-500/30"
          : "bg-[var(--surface)] border-[var(--border)]"
      }`}>
        <div className="p-6 md:p-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                {isSubscribed ? (
                  <Crown className="w-5 h-5 text-amber-400" />
                ) : (
                  <CreditCard className="w-5 h-5 text-[var(--muted)]" />
                )}
                <span className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
                  Current Plan
                </span>
              </div>
              <h2 className="text-2xl font-extrabold text-[var(--ink)]">
                {isSubscribed ? "Premium Monthly" : "Free Plan"}
              </h2>
              {isSubscribed && subscription && (
                <p className="text-xs text-[var(--muted)] mt-1">
                  Active until {new Date(subscription.endDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                </p>
              )}
            </div>
            {isSubscribed ? (
              <span className="px-3 py-1.5 rounded-full bg-emerald-500/15 text-emerald-500 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1">
                <Check className="w-3 h-3" /> Active
              </span>
            ) : (
              <span className="px-3 py-1.5 rounded-full bg-[var(--surface2)] text-[var(--muted)] text-[10px] font-extrabold uppercase tracking-wider">
                Free Tier
              </span>
            )}
          </div>

          {!isSubscribed && (
            <div className="bg-[var(--surface2)] rounded-xl p-5 border border-[var(--border)] mb-6">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-bold text-amber-500">Limited Access</span>
              </div>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                You are on the Free plan. AI Quiz Generation and Live Monitoring require a Premium subscription.
                Upgrade now to unlock all features.
              </p>
            </div>
          )}

          {/* Features Grid */}
          <div className="grid md:grid-cols-2 gap-3 mb-6">
            {premiumFeatures.map((f) => (
              <div
                key={f.title}
                className={`flex items-start gap-3 p-3 rounded-xl transition-all ${
                  isSubscribed
                    ? "bg-white/[0.04] border border-white/[0.06]"
                    : "bg-[var(--surface2)] border border-[var(--border)] opacity-60"
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  isSubscribed ? "bg-indigo-500/15 text-indigo-500" : "bg-[var(--surface)] text-[var(--muted)]"
                }`}>
                  {f.icon}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[var(--ink)] flex items-center gap-1.5">
                    {f.title}
                    {isSubscribed && <Check className="w-3 h-3 text-emerald-500" />}
                  </h4>
                  <p className="text-[10px] text-[var(--muted)] leading-relaxed mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Upgrade Button */}
          {!isSubscribed && (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <button
                onClick={handleUpgrade}
                disabled={isUpgrading}
                className="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-xl shadow-indigo-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isUpgrading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Crown className="w-4 h-4" />
                    Upgrade to Premium — ₱500/month
                  </>
                )}
              </button>
              <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                <Shield className="w-3 h-3" />
                Secured by PayMongo · GCash & Card accepted
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Payment History */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)] flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-indigo-500" />
            Payment History
          </h3>
        </div>
        <div className="min-h-[120px]">
          {payments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-[var(--muted)]">
              <CreditCard className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-xs font-semibold">No payment history</p>
              <p className="text-[10px] text-[var(--muted2)] mt-0.5">
                Your transactions will appear here after upgrading
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Date", "Amount", "Method", "Reference", "Status"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--surface2)] transition-colors">
                    <td className="px-5 py-3 text-sm text-[var(--ink)]">
                      {p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </td>
                    <td className="px-5 py-3 text-sm font-semibold text-[var(--ink)]">
                      ₱{Number(p.amount).toFixed(2)}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 uppercase">
                        {p.method || "gcash"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--muted)] font-mono">
                      {p.reference || "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                        p.status === "completed"
                          ? "bg-emerald-500/15 text-emerald-600"
                          : p.status === "pending"
                          ? "bg-amber-500/15 text-amber-600"
                          : "bg-red-500/15 text-red-500"
                      }`}>
                        {(p.status || "completed").toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}
