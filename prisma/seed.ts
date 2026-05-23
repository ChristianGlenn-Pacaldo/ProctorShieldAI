import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

async function main() {
  console.log("🌱 Seeding ProctorShield AI database...\n");

  // ── 1. ROLES ──────────────────────────────────────────
  console.log("📋 Creating roles...");
  const roles = await Promise.all([
    prisma.role.upsert({
      where: { roleName: "student" },
      update: {},
      create: { roleName: "student", description: "Student account — can take exams and view results" },
    }),
    prisma.role.upsert({
      where: { roleName: "teacher" },
      update: {},
      create: { roleName: "teacher", description: "Teacher account — can create exams and monitor students" },
    }),
    prisma.role.upsert({
      where: { roleName: "admin" },
      update: {},
      create: { roleName: "admin", description: "System administrator — full platform access" },
    }),
  ]);
  console.log(`   ✓ ${roles.length} roles created\n`);

  // ── 2. USERS ──────────────────────────────────────────
  console.log("👥 Creating demo users...");

  const studentPassword = await hashPassword("student123");
  const teacherPassword = await hashPassword("teacher123");
  const adminPassword = await hashPassword("admin123");

  const studentRole = roles[0];
  const teacherRole = roles[1];
  const adminRole = roles[2];

  const student1 = await prisma.user.upsert({
    where: { email: "student@demo.com" },
    update: {},
    create: {
      fullName: "Juan Dela Cruz",
      email: "student@demo.com",
      password: studentPassword,
      roleId: studentRole.id,
      status: "active",
    },
  });

  const student2 = await prisma.user.upsert({
    where: { email: "maria@demo.com" },
    update: {},
    create: {
      fullName: "Maria Santos",
      email: "maria@demo.com",
      password: studentPassword,
      roleId: studentRole.id,
      status: "active",
    },
  });

  const student3 = await prisma.user.upsert({
    where: { email: "ethan@demo.com" },
    update: {},
    create: {
      fullName: "Ethan Reyes",
      email: "ethan@demo.com",
      password: studentPassword,
      roleId: studentRole.id,
      status: "suspended",
    },
  });

  const student4 = await prisma.user.upsert({
    where: { email: "carlo@demo.com" },
    update: {},
    create: {
      fullName: "Carlo Mendoza",
      email: "carlo@demo.com",
      password: studentPassword,
      roleId: studentRole.id,
      status: "active",
    },
  });

  const teacher1 = await prisma.user.upsert({
    where: { email: "teacher@demo.com" },
    update: {},
    create: {
      fullName: "Sir Ramos",
      email: "teacher@demo.com",
      password: teacherPassword,
      roleId: teacherRole.id,
      status: "active",
    },
  });

  const teacher2 = await prisma.user.upsert({
    where: { email: "ana@demo.com" },
    update: {},
    create: {
      fullName: "Prof. Ana Lim",
      email: "ana@demo.com",
      password: teacherPassword,
      roleId: teacherRole.id,
      status: "active",
    },
  });

  const admin1 = await prisma.user.upsert({
    where: { email: "admin@proctorshield.ai" },
    update: {},
    create: {
      fullName: "System Admin",
      email: "admin@proctorshield.ai",
      password: adminPassword,
      roleId: adminRole.id,
      status: "active",
    },
  });

  console.log("   ✓ Juan Dela Cruz (student@demo.com / student123)");
  console.log("   ✓ Maria Santos (maria@demo.com / student123)");
  console.log("   ✓ Ethan Reyes (ethan@demo.com / student123) [SUSPENDED]");
  console.log("   ✓ Carlo Mendoza (carlo@demo.com / student123)");
  console.log("   ✓ Sir Ramos (teacher@demo.com / teacher123)");
  console.log("   ✓ Prof. Ana Lim (ana@demo.com / teacher123)");
  console.log("   ✓ System Admin (admin@proctorshield.ai / admin123)\n");

  // ── 3. SUBJECTS ───────────────────────────────────────
  console.log("📚 Creating subjects...");

  const cs101 = await prisma.subject.upsert({
    where: { subjectCode: "CS101" },
    update: {},
    create: {
      teacherId: teacher1.id,
      subjectName: "Intro to Computing",
      subjectCode: "CS101",
      description: "Fundamentals of computer science and programming",
    },
  });

  const math201 = await prisma.subject.upsert({
    where: { subjectCode: "MATH201" },
    update: {},
    create: {
      teacherId: teacher2.id,
      subjectName: "Calculus II",
      subjectCode: "MATH201",
      description: "Advanced calculus and mathematical analysis",
    },
  });

  const eng102 = await prisma.subject.upsert({
    where: { subjectCode: "ENG102" },
    update: {},
    create: {
      teacherId: teacher1.id,
      subjectName: "Technical Writing",
      subjectCode: "ENG102",
      description: "Professional communication and documentation skills",
    },
  });

  console.log(`   ✓ ${cs101.subjectCode} — ${cs101.subjectName}`);
  console.log(`   ✓ ${math201.subjectCode} — ${math201.subjectName}`);
  console.log(`   ✓ ${eng102.subjectCode} — ${eng102.subjectName}\n`);

  // ── 4. EXAMS ──────────────────────────────────────────
  console.log("📝 Creating exams...");

  const exam1 = await prisma.exam.upsert({
    where: { accessCode: "PS-8821" },
    update: {},
    create: {
      subjectId: cs101.id,
      teacherId: teacher1.id,
      title: "CS101 Midterm",
      description: "Midterm examination covering Chapters 1-6",
      accessCode: "PS-8821",
      isAiGenerated: false,
      examType: "midterm",
      duration: 90,
      totalQuestions: 50,
      passingScore: 60,
      shuffleQuestions: true,
      allowRetake: false,
      examStatus: "active",
    },
  });

  const exam2 = await prisma.exam.upsert({
    where: { accessCode: "PS-7412" },
    update: {},
    create: {
      subjectId: cs101.id,
      teacherId: teacher1.id,
      title: "CS101 Quiz 2",
      description: "Weekly quiz on arrays and loops",
      accessCode: "PS-7412",
      isAiGenerated: false,
      examType: "quiz",
      duration: 60,
      totalQuestions: 50,
      passingScore: 50,
      shuffleQuestions: true,
      allowRetake: false,
      examStatus: "completed",
    },
  });

  const exam3 = await prisma.exam.upsert({
    where: { accessCode: "PS-3047" },
    update: {},
    create: {
      subjectId: eng102.id,
      teacherId: teacher1.id,
      title: "ENG102 Finals",
      description: "Final examination for Technical Writing",
      accessCode: "PS-3047",
      isAiGenerated: false,
      examType: "final",
      duration: 120,
      totalQuestions: 80,
      passingScore: 60,
      shuffleQuestions: false,
      allowRetake: false,
      examStatus: "draft",
    },
  });

  const exam4 = await prisma.exam.upsert({
    where: { accessCode: "PS-5519" },
    update: {},
    create: {
      subjectId: math201.id,
      teacherId: teacher2.id,
      title: "MATH201 Quiz 3",
      description: "Integration and differentiation quiz",
      accessCode: "PS-5519",
      isAiGenerated: false,
      examType: "quiz",
      duration: 45,
      totalQuestions: 30,
      passingScore: 50,
      shuffleQuestions: true,
      allowRetake: false,
      examStatus: "draft",
    },
  });

  console.log(`   ✓ ${exam1.title} [${exam1.accessCode}] — ${exam1.examStatus}`);
  console.log(`   ✓ ${exam2.title} [${exam2.accessCode}] — ${exam2.examStatus}`);
  console.log(`   ✓ ${exam3.title} [${exam3.accessCode}] — ${exam3.examStatus}`);
  console.log(`   ✓ ${exam4.title} [${exam4.accessCode}] — ${exam4.examStatus}\n`);

  // ── 5. SAMPLE QUESTIONS ───────────────────────────────
  console.log("❓ Creating sample questions for CS101 Quiz 2...");

  const q1 = await prisma.question.create({
    data: {
      examId: exam2.id,
      questionText: "What is the correct syntax for a for loop in JavaScript?",
      questionType: "multiple_choice",
      points: 2,
    },
  });

  await prisma.choice.createMany({
    data: [
      { questionId: q1.id, choiceText: "for (i = 0; i < 10; i++)", isCorrect: false },
      { questionId: q1.id, choiceText: "for (let i = 0; i < 10; i++)", isCorrect: true },
      { questionId: q1.id, choiceText: "for i in range(10)", isCorrect: false },
      { questionId: q1.id, choiceText: "loop (i < 10)", isCorrect: false },
    ],
  });

  const q2 = await prisma.question.create({
    data: {
      examId: exam2.id,
      questionText: "Which of the following is NOT a valid data type in JavaScript?",
      questionType: "multiple_choice",
      points: 2,
    },
  });

  await prisma.choice.createMany({
    data: [
      { questionId: q2.id, choiceText: "string", isCorrect: false },
      { questionId: q2.id, choiceText: "boolean", isCorrect: false },
      { questionId: q2.id, choiceText: "integer", isCorrect: true },
      { questionId: q2.id, choiceText: "undefined", isCorrect: false },
    ],
  });

  const q3 = await prisma.question.create({
    data: {
      examId: exam2.id,
      questionText: "What does 'DOM' stand for?",
      questionType: "multiple_choice",
      points: 2,
    },
  });

  await prisma.choice.createMany({
    data: [
      { questionId: q3.id, choiceText: "Document Object Model", isCorrect: true },
      { questionId: q3.id, choiceText: "Data Output Manager", isCorrect: false },
      { questionId: q3.id, choiceText: "Digital Oriented Machine", isCorrect: false },
      { questionId: q3.id, choiceText: "Display Object Method", isCorrect: false },
    ],
  });

  console.log("   ✓ 3 questions with 12 choices created\n");

  // ── 6. STUDENT EXAMS (Past Submissions) ───────────────
  console.log("📊 Creating student exam submissions...");

  const se1 = await prisma.studentExam.create({
    data: {
      studentId: student1.id,
      examId: exam2.id,
      startTime: new Date("2025-05-05T14:00:00"),
      endTime: new Date("2025-05-05T14:45:00"),
      score: 92,
      remarks: "Excellent performance",
      aiVerdict: "clean",
      cheatingProbability: 3,
      examStatus: "completed",
    },
  });

  const se2 = await prisma.studentExam.create({
    data: {
      studentId: student2.id,
      examId: exam2.id,
      startTime: new Date("2025-05-05T14:00:00"),
      endTime: new Date("2025-05-05T14:50:00"),
      score: 85,
      remarks: "Good performance",
      aiVerdict: "clean",
      cheatingProbability: 8,
      examStatus: "completed",
    },
  });

  const se3 = await prisma.studentExam.create({
    data: {
      studentId: student3.id,
      examId: exam2.id,
      startTime: new Date("2025-05-05T14:00:00"),
      endTime: new Date("2025-05-05T14:42:00"),
      score: 89,
      remarks: "Multiple violations detected",
      aiVerdict: "cheated",
      cheatingProbability: 92,
      examStatus: "completed",
    },
  });

  const se4 = await prisma.studentExam.create({
    data: {
      studentId: student4.id,
      examId: exam2.id,
      startTime: new Date("2025-05-05T14:00:00"),
      endTime: new Date("2025-05-05T14:48:00"),
      score: 76,
      remarks: "Some suspicious activity",
      aiVerdict: "suspicious",
      cheatingProbability: 67,
      examStatus: "completed",
    },
  });

  console.log(`   ✓ Juan Dela Cruz — 92% (Clean)`);
  console.log(`   ✓ Maria Santos — 85% (Clean)`);
  console.log(`   ✓ Ethan Reyes — 89% (Cheated - 92%)`);
  console.log(`   ✓ Carlo Mendoza — 76% (Suspicious - 67%)\n`);

  // ── 7. VIOLATIONS ─────────────────────────────────────
  console.log("🚨 Creating violation records...");

  await prisma.violation.createMany({
    data: [
      {
        studentExamId: se3.id,
        violationType: "tab_switch",
        confidenceScore: 98,
        timestamp: new Date("2025-05-05T14:10:23"),
        durationSeconds: 5,
      },
      {
        studentExamId: se3.id,
        violationType: "tab_switch",
        confidenceScore: 97,
        timestamp: new Date("2025-05-05T14:18:45"),
        durationSeconds: 8,
      },
      {
        studentExamId: se3.id,
        violationType: "tab_switch",
        confidenceScore: 99,
        timestamp: new Date("2025-05-05T14:25:11"),
        durationSeconds: 12,
      },
      {
        studentExamId: se3.id,
        violationType: "phone_detected",
        confidenceScore: 94,
        timestamp: new Date("2025-05-05T14:23:45"),
        durationSeconds: 15,
      },
      {
        studentExamId: se4.id,
        violationType: "multiple_faces",
        confidenceScore: 87,
        timestamp: new Date("2025-05-05T14:31:12"),
        durationSeconds: 20,
      },
      {
        studentExamId: se4.id,
        violationType: "multiple_faces",
        confidenceScore: 91,
        timestamp: new Date("2025-05-05T14:35:30"),
        durationSeconds: 10,
      },
    ],
  });

  console.log("   ✓ 6 violations created (3 tab switches, 1 phone, 2 multi-face)\n");

  // ── 8. AI ANALYSIS ────────────────────────────────────
  console.log("🧠 Creating AI analysis records...");

  await prisma.aiAnalysis.createMany({
    data: [
      {
        studentExamId: se1.id,
        totalViolations: 0,
        cheatingProbability: 3,
        riskLevel: "low",
        finalVerdict: "clean",
        aiExplanation: "No anomalies detected during the exam session. Student maintained consistent eye contact with the screen and no suspicious activities were flagged.",
      },
      {
        studentExamId: se2.id,
        totalViolations: 0,
        cheatingProbability: 8,
        riskLevel: "low",
        finalVerdict: "clean",
        aiExplanation: "Exam session completed without significant issues. Minor gaze deviation detected but within acceptable parameters.",
      },
      {
        studentExamId: se3.id,
        totalViolations: 4,
        cheatingProbability: 92,
        riskLevel: "high",
        finalVerdict: "cheated",
        aiExplanation: "High probability of cheating detected. Student switched tabs 3 times during the exam. A phone was detected in the camera frame at 14:23:45 with 94% confidence. Combined violation pattern strongly suggests external assistance was used.",
      },
      {
        studentExamId: se4.id,
        totalViolations: 2,
        cheatingProbability: 67,
        riskLevel: "medium",
        finalVerdict: "suspicious",
        aiExplanation: "Multiple faces were detected in the camera frame on two occasions. This could indicate the presence of another person providing assistance. Manual review by the instructor is recommended.",
      },
    ],
  });

  console.log("   ✓ 4 AI analysis records created\n");

  // ── 9. NOTIFICATIONS ──────────────────────────────────
  console.log("🔔 Creating notifications...");

  await prisma.notification.createMany({
    data: [
      { userId: teacher1.id, title: "High-Risk Alert", message: "Ethan Reyes has been flagged for suspected cheating on CS101 Quiz 2 (92% probability).", isRead: false },
      { userId: teacher1.id, title: "Exam Completed", message: "CS101 Quiz 2 has been completed by all 4 enrolled students.", isRead: true },
      { userId: student3.id, title: "Integrity Report Available", message: "Your AI integrity report for CS101 Quiz 2 is now available for review.", isRead: false },
      { userId: student1.id, title: "New Exam Available", message: "CS101 Midterm is now available. Access code: PS-8821", isRead: false },
      { userId: admin1.id, title: "System Alert", message: "Evidence storage is at 78% capacity. Consider archiving old files.", isRead: false },
    ],
  });

  console.log("   ✓ 5 notifications created\n");

  // ── 10. ACTIVITY LOGS ─────────────────────────────────
  console.log("📜 Creating activity logs...");

  await prisma.activityLog.createMany({
    data: [
      { userId: teacher1.id, activity: "Created exam: CS101 Midterm", ipAddress: "192.168.1.10" },
      { userId: teacher1.id, activity: "Created exam: CS101 Quiz 2", ipAddress: "192.168.1.10" },
      { userId: student1.id, activity: "Completed exam: CS101 Quiz 2", ipAddress: "192.168.1.15" },
      { userId: student3.id, activity: "Flagged for violations: CS101 Quiz 2", ipAddress: "192.168.1.20" },
      { userId: admin1.id, activity: "Suspended user: Ethan Reyes", ipAddress: "10.0.0.1" },
    ],
  });

  console.log("   ✓ 5 activity logs created\n");

  // ── 11. SUBSCRIPTION PLANS ────────────────────────────
  console.log("💎 Creating subscription plans...");

  await prisma.subscriptionPlan.upsert({
    where: { id: 1 },
    update: {},
    create: {
      planName: "Free",
      yearlyPrice: 0,
      features: "5 exams/month, Basic AI proctoring, Email support",
      durationDays: 365,
    },
  });

  await prisma.subscriptionPlan.upsert({
    where: { id: 2 },
    update: {},
    create: {
      planName: "Premium",
      yearlyPrice: 1999,
      features: "Unlimited exams, Full AI analysis, Evidence replay, Priority support, CCTV replay",
      durationDays: 365,
    },
  });

  console.log("   ✓ Free plan (₱0)\n   ✓ Premium plan (₱1,999/yr)\n");

  // ── 12. SETTINGS ──────────────────────────────────────
  console.log("⚙️  Creating system settings...");

  const settings = [
    { settingKey: "system_name", settingValue: "Proctor Shield AI" },
    { settingKey: "allow_instructor_registration", settingValue: "true" },
    { settingKey: "strict_ai_enforcement", settingValue: "false" },
    { settingKey: "max_violations_before_lock", settingValue: "5" },
    { settingKey: "evidence_retention_days", settingValue: "90" },
  ];

  for (const s of settings) {
    await prisma.setting.upsert({
      where: { settingKey: s.settingKey },
      update: {},
      create: s,
    });
  }

  console.log("   ✓ 5 system settings configured\n");

  // ── DONE ──────────────────────────────────────────────
  console.log("═══════════════════════════════════════════");
  console.log("🎉 DATABASE SEEDING COMPLETE!");
  console.log("═══════════════════════════════════════════");
  console.log("\nDemo Credentials:");
  console.log("  Student:  student@demo.com  / student123");
  console.log("  Teacher:  teacher@demo.com  / teacher123");
  console.log("  Admin:    admin@proctorshield.ai / admin123");
  console.log("\nAccess Codes: PS-8821, PS-7412, PS-3047, PS-5519");
  console.log("═══════════════════════════════════════════\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
