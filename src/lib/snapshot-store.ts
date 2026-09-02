import { getRedis } from "./redis.ts";

export type SnapshotRecord = {
  studentId: string;
  snapshot: string;
  studentName: string;
  quizTitle: string;
  quizId: number;
  teacherId: string;
  deviceType: "desktop" | "mobile";
  monitoringLevel: "strict" | "reduced";
  connectionStatus: "online";
  updatedAt: number;
};

const SNAPSHOT_TTL_MS = 2 * 60_000;
const globalSnapshots = globalThis as typeof globalThis & {
  __snapshotStore?: Map<string, SnapshotRecord>;
};
const localSnapshots = globalSnapshots.__snapshotStore ?? new Map<string, SnapshotRecord>();
globalSnapshots.__snapshotStore = localSnapshots;

function snapshotKey(studentId: string) {
  return `proctorshield:snapshot:${studentId}`;
}

function teacherIndexKey(teacherId: string) {
  return `proctorshield:snapshots:teacher:${teacherId}`;
}

export async function saveSnapshot(record: SnapshotRecord): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      const pipeline = redis.pipeline();
      pipeline.set(snapshotKey(record.studentId), JSON.stringify(record), "PX", SNAPSHOT_TTL_MS);
      pipeline.zadd(teacherIndexKey(record.teacherId), record.updatedAt, record.studentId);
      pipeline.pexpire(teacherIndexKey(record.teacherId), SNAPSHOT_TTL_MS);
      await pipeline.exec();
      return;
    } catch (error) {
      console.error("Redis snapshot store unavailable; using local cache:", error);
    }
  }
  localSnapshots.set(record.studentId, record);
}

function getLocalSnapshots(teacherId: string, cutoff: number) {
  const staleCutoff = Date.now() - SNAPSHOT_TTL_MS;
  for (const [studentId, record] of localSnapshots) {
    if (record.updatedAt < staleCutoff) localSnapshots.delete(studentId);
  }
  return Array.from(localSnapshots.values()).filter(
    (record) => record.teacherId === teacherId && record.updatedAt >= cutoff,
  );
}

export async function getSnapshotsForTeacher(teacherId: string): Promise<SnapshotRecord[]> {
  const cutoff = Date.now() - 60_000;
  const redis = getRedis();
  if (!redis) return getLocalSnapshots(teacherId, cutoff);

  try {
    const indexKey = teacherIndexKey(teacherId);
    await redis.zremrangebyscore(indexKey, 0, cutoff - 1);
    const studentIds = await redis.zrangebyscore(indexKey, cutoff, "+inf");
    if (studentIds.length === 0) return [];

    const values = await redis.mget(studentIds.map(snapshotKey));
    const records: SnapshotRecord[] = [];
    for (const value of values) {
      if (!value) continue;
      try {
        const parsed = JSON.parse(value) as SnapshotRecord;
        if (parsed.teacherId === teacherId && parsed.updatedAt >= cutoff) records.push(parsed);
      } catch {
        // Ignore malformed or obsolete cache entries.
      }
    }
    return records;
  } catch (error) {
    console.error("Redis snapshot store unavailable; using local cache:", error);
    return getLocalSnapshots(teacherId, cutoff);
  }
}
