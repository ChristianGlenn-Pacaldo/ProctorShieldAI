import "dotenv/config";
import prisma from "./src/lib/prisma";

async function main() {
  const violations = await prisma.violation.findMany({
    take: 5,
    orderBy: { timestamp: 'desc' }
  });
  
  console.log("Violations found:", violations.length);
  violations.forEach(v => {
    console.log(`ID: ${v.id}, Type: ${v.violationType}, HasScreenshot: ${!!v.screenshotPath}, Screenshot Length: ${v.screenshotPath?.length || 0}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
