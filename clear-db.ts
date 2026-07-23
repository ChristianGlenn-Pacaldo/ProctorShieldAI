import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.user.deleteMany({});
  console.log("All users deleted successfully!");
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
