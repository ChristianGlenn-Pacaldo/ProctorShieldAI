import "dotenv/config";
import prisma from "../src/lib/prisma";
import { runMaintenance } from "../src/lib/maintenance";

async function main() {
  const result = await runMaintenance();
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error("Maintenance failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
