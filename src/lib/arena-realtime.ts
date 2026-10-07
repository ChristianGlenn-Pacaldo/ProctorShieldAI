import { arenaPusher } from "@/lib/pusher";
import { computeArenaRankings, getPowerPenalty, type ArenaMutation, type ArenaState, type ArenaParticipant, type PendingAttack } from "./arena.ts";

/** Queue immutable payloads; registration performs no provider/network work. */
export function arenaRealtime(mutation: ArenaMutation) {
  return {
    trigger(channels: string | string[], event: string, data: object): Promise<void> {
      const payload = structuredClone(data);
      mutation.afterCommit(async ({ signal }) => {
        await arenaPusher.trigger(channels, event, {
          ...payload,
          quizId: mutation.state?.quizId,
          ...("arena" in payload && payload.arena && typeof payload.arena === "object"
            ? { arena: { ...payload.arena, revision: mutation.state?.revision } } : {}),
          arenaRevision: mutation.state?.revision,
          sessionId: mutation.state?.sessionId,
        }, { signal });
      }, { realtime: true });
      return Promise.resolve();
    },
  };
}

export async function broadcastArenaAttackHit(quizId: number, arena: ArenaState, resolution: {
  attack: PendingAttack;
  target: ArenaParticipant;
  participants?: ArenaParticipant[];
  penalty?: number;
}, realtime: ReturnType<typeof arenaRealtime>) {
  const attack = resolution.attack;
  const target = resolution.target;
  const blocked = attack.status === "deflected";
  const penalty = blocked ? 0 : resolution.penalty ?? getPowerPenalty(attack.powerType);
  const updatedRankings = resolution.participants ?? computeArenaRankings(arena.participants);
  const hitEventData = {
    quizId,
    arenaRevision: arena.revision,
    attackId: attack.attackId,
    sessionId: attack.sessionId || arena.sessionId,
    attackerId: attack.attackerId,
    attackerName: attack.attackerName,
    targetStudentId: attack.targetStudentId,
    targetId: attack.targetStudentId,
    targetName: attack.targetName,
    powerType: attack.powerType,
    scorePenalty: penalty,
    damage: penalty,
    targetCurrentScore: target.score,
    targetRank: target.rank,
    participants: updatedRankings,
    status: "hit",
    ...(blocked ? { status: "deflected" } : {}),
    timestamp: new Date().toISOString(),
  };
  await Promise.allSettled([
    realtime.trigger([`private-arena-${quizId}`, `private-teacher-${arena.teacherId}`], blocked ? "arena-attack-blocked" : "arena-attack-hit", hitEventData),
    realtime.trigger(`private-arena-${quizId}`, blocked ? "attack-blocked" : "attack-hit", hitEventData),
    realtime.trigger(`private-arena-${quizId}`, "arena-score-updated", {
      quizId,
      arenaRevision: arena.revision,
      sessionId: arena.sessionId,
      studentId: attack.targetStudentId,
      score: target.score,
      rank: target.rank,
      totalCount: updatedRankings.length,
      penalty,
    }),
    realtime.trigger(`private-arena-${quizId}`, "arena-leaderboard-updated", {
      quizId,
      arenaRevision: arena.revision,
      sessionId: arena.sessionId,
      participants: updatedRankings,
    }),
  ]);
  return hitEventData;
}
