import "dotenv/config";
import prisma from "../src/lib/prisma";

async function main() {
  console.log("🧹 Starting database cleanup...");

  // Keep admin user, Roles, SubscriptionPlans, and Settings
  const adminRole = await prisma.role.findFirst({
    where: { roleName: "admin" },
  });

  if (!adminRole) {
    console.error("❌ Admin role not found. Aborting to prevent locking out admin.");
    return;
  }

  // 1. Delete dependent tables
  console.log("Deleting ActivityLogs...");
  await prisma.activityLog.deleteMany({});

  console.log("Deleting Notifications...");
  await prisma.notification.deleteMany({});

  console.log("Deleting AiAnalysis...");
  await prisma.aiAnalysis.deleteMany({});

  console.log("Deleting Violations...");
  await prisma.violation.deleteMany({});

  console.log("Deleting Choices...");
  await prisma.choice.deleteMany({});

  console.log("Deleting Questions...");
  await prisma.question.deleteMany({});

  console.log("Deleting StudentQuizzes...");
  await prisma.studentQuiz.deleteMany({});

  console.log("Deleting Quizzes...");
  await prisma.quiz.deleteMany({});

  console.log("Deleting Subjects...");
  await prisma.subject.deleteMany({});

  console.log("Deleting Payments...");
  await prisma.payment.deleteMany({});

  console.log("Deleting UserSubscriptions...");
  await prisma.userSubscription.deleteMany({});
  
  console.log("Deleting OtpCodes...");
  await prisma.otpCode.deleteMany({});

  // 2. Delete all users except Admin
  console.log("Deleting Users (except admin)...");
  await prisma.user.deleteMany({
    where: {
      roleId: {
        not: adminRole.id,
      },
    },
  });

  console.log("✅ Database cleanup complete! Only Admin, Roles, Plans, and Settings remain.");
}

main()
  .catch((e) => {
    console.error("❌ Cleanup failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
