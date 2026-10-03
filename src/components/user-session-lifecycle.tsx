"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

export type UserSessionLoss = 401 | 403;
export interface UserSessionLifecycle {
  getLoss: () => UserSessionLoss | null;
  subscribe: (listener: (status: UserSessionLoss) => void) => () => void;
  reportLoss: (status: UserSessionLoss) => void;
}

// A fresh server-authorized shell gets a new channel. Success responses cannot
// revive a channel whose User authorization has already been lost.
export function createUserSessionLifecycle(): UserSessionLifecycle {
  let loss: UserSessionLoss | null = null;
  const listeners = new Set<(status: UserSessionLoss) => void>();
  return {
    getLoss: () => loss,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reportLoss(status) {
      if (loss !== null) return;
      loss = status;
      for (const listener of listeners) listener(status);
    },
  };
}

export const UserSessionLifecycleContext = createContext<UserSessionLifecycle | null>(null);
export function useUserSessionLifecycle() { return useContext(UserSessionLifecycleContext); }

// Entitlement, ownership and Origin-policy restrictions are not session loss.
export async function getUserSessionLoss(response: Pick<Response, "status" | "json"> & { clone?: () => Response }): Promise<UserSessionLoss | null> {
  if (response.status === 401) return 401;
  if (response.status !== 403) return null;
  try {
    const body = await (response.clone ? response.clone() : response).json();
    if (["SUBSCRIPTION_REQUIRED", "FORBIDDEN_ORIGIN"].includes(body?.code)) return null;
    return ["Unauthorized", "Forbidden", "Account inactive", "Account suspended", "Authentication changed; sign in again"]
      .includes(body?.error) ? 403 : null;
  } catch { return null; }
}

export function createUserSessionWork(session: UserSessionLifecycle | null) {
  let active = false, generation = 0;
  const requests = new Set<AbortController>();
  const cleanups = new Set<() => void>();
  const isCurrent = (token: number) => active && token === generation && !session?.getLoss();
  const stop = () => {
    active = false; generation++;
    for (const request of requests) request.abort();
    requests.clear();
    for (const cleanup of cleanups) {
      try { cleanup(); } catch { console.error("User session resource cleanup failed"); }
    }
    cleanups.clear();
  };
  return {
    start() { generation++; active = !session?.getLoss(); },
    stop,
    capture: () => generation,
    isCurrent,
    reportLoss: (status: UserSessionLoss) => { session?.reportLoss(status); stop(); },
    beginRequest() {
      if (!isCurrent(generation)) return null;
      const controller = new AbortController(); requests.add(controller);
      return { controller, generation };
    },
    finishRequest: (controller: AbortController) => { requests.delete(controller); },
    addCleanup(cleanup: () => void) {
      if (!isCurrent(generation)) { cleanup(); return () => {}; }
      let disposed = false;
      const dispose = () => { if (disposed) return; disposed = true; cleanups.delete(dispose); cleanup(); };
      cleanups.add(dispose);
      return dispose;
    },
    async acceptResponse(response: Parameters<typeof getUserSessionLoss>[0], request: { controller: AbortController; generation: number }) {
      if (!isCurrent(request.generation) || request.controller.signal.aborted) return false;
      const loss = await getUserSessionLoss(response);
      if (!isCurrent(request.generation) || request.controller.signal.aborted) return false;
      if (loss) { session?.reportLoss(loss); stop(); return false; }
      return true;
    },
  };
}

export function useUserSessionWork(onLoss?: () => void) {
  const session = useUserSessionLifecycle();
  const [work] = useState(() => createUserSessionWork(session));
  const [loss, setLoss] = useState<UserSessionLoss | null>(() => session?.getLoss() ?? null);
  const onLossRef = useRef(onLoss);
  useEffect(() => { onLossRef.current = onLoss; }, [onLoss]);
  useEffect(() => {
    work.start();
    const lose = (status: UserSessionLoss) => { work.stop(); onLossRef.current?.(); setLoss(status); };
    const unsubscribe = session?.subscribe(lose);
    const knownLoss = session?.getLoss();
    if (knownLoss) lose(knownLoss);
    return () => { unsubscribe?.(); work.stop(); };
  }, [session, work]);
  return { work, loss };
}

export function UserSessionReauthentication({ status }: { status: UserSessionLoss }) {
  return <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6">
    <p>{status === 401 ? "Your session has expired or changed. Sign in again to continue." : "You no longer have access to this User portal. Sign in again to continue."}</p>
    <a href="/login" className="mt-3 inline-block font-semibold underline">User Login</a>
  </div>;
}
