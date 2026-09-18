import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession, setSessionCookie } from "@/lib/auth";

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fullName } = await req.json();

    if (typeof fullName !== "string" || fullName.trim().length < 2 || fullName.length > 150) {
      return NextResponse.json({ error: "Invalid name format" }, { status: 400 });
    }

    const uppercaseName = fullName.trim();

    // Update database
    await prisma.user.update({
      where: { id: session.userId },
      data: { fullName: uppercaseName },
    });

    // Update session token so the dashboard instantly reflects it
    await setSessionCookie({
      userId: session.userId,
      email: session.email,
      role: session.role,
      fullName: uppercaseName,
    });

    return NextResponse.json({ success: true, fullName: uppercaseName });
  } catch (error: any) {
    console.error("Update profile error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
