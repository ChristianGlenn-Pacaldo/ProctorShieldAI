import "server-only";

type Signer = { createSignedQueryString(options: { method: string; path: string; body: string }): string };

// Logout delivery is noncritical, but must finish even if a provider accepts
// headers and then stalls its response body. Abort destroys the actual fetch.
export function createLogoutDelivery(options: {
  appId: string; cluster: string; signer: Signer; fetcher?: typeof fetch;
}) {
  return async (payload: Record<string, unknown>) => {
    if (!/^\d+$/.test(options.appId) || !/^[a-z0-9-]+$/.test(options.cluster)) {
      throw new Error("Logout realtime unavailable");
    }
    const path = `/apps/${options.appId}/events`;
    const body = JSON.stringify({ name: "activity", channels: ["private-admin-dashboard"], data: JSON.stringify(payload) });
    const query = options.signer.createSignedQueryString({ method: "POST", path, body });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    timer.unref();
    try {
      const response = await (options.fetcher ?? fetch)(`https://api-${options.cluster}.pusher.com${path}?${query}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
        signal: controller.signal, redirect: "error",
      });
      // Discard provider bodies; neither payloads nor signed URLs enter logs.
      await response.body?.cancel();
      if (!response.ok) throw new Error("Logout realtime unavailable");
    } catch {
      throw new Error("Logout realtime unavailable");
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function sendLogoutActivity(payload: Record<string, unknown>) {
  const { pusherServer } = await import("@/lib/pusher");
  await createLogoutDelivery({
    appId: process.env.PUSHER_APP_ID ?? "", cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "", signer: pusherServer,
  })(payload);
}
