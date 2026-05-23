import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import prisma from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";

const client = new OAuth2Client(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);

export async function POST(req: NextRequest) {
  try {
    const { credential, role } = await req.json();

    if (!credential) {
      return NextResponse.json({ success: false, message: "Missing Google credential" }, { status: 400 });
    }

    // Verify the Google ID Token
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return NextResponse.json({ success: false, message: "Invalid Google token" }, { status: 401 });
    }

    const { email, name, picture } = payload;
    const requestedRole = role || "student"; // Default to student

    // Check if user exists
    let user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { role: true },
    });

    // If user doesn't exist, create them
    if (!user) {
      let dbRole = await prisma.role.findFirst({
        where: { roleName: { equals: requestedRole, mode: "insensitive" } },
      });

      if (!dbRole) {
        // Auto-create role if missing
        dbRole = await prisma.role.create({
          data: {
            roleName: requestedRole.toLowerCase(),
            description: `Auto-created ${requestedRole} role`
          }
        });
      }

      user = await prisma.user.create({
        data: {
          fullName: name || "Google User",
          email: email.toLowerCase().trim(),
          password: "GOOGLE_AUTH_NO_PASSWORD", // Placeholder
          profileImage: picture || null,
          roleId: dbRole.id,
        },
        include: { role: true },
      });
    } else {
      // If user exists, update their name and profile picture to sync with their current Google profile
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          fullName: name || user.fullName,
          profileImage: picture || user.profileImage,
        },
        include: { role: true },
      });
    }

    // Check suspension
    if (user.status === "suspended") {
      return NextResponse.json({ success: false, message: "Account suspended" }, { status: 403 });
    }

    // Create custom JWT session
    const token = await setSessionCookie({
      userId: user.id,
      email: user.email,
      role: user.role.roleName.toLowerCase(),
      fullName: user.fullName,
    });

    // Set user online in database
    await prisma.user.update({
      where: { id: user.id },
      data: { isOnline: true },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        activity: `Logged in via Google as ${user.role.roleName}`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      },
    });

    // Broadcast activity to admin
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger("admin-dashboard", "activity", {
        type: "login",
        userId: user.id,
        fullName: user.fullName,
        role: user.role.roleName,
        activity: `Logged in via Google as ${user.role.roleName}`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Failed to broadcast Google login to admin:", e);
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role.roleName.toLowerCase(),
        profileImage: user.profileImage,
      },
      token,
    });
  } catch (error: any) {
    console.error("Google Auth error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Google authentication failed" },
      { status: 500 }
    );
  }
}
