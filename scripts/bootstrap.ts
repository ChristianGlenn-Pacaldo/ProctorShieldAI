import "dotenv/config";
import bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  if (!adminEmail || adminPassword.length < 14 || !/[A-Za-z]/.test(adminPassword) || !/\d/.test(adminPassword)) {
    throw new Error("ADMIN_EMAIL and an ADMIN_PASSWORD of at least 14 characters containing letters and numbers are required");
  }

  const roles = await Promise.all([
    prisma.role.upsert({ where: { roleName: "student" }, update: {}, create: { roleName: "student", description: "Student account" } }),
    prisma.role.upsert({ where: { roleName: "teacher" }, update: {}, create: { roleName: "teacher", description: "Teacher account" } }),
    prisma.role.upsert({ where: { roleName: "admin" }, update: {}, create: { roleName: "admin", description: "System administrator" } }),
  ]);
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail }, include: { role: true } });
  if (existingAdmin && existingAdmin.role.roleName !== "admin") {
    throw new Error("ADMIN_EMAIL already belongs to a non-admin account; choose a different address");
  }
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { password: passwordHash, roleId: roles[2].id, status: "active" },
    create: { fullName: "System Admin", email: adminEmail, password: passwordHash, roleId: roles[2].id, status: "active" },
  });

  await Promise.all([
    prisma.subscriptionPlan.upsert({
      where: { id: 1 },
      update: { planName: "Free", yearlyPrice: 0, durationDays: null, features: "5 lifetime manual quizzes, Up to 20 students per quiz, Basic proctoring, Email support" },
      create: { id: 1, planName: "Free", yearlyPrice: 0, durationDays: null, features: "5 lifetime manual quizzes, Up to 20 students per quiz, Basic proctoring, Email support" },
    }),
    prisma.subscriptionPlan.upsert({
      where: { id: 2 },
      update: { planName: "Premium Monthly", yearlyPrice: 500, durationDays: 30, features: "Unlimited quizzes, Up to 100 students per quiz, AI analysis, live monitoring, evidence replay, and priority support" },
      create: { id: 2, planName: "Premium Monthly", yearlyPrice: 500, durationDays: 30, features: "Unlimited quizzes, Up to 100 students per quiz, AI analysis, live monitoring, evidence replay, and priority support" },
    }),
  ]);

  const settings = [
    ["system_name", "Proctor Shield AI"],
    ["allow_instructor_registration", "true"],
    ["strict_ai_enforcement", "false"],
    ["max_violations_before_lock", "5"],
    ["evidence_retention_days", "90"],
    ["webhook_retention_days", "365"],
  ] as const;
  await Promise.all(settings.map(([settingKey, settingValue]) => prisma.setting.upsert({
    where: { settingKey },
    update: { settingValue },
    create: { settingKey, settingValue },
  })));
  console.log(`Production bootstrap complete. Administrator: ${adminEmail}`);
}

main()
  .catch((error) => {
    console.error("Bootstrap failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
