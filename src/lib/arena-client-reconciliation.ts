import type { ArenaQuestionWork } from "./arena-question-work.ts";
import type { ArenaParticipant, ArenaState } from "./arena.ts";

export interface ArenaSnapshot {
  questionWork?: ArenaQuestionWork;
  quizId?: number;
  arenaRevision?: number;
  arena?: ArenaState | null;
  status?: string;
  quizStatus?: string;
  sessionId?: string;
  participants?: ArenaParticipant[];
  usedPowers?: Record<string, boolean>;
  serverTime?: number;
  clientRequestStartedAt?: number;
  resultReady?: boolean;
  result?: { score: number; rank: number; expEarned: number } | null;
  score?: number;
  rank?: number;
  totalCount?: number;
}

/** Capture the same revision/session/generation precedence used by the host.
 * View-only cleanup may survive unrelated revisions; gameplay values may not.
 */
export function beginArenaGameplayAction(read: () => {
  revision: number; sessionId: string | null; generation: number; terminal: boolean;
}) {
  const started = read();
  const isSameView = () => {
    const current = read();
    return !started.terminal && !current.terminal && started.generation === current.generation
      && started.sessionId === current.sessionId;
  };
  return { isSameView, isCurrent(data?: ArenaSnapshot) {
    if (!isSameView()) return false;
    const current = read();
    if (!data) return current.revision === started.revision;
    const revision = data.arenaRevision ?? data.arena?.revision;
    const sessionId = data.sessionId ?? data.arena?.sessionId;
    return Number.isSafeInteger(revision) && revision! >= current.revision
      && sessionId === current.sessionId && data.status !== "ended" && data.arena?.status !== "ended";
  } };
}

export function isTerminalArenaSnapshot(data: ArenaSnapshot): boolean {
  return data.resultReady === true && data.arena?.status === "ended" && !!data.arena.finalizedAt
    && Number.isSafeInteger(data.arena.revision) && Array.isArray(data.participants)
    && data.participants.every((p) => Number.isFinite(p.score) && Number.isFinite(p.rank));
}

export async function fetchArenaSnapshot(quizId: number, signal: AbortSignal): Promise<ArenaSnapshot> {
  const clientRequestStartedAt = Date.now();
  const response = await fetch(`/api/arena/${quizId}?view=snapshot`, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Arena snapshot unavailable");
  const snapshot = await response.json();
  if ((snapshot.quizId ?? snapshot.arena?.quizId) !== quizId
    || [snapshot.quizId, snapshot.arena?.quizId].some(id => id !== undefined && id !== quizId)) throw new Error("Arena snapshot identity mismatch");
  return { ...snapshot, clientRequestStartedAt };
}

/** One read at a time. Retry reads, never submissions/finalization. A successful
 * terminal application stops polling; refresh/reconnect can still re-read it.
 * Abort on cleanup plus a liveness check prevents unmounted/stale application.
 */
export function startArenaReconciliation(options: {
  read: (signal: AbortSignal) => Promise<ArenaSnapshot>;
  apply: (snapshot: ArenaSnapshot) => boolean;
  onError?: () => void;
}) {
  let stopped = false, busy = false, failures = 0;
  let terminalAccepted = false, hintScheduled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    if (stopped || busy) return;
    if (timer) clearTimeout(timer);
    hintScheduled = false;
    busy = true; controller = new AbortController();
    deadline = setTimeout(() => controller?.abort(), 5_000);
    let terminal = false;
    try {
      const snapshot = await options.read(controller.signal);
      if (!stopped && !controller.signal.aborted) {
        terminal = options.apply(snapshot); terminalAccepted = terminal; failures = 0;
      }
      else if (!stopped) failures++;
    } catch {
      if (!stopped) { failures++; options.onError?.(); }
    } finally {
      clearTimeout(deadline); busy = false;
      if (!stopped && !terminal) {
        timer = setTimeout(() => void refresh(), failures ? Math.min(10_000, 1_000 * 2 ** Math.min(failures - 1, 4)) : 3_000);
      }
    }
  };
  void refresh();
  return { refresh, hint(options?: { allowTerminal?: boolean }) {
    // One shared scheduling timer: bursts coalesce, reads never overlap, and
    // hints cannot restart polling after a committed terminal result.
    if (stopped || busy || (terminalAccepted && !options?.allowTerminal) || hintScheduled) return;
    hintScheduled = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { hintScheduled = false; void refresh(); }, 1_000);
  }, stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (deadline) clearTimeout(deadline);
    controller?.abort();
  } };
}
