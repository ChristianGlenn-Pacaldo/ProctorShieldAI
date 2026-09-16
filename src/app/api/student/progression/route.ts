import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getStudentProgression } from "@/lib/student-progression";
import { ensureStudentGameProfile } from "@/lib/student-game-profile";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const progression = await getStudentProgression(session.userId);

    const profile = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`student-game-profile:${session.userId}`}))`;
      return ensureStudentGameProfile(tx, session.userId);
    });

    return NextResponse.json({
      success: true,
      ...progression,
      equippedAvatar: profile.equippedAvatar || "shield",
    });
  } catch (error) {
    console.error("Failed to load student progression:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
