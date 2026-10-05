"use client";

import { fetchAuth } from "@/lib/auth-request";

import { useEffect, useRef, useState } from "react";
import { GoogleLogin, GoogleOAuthProvider, type CredentialResponse } from "@react-oauth/google";
import { getAuthDestination } from "@/lib/auth-destination";

type Intent = { intent: string; nonce: string };
type Pending = { userId: string; email: string; challenge: string };

export default function UnifiedGoogleSignIn() {
  const [intent, setIntent] = useState<Intent | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [script, setScript] = useState<"loading" | "ready" | "error">("loading");
  const active = useRef(false);
  const submitting = useRef(false);
  const epoch = useRef(0);
  const request = useRef<AbortController | null>(null);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

  useEffect(() => {
    active.current = true;
    const version = ++epoch.current;
    const controller = new AbortController();
    request.current = controller;
    if (clientId) {
      fetchAuth(fetch, "/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "begin" }), signal: controller.signal })
        .then(async response => {
          const data = await response.json();
          if (!active.current || version !== epoch.current) return;
          if (!response.ok || typeof data.intent !== "string" || typeof data.nonce !== "string") throw new Error("Unavailable");
          setIntent({ intent: data.intent, nonce: data.nonce });
        }).catch(() => {
          if (active.current && version === epoch.current) setError("Google sign-in is unavailable. Use email and password or reload to retry.");
        });
    }
    return () => { active.current = false; epoch.current += 1; request.current?.abort(); };
  }, [clientId]);

  const current = (version: number) => active.current && version === epoch.current;
  const renderedEpoch = epoch.current;
  const googleSuccess = async ({ credential }: CredentialResponse) => {
    if (!current(renderedEpoch) || submitting.current || !intent || !credential || pending) return;
    submitting.current = true; setBusy(true); setError("");
    const version = epoch.current;
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetchAuth(fetch, "/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, mode: "signin", intent: intent.intent }), signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!current(version)) return;
      if (!response.ok) {
        setError(response.status === 404 && data?.code === "ACCOUNT_NOT_FOUND"
          ? "No existing account was found. Create a Student or Teacher account below first."
          : "Google sign-in could not continue. Use email and password or reload to retry.");
        return;
      }
      if (data?.success !== true || data.requiresMfa !== true || !["student", "teacher"].includes(data.role)
        || typeof data.userId !== "string" || typeof data.email !== "string" || typeof data.challenge !== "string") {
        setError("Unable to confirm your account. Please start again."); return;
      }
      setPending({ userId: data.userId, email: data.email, challenge: data.challenge });
    } catch {
      if (current(version)) setError("Google sign-in could not continue. Please check your connection and retry.");
    } finally {
      if (current(version)) { submitting.current = false; setBusy(false); }
    }
  };

  const verify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!current(renderedEpoch) || submitting.current || !pending) return;
    if (!/^\d{6}$/.test(otp)) { setError("Enter the 6-digit verification code."); return; }
    submitting.current = true; setBusy(true); setError("");
    const version = epoch.current;
    const controller = new AbortController(); request.current = controller;
    let navigating = false;
    try {
      const response = await fetchAuth(fetch, "/api/auth/verify-otp", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: pending.userId, challenge: pending.challenge, otpCode: otp }), signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!current(version)) return;
      if (!response.ok) {
        setError(response.status === 429 ? "Too many attempts. Please try again later."
          : "Invalid, expired, or changed sign-in. Retry the latest code or start again."); return;
      }
      const role = data?.user?.role;
      const destination = data?.success === true && (role === "student" || role === "teacher") ? getAuthDestination(role) : null;
      if (!destination) { setError("Unable to confirm your account. Please start again."); return; }
      window.location.assign(new URL(destination, window.location.origin).href);
      navigating = true;
    } catch {
      if (current(version)) setError("Unable to verify. Please check your connection and retry.");
    } finally {
      if (current(version) && !navigating) { submitting.current = false; setBusy(false); }
    }
  };

  const cancel = () => {
    epoch.current += 1; request.current?.abort(); submitting.current = false;
    setPending(null); setOtp(""); setBusy(false); setError("");
  };

  return <div className="mt-6">
    <div className="mb-5 flex items-center gap-3"><span aria-hidden="true" className="h-px flex-1 bg-slate-700/60" /><p className="text-xs font-medium text-slate-400">OR</p><span aria-hidden="true" className="h-px flex-1 bg-slate-700/60" /></div>
    {error && <p role="alert" className="text-sm text-rose-400 mb-3">{error}</p>}
    {pending ? <form onSubmit={verify} aria-busy={busy} className="space-y-3">
      <p className="text-sm text-slate-300">Enter the code emailed to {pending.email}.</p>
      <label htmlFor="google-otp" className="text-xs font-semibold text-slate-300 block">Verification Code</label>
      <input id="google-otp" name="otpCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
        value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, ""))} disabled={busy} required
        className="w-full min-h-12 px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-700 text-base text-white focus:outline-none focus:ring-2 focus:ring-blue-400/30" />
      <button type="submit" disabled={busy || otp.length !== 6} className="w-full min-h-12 py-3 rounded-xl bg-blue-600 text-white font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0b1830] disabled:opacity-50 disabled:cursor-not-allowed">
        {busy ? "Verifying..." : "Verify & Sign In"}
      </button>
      <button type="button" onClick={cancel} className="min-h-11 rounded px-2 text-xs font-semibold text-blue-300 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">Start again</button>
    </form> : clientId ? <GoogleOAuthProvider clientId={clientId} onScriptLoadSuccess={() => setScript("ready")} onScriptLoadError={() => setScript("error")}>
      <div className="flex min-h-11 min-w-0 justify-center">
        {intent && script === "ready" && !busy ? <GoogleLogin onSuccess={googleSuccess}
          onError={() => setError("Google sign-in failed. Please retry or use email and password.")}
          text="continue_with" size="large" shape="rectangular" theme="outline" nonce={intent.nonce} auto_select={false} useOneTap={false} />
          : <button type="button" disabled className="w-full min-h-11 py-3 rounded-xl border border-slate-600 text-sm font-semibold text-slate-300 disabled:cursor-not-allowed">Continue with Google</button>}
      </div>
      {script === "error" && <p role="alert" className="text-sm text-rose-400 mt-3">Google sign-in could not load. Use email and password or reload to retry.</p>}
    </GoogleOAuthProvider> : <>
      <button type="button" disabled className="w-full min-h-11 py-3 rounded-xl border border-slate-600 text-sm font-semibold text-slate-300 disabled:cursor-not-allowed">Continue with Google</button>
      <p className="text-xs text-slate-400 mt-3">Google sign-in is unavailable. Use email and password.</p>
    </>}
    <p className="text-center text-xs leading-5 text-slate-300 mt-3">For existing Student and Teacher accounts only.</p>
  </div>;
}
