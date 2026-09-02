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
  AlertTriangle,
  CheckCircle,
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
  { icon: <Sparkles className="w-4 h-4" />, title: "AI Quiz Generation", desc: "Auto-generate quizzes from topics, text prompts, or syllabus notes with Gemini AI" },
  { icon: <Radio className="w-4 h-4" />, title: "Live Snapshot Monitoring", desc: "Real-time webcam snapshot stream of all examinees with 1.5s live updates" },
  { icon: <Camera className="w-4 h-4" />, title: "Evidence & Violation Logs", desc: "Timeline logs of all violations with captured screenshot forensic evidence" },
  { icon: <Brain className="w-4 h-4" />, title: "Gemini AI Verdict Reports", desc: "AI calculates cheating probability verdicts and generates integrity reports" },
  { icon: <ClipboardList className="w-4 h-4" />, title: "Unlimited Quizzes", desc: "Create as many quizzes and assessments as you need with no limits" },
  { icon: <Shield className="w-4 h-4" />, title: "Live Security & Defense Tools", desc: "Fullscreen lockdown, gaze detection, and multi-device proctoring" },
];

export default function BillingContent() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentMode, setPaymentMode] = useState<"test" | "live">("test");
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [paymentResult, setPaymentResult] = useState<"success" | "cancelled" | null>(null);

  // Fetch billing data
  const fetchBilling = async () => {
    try {
      const res = await fetch("/api/billing");
      if (res.ok) {
        const data = await res.json();
        setIsSubscribed(data.isSubscribed);
        setSubscription(data.subscription);
        setPayments(data.payments || []);
        setPaymentMode(data.paymentMode === "live" ? "live" : "test");
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
        fetchBilling();

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

  useEffect(() => {
    fetchBilling();
  }, []);

  // Standard PayMongo Test Checkout
  const handleUpgrade = async () => {
    setIsUpgrading(true);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        alert(data.error || "Failed to initiate PayMongo checkout.");
      }
    } catch (err) {
      console.error("PayMongo redirect error:", err);
    } finally {
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
      {/* Payment environment banner */}
      <div className={`flex items-center justify-between p-3.5 rounded-xl text-xs ${
        paymentMode === "live"
          ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-500"
          : "bg-blue-500/10 border border-blue-500/20 text-blue-400"
      }`}>
        <span className="flex items-center gap-2 font-semibold">
          <Shield className="w-4 h-4" />
          {paymentMode === "live"
            ? "PayMongo Live Payments Active"
            : "PayMongo Sandbox Active (Test Mode Only — No real money charged)"}
        </span>
        <span className="px-2 py-0.5 rounded-full bg-current/10 text-[10px] font-bold">
          {paymentMode === "live" ? "LIVE" : "TEST KEYS"}
        </span>
      </div>

      {/* Payment Result Banners */}
      {paymentResult === "success" && (
        <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl animate-fade-in">
          <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
          <div>
            <p className="text-sm font-bold text-emerald-500">Payment received</p>
            <p className="text-xs text-[var(--muted)]">Your plan will activate after PayMongo's signed webhook is verified. Refresh in a few seconds.</p>
          </div>
        </div>
      )}
      {paymentResult === "cancelled" && (
        <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl animate-fade-in">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-bold text-amber-500">Payment Cancelled</p>
            <p className="text-xs text-[var(--muted)]">PayMongo checkout was cancelled. You can retry when ready.</p>
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
                {isSubscribed ? (subscription?.planName || "Premium Tier") : "Free Tier"}
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
                You are currently on the Free plan. AI Quiz Generation and Live Monitoring require a Premium subscription.
              </p>
            </div>
          )}

          {/* Features Grid */}
          <div className="grid md:grid-cols-2 gap-3 mb-6">
            {premiumFeatures.map((f) => (
              <div
                key={f.title}
                className={`flex items-start gap-3 p-3.5 rounded-xl transition-all ${
                  isSubscribed
                    ? "bg-white/[0.04] border border-white/[0.06]"
                    : "bg-[var(--surface2)] border border-[var(--border)] opacity-70"
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
                    {isSubscribed && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                  </h4>
                  <p className="text-[10px] text-[var(--muted)] leading-relaxed mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Upgrade Buttons */}
          {!isSubscribed && (
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleUpgrade}
                disabled={isUpgrading}
                className="w-full sm:w-auto px-7 py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-bold rounded-xl hover:opacity-90 transition-all shadow-xl shadow-indigo-600/20 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isUpgrading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Opening PayMongo...
                  </>
                ) : (
                  <>
                    <Crown className="w-4 h-4" />
                    Pay with PayMongo ({paymentMode === "live" ? "₱500" : "Test ₱500"})
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Payment History Table */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h3 className="text-sm font-bold text-[var(--ink)] flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-indigo-500" />
            Payment History
          </h3>
          <span className="text-[10px] text-[var(--muted)]">
            Auto-recorded in PostgreSQL
          </span>
        </div>
        <div className="min-h-[120px] overflow-x-auto">
          {payments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-[var(--muted)]">
              <CreditCard className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-xs font-semibold">No payment history yet</p>
              <p className="text-[10px] text-[var(--muted2)] mt-0.5">
                Transactions will appear here after completing sandbox checkout
              </p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface2)]/50">
                  {["Date", "Amount", "Method", "Reference", "Status"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] text-xs">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--surface2)]/40 transition-colors">
                    <td className="px-5 py-3 text-[var(--ink)] font-medium">
                      {p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </td>
                    <td className="px-5 py-3 font-bold text-[var(--ink)]">
                      ₱{Number(p.amount).toFixed(2)}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 uppercase font-mono">
                        {p.method || "gcash"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[var(--muted)] font-mono text-[11px]">
                      {p.reference || "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full ${
                        p.status === "completed" || p.status === "paid"
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
