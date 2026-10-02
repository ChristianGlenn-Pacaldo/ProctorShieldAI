export type ArenaFeedbackOutcome = "launched" | "hit" | "deflected";
export interface ArenaRealtimeView {
  quizId: number;
  sessionId: string | null;
  terminal: boolean;
}
interface ArenaEventIdentity {
  quizId?: unknown;
  sessionId?: unknown;
  arenaRevision?: unknown;
  revision?: unknown;
  arena?: { quizId?: unknown; sessionId?: unknown; revision?: unknown };
}
const combatFeedbackEvents = new Set([
  "arena-incoming-attack", "incoming-attack", "battle-attack",
  "arena-attack-hit", "attack-hit", "arena-attack-deflected", "arena-attack-blocked", "attack-deflected", "attack-blocked",
]);

export function hasTerminalArenaFeedback(displayed: Set<string>, attackId: string): boolean {
  return displayed.has(`${attackId}:hit`) || displayed.has(`${attackId}:deflected`);
}

/** Committed revisions are monotonic across session resets. Equal revisions
 * allow several event types/aliases from one commit; older snapshots lose. */
export function acceptArenaRevision(cursor: { current: number }, data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as { arenaRevision?: number; revision?: number; arena?: { revision?: number } };
  const revision = record.arenaRevision ?? record.revision ?? record.arena?.revision;
  if (revision === undefined) return false; // Unversioned feedback is not committed state.
  if (!Number.isSafeInteger(revision) || revision < cursor.current) return false;
  cursor.current = revision;
  return true;
}

/** Revisions have authority only within the currently adopted persisted session. */
export function arenaEventMatchesView(data: unknown, view: ArenaRealtimeView): boolean {
  if (!data || typeof data !== "object" || !view.sessionId) return false;
  const record = data as ArenaEventIdentity;
  const quizId = record.quizId ?? record.arena?.quizId;
  const sessionId = record.sessionId ?? record.arena?.sessionId;
  return quizId === view.quizId && sessionId === view.sessionId
    && [record.quizId, record.arena?.quizId].every(id => id === undefined || id === view.quizId)
    && [record.sessionId, record.arena?.sessionId].every(id => id === undefined || id === view.sessionId);
}

export function acceptArenaEventRevision(cursor: { current: number }, data: unknown, view: ArenaRealtimeView): boolean {
  return !view.terminal && arenaEventMatchesView(data, view) && acceptArenaRevision(cursor, data);
}

/** Bind through a per-view revision guard without modifying shared channels. */
export function guardArenaChannel<T extends object>(channel: T, cursor: { current: number }, options?: {
  getIdentity?: () => ArenaRealtimeView;
  isLive?: () => boolean;
  onStateHint?: () => void;
  onSessionHint?: () => void;
}): T {
  return new Proxy(channel, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (key === "bind" && typeof value === "function") {
        return (event: string, handler: (data: unknown) => void, context?: unknown) => value.call(
          target, event, (data: unknown) => {
            if (options?.isLive && !options.isLive()) return;
            const view = options?.getIdentity?.();
            if (!view) { options?.onStateHint?.(); return; }
            const record = data && typeof data === "object" ? data as ArenaEventIdentity : null;
            // Reject foreign/conflicting Arena identity before even reading its revision.
            if ([record?.quizId, record?.arena?.quizId].some(id => id !== undefined && id !== view.quizId)) return;
            if (event === "arena-reset" || event === "arena-session-created") {
              // A different persisted session can be adopted only by an authoritative
              // read. The notification itself never changes the cursor or gameplay.
              const sessionId = record?.sessionId ?? record?.arena?.sessionId;
              if ((record?.quizId ?? record?.arena?.quizId) === view.quizId && typeof sessionId === "string" && sessionId) {
                options?.onSessionHint?.();
              } else options?.onStateHint?.();
              return;
            }
            if (view.sessionId && [record?.sessionId, record?.arena?.sessionId].some(id => id !== undefined && id !== view.sessionId)) return;
            if (view.terminal) return;
            // Join notifications refresh membership; only explicitly identified
            // participant transitions may additionally produce informational feed.
            // Neither enrollment nor join feedback advances the snapshot cursor.
            if (event === "arena-student-joined") { handler(data); return; }
            if (!arenaEventMatchesView(data, view)) { options?.onStateHint?.(); return; }
            // Combat feedback is independently identified by attackId. A newer
            // unrelated score event must not suppress a valid reaction window.
            if (combatFeedbackEvents.has(event)) { handler(data); return; }
            if ((record?.arenaRevision ?? record?.revision ?? record?.arena?.revision) === undefined) {
              options?.onStateHint?.();
              return;
            }
            if (acceptArenaEventRevision(cursor, data, view)) handler(data);
          }, context,
        );
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function getShieldTerminalOutcome(response: {
  code?: string;
  deflected?: boolean;
  attackStatus?: string;
}): "hit" | "deflected" | null {
  if (response.code === "blocked" || response.deflected || response.attackStatus === "deflected") {
    return "deflected";
  }
  if (response.attackStatus === "hit") return "hit";
  return null;
}

export function claimArenaFeedback(
  displayed: Set<string>,
  attackId: string,
  outcome: ArenaFeedbackOutcome,
): boolean {
  const key = `${attackId}:${outcome}`;
  if (displayed.has(key)) return false;
  displayed.add(key);
  return true;
}

/** One membership transition per Student in an authoritative Arena session. */
export function getArenaJoinKey(quizId: number, sessionId: string, studentId: string): string {
  return JSON.stringify([quizId, sessionId, studentId]);
}

/** Informational transitions dedupe by identity, independently of state revisions. */
export function claimArenaJoinFeedback(displayed: Set<string>, data: unknown, view: ArenaRealtimeView): string | null {
  if (view.terminal || !arenaEventMatchesView(data, view)) return null;
  const record = data as ArenaEventIdentity & { joinKind?: unknown; studentId?: unknown; joinEventId?: unknown };
  const revision = record.arenaRevision ?? record.revision ?? record.arena?.revision;
  if (record.joinKind !== "participant" || typeof record.studentId !== "string" || !record.studentId
    || !Number.isSafeInteger(revision)) return null;
  const key = getArenaJoinKey(view.quizId, view.sessionId!, record.studentId);
  if (record.joinEventId !== key || displayed.has(key)) return null;
  displayed.add(key);
  return key;
}
