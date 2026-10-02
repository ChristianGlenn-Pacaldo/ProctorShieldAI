import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import type Pusher from "pusher";

export const ARENA_PUSHER_REQUEST_TIMEOUT_MS = 1_500;
export type ArenaDeliveryFailure = "timeout" | "cancelled" | "rejected" | "network" | "invalid";

/** Static errors only: never attach signed URLs, credentials, body or provider errors. */
export class ArenaDeliveryError extends Error {
  readonly code: ArenaDeliveryFailure;
  constructor(code: ArenaDeliveryFailure) {
    super(`Arena realtime delivery ${code}`);
    this.code = code;
    this.name = "ArenaDeliveryError";
  }
}

/** Arena uses ordinary private channels, not encrypted-channel payloads. Keep
 * the SDK's public signer and wire format; replace only its uncancellable send.
 * Endpoint injection is for isolated loopback tests, never runtime variables. */
export function createArenaPusherDelivery(options: {
  appId: string;
  cluster: string;
  signer: Pick<Pusher, "createSignedQueryString">;
  endpoint?: URL;
  timeoutMs?: number;
}) {
  return {
    async trigger(channels: string | string[], event: string, data: object, delivery: { signal?: AbortSignal } = {}): Promise<void> {
      const signal = delivery.signal;
      if (signal?.aborted) throw new ArenaDeliveryError(signal.reason === "timeout" ? "timeout" : "cancelled");
      const list = typeof channels === "string" ? [channels] : channels;
      let body: string, url: URL;
      try {
        if (!/^\d+$/.test(options.appId) || !/^[a-z0-9-]+$/.test(options.cluster)
          || !Array.isArray(list) || list.length < 1 || list.length > 100
          || list.some((c) => typeof c !== "string" || !c || c.length > 200
            || /[^A-Za-z0-9_\-=@,.;]/.test(c) || c.startsWith("private-encrypted-"))
          || typeof event !== "string" || event.length > 200) throw new Error();
        const base = options.endpoint ?? new URL(`https://api-${options.cluster}.pusher.com`);
        if (base.username || base.password || (base.protocol !== "https:" && !(base.protocol === "http:"
          && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)))) throw new Error();
        const path = `/apps/${options.appId}/events`;
        body = JSON.stringify({ name: event, data: JSON.stringify(data), channels: list });
        const query = options.signer.createSignedQueryString({ method: "POST", path, body });
        url = new URL(path, base); url.search = query;
      } catch { throw new ArenaDeliveryError("invalid"); }
      const timeoutMs = Math.min(ARENA_PUSHER_REQUEST_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? ARENA_PUSHER_REQUEST_TIMEOUT_MS));
      await new Promise<void>((resolve, reject) => {
        let failure: ArenaDeliveryError | undefined;
        let response: IncomingMessage | undefined;
        let complete = false;
        const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
          method: "POST", agent: false,
          headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "close" },
        });
        const abort = (code: ArenaDeliveryFailure) => {
          failure ??= new ArenaDeliveryError(code);
          response?.destroy();
          request.destroy(failure); // Cancels DNS/connect/TLS/request/response, not just the awaiting promise.
        };
        const cancel = () => abort(signal?.reason === "timeout" ? "timeout" : "cancelled");
        const timer = setTimeout(() => abort("timeout"), timeoutMs);
        timer.unref();
        signal?.addEventListener("abort", cancel, { once: true });
        request.once("response", (incoming) => {
          response = incoming;
          incoming.on("error", () => abort("network"));
          incoming.once("aborted", () => abort("network"));
          if (!incoming.statusCode || incoming.statusCode < 200 || incoming.statusCode >= 300) {
            abort("rejected"); return; // No redirects and no provider-response content in errors.
          }
          incoming.once("end", () => { complete = true; });
          incoming.resume(); // Consume/discard the response under the same deadline.
        });
        request.once("error", () => { failure ??= new ArenaDeliveryError("network"); });
        request.once("close", () => {
          clearTimeout(timer); signal?.removeEventListener("abort", cancel);
          // Settle after request/socket closure so shutdown actually drains transport.
          if (failure || !complete) reject(failure ?? new ArenaDeliveryError("network"));
          else resolve();
        });
        if (signal?.aborted) cancel();
        else request.end(body);
      });
    },
  };
}
