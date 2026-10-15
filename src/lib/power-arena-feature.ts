/** Defense release policy. Only an explicit server environment opt-in enables
 * Arena; no database setting or client request can override this decision.
 * Restart/redeploy after changing POWER_ARENA_ENABLED. */
export function isPowerArenaEnabled(): boolean {
  return process.env.POWER_ARENA_ENABLED === "true";
}

export const ARENA_DISABLED_MESSAGE = "Power Arena is temporarily disabled in the defense release.";
export const ARENA_DISABLED_BODY = { error: ARENA_DISABLED_MESSAGE, code: "FEATURE_DISABLED", feature: "power_arena" };
export const ARENA_DISABLED_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export function isDisabledArenaResource(resource: { quizMode?: string | null; attemptMode?: string | null; quiz?: { quizMode?: string | null } } | null | undefined): boolean {
  return !isPowerArenaEnabled() && (resource?.quizMode === "arena" || resource?.attemptMode === "arena" || resource?.quiz?.quizMode === "arena");
}

export function isArenaPath(pathname: string): boolean {
  return pathname === "/api/live/battle-action" || /^\/(arena|api\/arena|dashboard\/teacher\/playground)(\/|$)/.test(pathname);
}

export class PowerArenaDisabledError extends Error {
  constructor() { super(ARENA_DISABLED_MESSAGE); }
}
