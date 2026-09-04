import "dotenv/config";
import prisma from "../src/lib/prisma";
import { getRedis } from "../src/lib/redis.ts";
import { checkEvidenceStorage } from "../src/lib/evidence-storage";

function requireValue(name: string, minimumLength = 1) {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimumLength) {
    throw new Error(`${name} is required${minimumLength > 1 ? ` and must contain at least ${minimumLength} characters` : ""}`);
  }
  return value;
}

async function withTimeout<T>(label: string, operation: Promise<T>, timeoutMs = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000} seconds`)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function countDuplicateGroups(table: "student_quizzes" | "answers" | "user_subscriptions") {
  if (table === "student_quizzes") {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT student_id, quiz_id, attempt_number FROM student_quizzes
        GROUP BY student_id, quiz_id, attempt_number HAVING COUNT(*) > 1
      ) duplicates`;
    return Number(rows[0]?.count ?? 0);
  }
  if (table === "answers") {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT student_quiz_id, question_id FROM answers GROUP BY student_quiz_id, question_id HAVING COUNT(*) > 1
      ) duplicates`;
    return Number(rows[0]?.count ?? 0);
  }
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT user_id, plan_id FROM user_subscriptions GROUP BY user_id, plan_id HAVING COUNT(*) > 1
    ) duplicates`;
  return Number(rows[0]?.count ?? 0);
}

async function main() {
  requireValue("DATABASE_URL");
  requireValue("NEXTAUTH_SECRET", 32);
  requireValue("CRON_SECRET", 32);
  requireValue("GEMINI_API_KEY");
  requireValue("NEXT_PUBLIC_GOOGLE_CLIENT_ID");
  requireValue("PUSHER_APP_ID");
  requireValue("NEXT_PUBLIC_PUSHER_KEY");
  requireValue("PUSHER_SECRET");
  requireValue("SMTP_EMAIL");
  requireValue("SMTP_PASSWORD");
  requireValue("PAYMONGO_SECRET_KEY");
  requireValue("PAYMONGO_WEBHOOK_SECRET");
  requireValue("REDIS_URL");
  requireValue("S3_ENDPOINT");
  requireValue("S3_BUCKET");
  requireValue("S3_ACCESS_KEY");
  requireValue("S3_SECRET_KEY", 16);
  const appUrl = new URL(requireValue("NEXT_PUBLIC_APP_URL"));
  if (appUrl.protocol !== "https:") throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS");

  console.log("Checking database connectivity...");
  await withTimeout("Database readiness check", prisma.$queryRaw`SELECT 1`);

  console.log("Checking Redis connectivity...");
  const redis = getRedis();
  if (!redis || await withTimeout("Redis readiness check", redis.ping()) !== "PONG") {
    throw new Error("Redis readiness check failed");
  }

  console.log("Checking evidence storage...");
  if (!await withTimeout("Evidence storage readiness check", checkEvidenceStorage())) {
    throw new Error("Evidence storage readiness check failed");
  }

  console.log("Checking database uniqueness constraints...");
  const duplicates = {
    enrollments: await withTimeout("Student-attempt duplicate check", countDuplicateGroups("student_quizzes")),
    answers: await withTimeout("Answer duplicate check", countDuplicateGroups("answers")),
    subscriptions: await withTimeout("Subscription duplicate check", countDuplicateGroups("user_subscriptions")),
  };
  if (Object.values(duplicates).some((count) => count > 0)) {
    throw new Error(`Duplicate rows must be resolved before schema application: ${JSON.stringify(duplicates)}`);
  }

  console.log("Production preflight passed.");
}

main()
  .catch((error) => {
    console.error("Production preflight failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
