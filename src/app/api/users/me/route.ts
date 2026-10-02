import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getScopedSession, prepareSessionToken, setPreparedSessionCookie, AuthenticationChangedError } from "@/lib/auth";
import { isTrustedAuthOrigin } from "@/lib/auth-origin";

async function PUTImpl(req: NextRequest) {
  if (!isTrustedAuthOrigin(req)) return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  try {
    const session = await getScopedSession(req, ["user"]);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fullName } = await req.json();

    if (typeof fullName !== "string" || fullName.trim().length < 2 || fullName.length > 150) {
      return NextResponse.json({ error: "Invalid name format" }, { status: 400 });
    }

    const uppercaseName = fullName.trim();

    const token = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: session.userId, status: "active", sessionVersion: session.sessionVersion,
          role: { roleName: { equals: session.role, mode: "insensitive" } } },
        data: { fullName: uppercaseName },
      });
      return prepareSessionToken({ userId: session.userId, email: updatedUser.email, role: session.role, fullName: uppercaseName },
        { userId: session.userId, role: session.role, sessionVersion: updatedUser.sessionVersion, password: updatedUser.password }, tx);
    });
    await setPreparedSessionCookie(token);

    return NextResponse.json({ success: true, fullName: uppercaseName });
  } catch (error: any) {
    if (error instanceof AuthenticationChangedError || error?.code === "P2025") return NextResponse.json({ error: "Authentication changed; sign in again" }, { status: 401 });
    console.error("Update profile error:");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const PUT = withBackupWriteGate(PUTImpl);
