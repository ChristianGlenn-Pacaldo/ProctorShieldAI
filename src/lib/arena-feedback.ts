export type ArenaFeedbackOutcome = "launched" | "hit" | "deflected";
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
  if (!data || typeof data !== "object") return true;
  const record = data as { arenaRevision?: number; revision?: number; arena?: { revision?: number } };
  const revision = record.arenaRevision ?? record.revision ?? record.arena?.revision;
  if (revision === undefined) return true; // compatibility with enrollment notifications
  if (!Number.isSafeInteger(revision) || revision < cursor.current) return false;
  cursor.current = revision;
  return true;
}

/** Bind through a per-view revision guard without modifying shared channels. */
export function guardArenaChannel<T extends object>(channel: T, cursor: { current: number }): T {
  return new Proxy(channel, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (key === "bind" && typeof value === "function") {
        return (event: string, handler: (data: unknown) => void, context?: unknown) => value.call(
          target, event, (data: unknown) => {
            // Combat feedback is independently identified by attackId. A newer
            // unrelated score event must not suppress a valid reaction window.
            if (combatFeedbackEvents.has(event) || acceptArenaRevision(cursor, data)) handler(data);
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
