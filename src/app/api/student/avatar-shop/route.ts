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

    if (action !== "buy" && action !== "equip") {
      return NextResponse.json({ error: "Invalid action. Use 'buy', 'equip', or 'save-look'." }, { status: 400 });
    }

    if (action === "buy") {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`student-game-profile:${session.userId}`}))`;
        const currentData = await ensureStudentGameProfile(tx, session.userId);
        if (currentData.unlockedAvatars.includes(avatarId)) {
          return { kind: "owned" as const };
        }
        if (currentData.coins < item.price) {
          return { kind: "insufficient" as const, coins: currentData.coins };
        }

        const updated = await tx.studentGameProfile.update({
          where: { studentId: session.userId },
          data: {
            coins: { decrement: item.price },
            unlockedAvatars: { push: avatarId },
            equippedAvatar: avatarId,
          },
        });
        await tx.studentCoinLedger.create({
          data: {
            studentId: session.userId,
            sourceType: "avatar-purchase",
            sourceId: avatarId,
            amount: -item.price,
            metadata: { avatarId, avatarName: item.name },
          },
        });
        return { kind: "purchased" as const, profile: updated };
      });

      if (result.kind === "owned") {
        return NextResponse.json(
          { error: "You already own this avatar", alreadyOwned: true },
          { status: 400 },
        );
      }
      if (result.kind === "insufficient") {
        return NextResponse.json(
          {
            error: `Not enough coins! You need ${item.price} coins, but have ${result.coins}.`,
            needed: item.price - result.coins,
          },
          { status: 400 },
        );
      }

      return NextResponse.json({
        success: true,
        message: `Unlocked and equipped ${item.name}!`,
        coins: result.profile.coins,
        equippedAvatar: avatarId,
        unlockedAvatars: result.profile.unlockedAvatars,
      });
    }

    if (action === "equip") {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`student-game-profile:${session.userId}`}))`;
        const currentData = await ensureStudentGameProfile(tx, session.userId);
        if (!currentData.unlockedAvatars.includes(avatarId)) {
          return { kind: "locked" as const };
        }
        const updated = await tx.studentGameProfile.update({
          where: { studentId: session.userId },
          data: { equippedAvatar: avatarId },
        });
        return { kind: "equipped" as const, profile: updated };
      });

      if (result.kind === "locked") {
        return NextResponse.json(
          { error: "You have not unlocked this avatar yet." },
          { status: 403 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `Equipped ${item.name} as your active avatar!`,
        equippedAvatar: avatarId,
        coins: result.profile.coins,
        unlockedAvatars: result.profile.unlockedAvatars,
      });
    }
  } catch (error) {
    console.error("Avatar shop action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
