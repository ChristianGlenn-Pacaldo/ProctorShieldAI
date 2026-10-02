"use client";

import { createContext, useContext } from "react";

export type AdminSessionLoss = 401 | 403;

export interface AdminSessionLifecycle {
  getLoss: () => AdminSessionLoss | null;
  subscribe: (listener: (status: AdminSessionLoss) => void) => () => void;
  reportLoss: (status: AdminSessionLoss) => void;
}

// One channel per shell mount. Loss is sticky until a fresh, server-authorized
// Admin mount; an ordinary successful background response cannot reset it.
export function createAdminSessionLifecycle(): AdminSessionLifecycle {
  let loss: AdminSessionLoss | null = null;
  const listeners = new Set<(status: AdminSessionLoss) => void>();
  return {
    getLoss: () => loss,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    reportLoss(status) {
      if (loss !== null) return;
      loss = status;
      // Invalidate requests/subscriptions synchronously, before React renders.
      for (const listener of listeners) listener(status);
    },
  };
}

export const AdminSessionLifecycleContext = createContext<AdminSessionLifecycle | null>(null);

export function useAdminSessionLifecycle() {
  return useContext(AdminSessionLifecycleContext);
}
