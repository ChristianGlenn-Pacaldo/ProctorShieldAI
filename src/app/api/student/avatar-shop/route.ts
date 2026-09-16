import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  AVATAR_CATALOG,
} from "@/lib/student-coins";
import { ensureStudentGameProfile } from "@/lib/student-game-profile";

// GET /api/student/avatar-shop — Fetch coin balance, inventory, and catalog
export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const avatarData = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`student-game-profile:${session.userId}`}))`;
      return ensureStudentGameProfile(tx, session.userId);
    });

    return NextResponse.json({
      success: true,
      coins: avatarData.coins,
      equippedAvatar: avatarData.equippedAvatar,
      unlockedAvatars: avatarData.unlockedAvatars,
      topOneWins: avatarData.topOneWins,
      catalog: AVATAR_CATALOG,
    });
  } catch (error) {
    console.error("Failed to load avatar shop:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/student/avatar-shop — Buy or Equip an avatar
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "student") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { action, avatarId, gear } = body;

    // Modular avatar customization save action
    if (action === "save-look") {
      if (!gear || typeof gear !== "object") {
        return NextResponse.json({ error: "gear object is required" }, { status: 400 });
      }

      const serializedGear = JSON.stringify(gear);

      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`student-game-profile:${session.userId}`}))`;
        await ensureStudentGameProfile(tx, session.userId);
        const updated = await tx.studentGameProfile.update({
          where: { studentId: session.userId },
          data: { equippedAvatar: serializedGear },
        });
        return updated;
      });

      return NextResponse.json({
        success: true,
        message: "Avatar customized and equipped successfully!",
        equippedAvatar: serializedGear,
        coins: result.coins,
      });
    }

    if (!avatarId || typeof avatarId !== "string") {
      return NextResponse.json({ error: "avatarId is required" }, { status: 400 });
    }

    const item = AVATAR_CATALOG.find((a) => a.id === avatarId);
    if (!item) {
      return NextResponse.json({ error: "Avatar not found in catalog" }, { status: 404 });
    }

    const validActions = ["buy", "equip", "select", "use"];
    if (!validActions.includes(action)) {
      return NextResponse.json({ error: "Invalid action. Use 'equip', 'select', or 'save-look'." }, { status: 400 });
    }

    // Avatar selection is completely free — no coin deduction or locked barriers
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`student-game-profile:${session.userId}`}))`;
      const currentData = await ensureStudentGameProfile(tx, session.userId);
      const unlocked = Array.from(new Set([...currentData.unlockedAvatars, avatarId]));

      const updated = await tx.studentGameProfile.update({
        where: { studentId: session.userId },
        data: {
          equippedAvatar: avatarId,
          unlockedAvatars: unlocked,
        },
      });
      return updated;
    });

    return NextResponse.json({
      success: true,
      message: `Equipped ${item.name} as your active avatar!`,
      equippedAvatar: avatarId,
      unlockedAvatars: result.unlockedAvatars,
    });
  } catch (error) {
    console.error("Avatar shop action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
