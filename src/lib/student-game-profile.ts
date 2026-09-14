import type { Prisma, PrismaClient, StudentGameProfile } from "@prisma/client";
import { parseStudentAvatarData } from "./student-coins";

type GameProfileClient = PrismaClient | Prisma.TransactionClient;

/**
 * Loads the normalized game profile and migrates the legacy JSON that older
 * Playground builds stored in users.profile_image. The legacy value is only
 * cleared when it is the JSON game payload, so real Google profile photos stay
 * intact.
 */
export async function ensureStudentGameProfile(
  client: GameProfileClient,
  studentId: string,
): Promise<StudentGameProfile> {
  const existing = await client.studentGameProfile.findUnique({ where: { studentId } });
  if (existing) return existing;

  const user = await client.user.findUnique({
    where: { id: studentId },
    select: { profileImage: true },
  });
  if (!user) throw new Error("Student not found");

  const legacy = parseStudentAvatarData(user.profileImage);
  const profile = await client.studentGameProfile.upsert({
    where: { studentId },
    update: {},
    create: {
      studentId,
      coins: legacy.coins,
      unlockedAvatars: legacy.unlockedAvatars,
      equippedAvatar: legacy.equippedAvatar,
      topOneWins: legacy.topOneWins,
    },
  });

  if (user.profileImage?.startsWith("{") && user.profileImage.endsWith("}")) {
    await client.user.updateMany({
      where: { id: studentId, profileImage: user.profileImage },
      data: { profileImage: null },
    });
  }

  return profile;
}
