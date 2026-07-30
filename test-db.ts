import "dotenv/config";
import prisma from "./src/lib/prisma";

async function main() {
  const users = await prisma.user.findMany({ include: { role: true } });
  console.log("Users:", users.map(u => ({ id: u.id, email: u.email, role: u.role?.roleName })));

  const plans = await prisma.subscriptionPlan.findMany();
  console.log("Plans:", plans);
}

main().finally(() => process.exit(0));
