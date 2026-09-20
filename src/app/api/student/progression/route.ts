import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStudentProgression } from "@/lib/student-progression";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const progression = await getStudentProgression(session.userId);

    return NextResponse.json({
      success: true,
      ...progression,
    });
  } catch (error) {
    console.error("Failed to load student progression:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
