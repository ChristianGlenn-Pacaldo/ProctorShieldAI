import "dotenv/config";
import prisma from "../src/lib/prisma";

type CountRow = { count: bigint };

async function count(query: TemplateStringsArray) {
  const rows = await prisma.$queryRaw<CountRow[]>(query);
  return Number(rows[0]?.count ?? 0);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const paymentColumn = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'provider_payment_id'
    ) AS exists`;
  const hasProviderPaymentId = paymentColumn[0]?.exists === true;

  const [enrollmentDuplicates, answerDuplicates, subscriptionDuplicates, paymentProviderDuplicates] = await Promise.all([
    count`SELECT COUNT(*)::bigint AS count FROM (
      SELECT student_id, quiz_id FROM student_quizzes GROUP BY student_id, quiz_id HAVING COUNT(*) > 1
    ) duplicate_groups`,
    count`SELECT COUNT(*)::bigint AS count FROM (
      SELECT student_quiz_id, question_id FROM answers GROUP BY student_quiz_id, question_id HAVING COUNT(*) > 1
    ) duplicate_groups`,
    count`SELECT COUNT(*)::bigint AS count FROM (
      SELECT user_id, plan_id FROM user_subscriptions GROUP BY user_id, plan_id HAVING COUNT(*) > 1
    ) duplicate_groups`,
    hasProviderPaymentId
      ? count`SELECT COUNT(*)::bigint AS count FROM (
          SELECT provider_payment_id FROM payments
          WHERE provider_payment_id IS NOT NULL
          GROUP BY provider_payment_id HAVING COUNT(*) > 1
        ) duplicate_groups`
      : Promise.resolve(0),
  ]);

  const duplicateGroups = {
    studentQuiz: enrollmentDuplicates,
    answer: answerDuplicates,
    subscription: subscriptionDuplicates,
    providerPayment: paymentProviderDuplicates,
  };
  if (Object.values(duplicateGroups).some((value) => value > 0)) {
    throw new Error(`Duplicate groups must be resolved before migration: ${JSON.stringify(duplicateGroups)}`);
  }

  console.log(`Migration readiness passed: ${JSON.stringify(duplicateGroups)}`);
}

main()
  .catch((error) => {
    console.error("Migration readiness failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
