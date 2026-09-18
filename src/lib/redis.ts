import Redis, { type RedisOptions } from "ioredis";

const globalRedis = globalThis as typeof globalThis & {
  __proctorShieldRedis?: Redis;
  __proctorShieldRedisLoggedError?: { message: string; timestamp: number };
  __proctorShieldRedisWasConnected?: boolean;
};

function sanitizeErrorMessage(msg: string): string {
  return msg.replace(/:[^:@]+@/, ":****@");
}

export function isRedisReady(client: Redis | null): client is Redis {
  return Boolean(client && client.status === "ready");
}

export function getRedis(): Redis | null {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl || redisUrl === "none" || redisUrl === "disabled" || redisUrl === "false") {
    return null;
  }

  if (!globalRedis.__proctorShieldRedis) {
    try {
      const options: RedisOptions = {
        connectTimeout: 1_000,
        commandTimeout: 1_000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false, // Prevents queuing/hanging commands when Redis is offline; triggers immediate memory fallback
        lazyConnect: false,
        retryStrategy(times) {
          // Bounded reconnect backoff: avoid CPU spin / continuous connection storm when Redis is down
          if (times > 5) {
            return 15_000; // After initial quick retries, back off to 15s interval
          }
          return Math.min(times * 1_000, 5_000);
        },
      };

      const client = new Redis(redisUrl, options);

      client.on("connect", () => {
        if (!globalRedis.__proctorShieldRedisWasConnected) {
          console.log("[Redis] Connected to shared cache instance.");
          globalRedis.__proctorShieldRedisWasConnected = true;
          globalRedis.__proctorShieldRedisLoggedError = undefined;
        }
      });

      client.on("error", (error) => {
        globalRedis.__proctorShieldRedisWasConnected = false;
        const now = Date.now();
        const sanitized = sanitizeErrorMessage(error.message || "Unknown error");
        const lastLog = globalRedis.__proctorShieldRedisLoggedError;

        // Throttle repeated identical connection error logs to once every 60s
        if (!lastLog || lastLog.message !== sanitized || now - lastLog.timestamp > 60_000) {
          console.warn(`[Redis] Cache offline (${sanitized}) — using in-memory fallback.`);
          globalRedis.__proctorShieldRedisLoggedError = { message: sanitized, timestamp: now };
        }
      });

      globalRedis.__proctorShieldRedis = client;
    } catch (err) {
      console.warn("[Redis] Initialization failed, using in-memory fallback:", err);
      return null;
    }
  }

  return globalRedis.__proctorShieldRedis;
}
