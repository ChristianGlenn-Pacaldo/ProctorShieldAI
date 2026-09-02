import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { expireSubscriptions } from "@/lib/maintenance";
import { getTeacherEntitlements } from "@/lib/teacher-entitlements";

// GET: Lightweight subscription status check (used by gating modals)
export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "teacher") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await expireSubscriptions(session.userId);
    const entitlements = await getTeacherEntitlements(session.userId);

    return NextResponse.json(entitlements);
  } catch (error) {
    console.error("Billing status error:", error);
    return NextResponse.json({ error: "Failed to load subscription status" }, { status: 500 });
  }
}
