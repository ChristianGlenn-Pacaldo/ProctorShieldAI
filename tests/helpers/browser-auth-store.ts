import { randomUUID } from "node:crypto";

// Model the production scripts' absolute expiry and atomic single-key contract.
export function browserAuthStore() {
  const values = new Map<string, string>();
  const expires = new Map<string, number>();
  let unavailable = false;
  function expire(key: string) {
    if ((expires.get(key) ?? 0) <= Date.now()) { values.delete(key); expires.delete(key); }
  }
  const client = {
    status: "ready",
    eval: async (script: string, count: number, key: string, ...args: string[]) => {
      if (unavailable) throw new Error("Injected Redis outage");
      if (count !== 1) throw new Error("Unexpected key count");
      expire(key);
      const current = values.get(key);
      if (script.startsWith("-- browser-auth:read")) return current ?? null;
      if (script.startsWith("-- browser-auth:ensure")) {
        if (!current) { values.set(key, args[0]); expires.set(key, Number(args[1])); }
        expire(key);
        return values.get(key) ?? null;
      }
      if (script.startsWith("-- browser-auth:advance")) {
        if (current !== args[0] || (expires.get(key) ?? 0) <= Date.now()) return 0;
        values.set(key, args[1]); return 1; // SET PX remaining preserves deadline.
      }
      throw new Error("Unexpected Redis script");
    },
  };
  return { values, expires, client, ttl: (key: string) => { expire(key); return expires.has(key) ? expires.get(key)! - Date.now() : -2; },
    seed: (browserId: string, lifetime = 30 * 86400) => {
      const key = "proctorshield:browser-auth:" + browserId;
      expire(key);
      if (!values.has(key)) {
        const deadline = Math.floor(Date.now() / 1000) + lifetime;
        values.set(key, randomUUID() + "|" + deadline); expires.set(key, deadline * 1000);
      }
      return values.get(key)!.split("|")[0];
    },
    fail: () => { unavailable = true; }, recover: () => { unavailable = false; },
    module: { getRedis: () => client, isRedisReady: () => client.status === "ready" } };
}
