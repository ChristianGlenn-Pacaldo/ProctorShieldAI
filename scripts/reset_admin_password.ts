import "dotenv/config";
import prisma from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";

async function main() {
  const adminPassword = await hashPassword("admin123");
  const adminEmail = process.env.ADMIN_EMAIL || "admin@proctorshield.ai";

  const adminUser = await prisma.user.findFirst({
    where: { role: { roleName: "admin" } }
  });

  if (adminUser) {
    await prisma.user.update({
      where: { id: adminUser.id },
      data: { password: adminPassword, email: adminEmail }
    });
    console.log(`Admin password reset to admin123 for ${adminEmail}`);
  } else {
    console.log("Admin user not found. Run npx prisma db seed");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
