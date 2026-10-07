import { NextRequest, NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { InvalidReportQuery, readAIReports } from "@/lib/ai-reports";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  try {
    const session = await getUserSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers });
    }
    return NextResponse.json(await readAIReports("student", session.userId, req.url), { headers });
  } catch (error) {
    if (error instanceof InvalidReportQuery) return NextResponse.json({ success: false, error: error.message }, { status: 400, headers });
    console.error("Fetch AI reports failed");
    return NextResponse.json({ success: false, error: "Unable to load AI reports" }, { status: 500, headers });
  }
}
