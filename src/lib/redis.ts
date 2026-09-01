import Redis from "ioredis";

const globalRedis = globalThis as typeof globalThis & {
  __proctorShieldRedis?: Redis;
};

export function getRedis(): Redis | null {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return null;

  if (!globalRedis.__proctorShieldRedis) {
    const client = new Redis(redisUrl, {
      connectTimeout: 5_000,
      maxRetriesPerRequest: 2,
      retryStrategy(times) {
        return Math.min(times * 100, 2_000);
      },
    });
    client.on("error", (error) => {
      console.error("Redis connection error:", error.message);
    });
    globalRedis.__proctorShieldRedis = client;
  }

  return globalRedis.__proctorShieldRedis;
}
