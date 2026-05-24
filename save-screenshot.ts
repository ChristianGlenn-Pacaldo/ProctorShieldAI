import "dotenv/config";
import fs from "fs";
import prisma from "./src/lib/prisma";

async function save() {
  const v = await prisma.violation.findFirst({
    where: { screenshotPath: { not: null } }
  });
  if (v && v.screenshotPath) {
    const base64Data = v.screenshotPath.replace(/^data:image\/jpeg;base64,/, "");
    fs.writeFileSync("test-screenshot.jpg", base64Data, 'base64');
    console.log("Saved test-screenshot.jpg");
  } else {
    console.log("No screenshot found");
  }
}

save()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
