import "dotenv/config";
import { GET } from "./src/app/api/dashboard/teacher/evidence/route";

// We need to mock NextRequest and getSession
// Instead, let's just run the prisma query directly here to see if it throws!

import prisma from "./src/lib/prisma";

async function test() {
  const teacherId = "some-id"; // We don't care, we just want to see if the query crashes

  try {
    const violations = await prisma.violation.findMany({
      include: {
        studentExam: {
          include: {
            student: { select: { fullName: true } },
            exam: { select: { title: true } },
          },
        },
      },
      orderBy: { timestamp: "desc" },
    });

    const formattedEvidence = violations.map((v) => {
      const typeMapping: Record<string, string> = {
        tab_switch: "Tab Switch",
      };

      const displayType = typeMapping[v.violationType || ""] || "Violation";
      
      const dateObj = new Date(v.timestamp);
      const formattedTime = dateObj.toLocaleTimeString([], { 
        hour: "2-digit", 
        minute: "2-digit", 
        second: "2-digit", 
        hour12: false 
      });

      return {
        id: v.id.toString(),
        name: v.studentExam.student.fullName,
        examTitle: v.studentExam.exam.title,
        event: `${displayType} · ${formattedTime}`,
        violationType: v.violationType,
        timestamp: v.timestamp,
        screenshotPath: v.screenshotPath || null,
      };
    });

    console.log("Success!", formattedEvidence.length);
  } catch (err) {
    console.error("Crash!", err);
  }
}

test()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
