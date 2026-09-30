import { pusherServer } from "@/lib/pusher";
import type { ArenaMutation } from "./arena.ts";

/** Queue immutable payloads; registration performs no provider/network work. */
export function arenaRealtime(mutation: ArenaMutation) {
  return {
    trigger(channels: string | string[], event: string, data: object): Promise<void> {
      const payload = structuredClone(data);
      mutation.afterCommit(async () => {
        await pusherServer.trigger(channels, event, {
          ...payload,
          ...("arena" in payload && payload.arena && typeof payload.arena === "object"
            ? { arena: { ...payload.arena, revision: mutation.state?.revision } } : {}),
          arenaRevision: mutation.state?.revision,
          sessionId: mutation.state?.sessionId,
        });
      });
      return Promise.resolve();
    },
  };
}
