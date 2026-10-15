"use client";

import { createContext, useContext } from "react";

// Server-rendered policy controls discoverability. API guards independently
// enforce it even for stale tabs or modified client state.
const PowerArenaContext = createContext(false);
export function PowerArenaFeatureProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <PowerArenaContext.Provider value={enabled}>{children}</PowerArenaContext.Provider>;
}
export function usePowerArenaEnabled() { return useContext(PowerArenaContext); }
