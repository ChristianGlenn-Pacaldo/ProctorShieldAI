import "dotenv/config";
import prisma from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const rawPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !rawPassword || rawPassword.length < 14) {
    throw new Error("ADMIN_EMAIL and an ADMIN_PASSWORD of at least 14 characters are required");
  }

  const adminUser = await prisma.user.findFirst({
    where: { role: { roleName: "admin" } },
  });
  if (!adminUser) throw new Error("Admin user not found. Run the database seed first.");

  await prisma.user.update({
    where: { id: adminUser.id },
    data: { password: await hashPassword(rawPassword), email: adminEmail },
  });
  console.log(`Admin credentials updated for ${adminEmail}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
