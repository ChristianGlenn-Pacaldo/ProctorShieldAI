import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import prisma from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";
import { sendOtpEmail } from "@/lib/email";

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

    // Fetch or create the requested role
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

    if (!user) {
      // If user doesn't exist, create them
      user = await prisma.user.create({
        data: {
          fullName: name || "Google User",
          email: email.toLowerCase().trim(),
          password: `GOOGLE_OAUTH_${crypto.randomUUID()}`, // Non-guessable placeholder
          profileImage: picture || null,
          roleId: dbRole.id,
        },
        include: { role: true },
      });
    } else {
      // User exists. Update their name, profile picture, and override role to fix state
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          fullName: name || user.fullName,
          profileImage: picture || user.profileImage,
          roleId: dbRole.id, // Dynamically overwrite the role
        },
        include: { role: true },
      });
    }

    // Check suspension
    if (user.status === "suspended") {
      return NextResponse.json({ success: false, message: "Account suspended" }, { status: 403 });
    }

    // ── MULTI-FACTOR AUTHENTICATION (MFA) ──
    
    // Generate a 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in database
    await prisma.otpCode.create({
      data: {
        userId: user.id,
        code: otpCode,
        expiresAt: expiresAt,
      }
    });

    // Send email asynchronously (don't await so we don't block the response)
    sendOtpEmail(user.email, otpCode);

    return NextResponse.json({
      success: true,
      requiresMfa: true,
      userId: user.id,
      email: user.email,
      role: user.role.roleName.toLowerCase()
    });
  } catch (error: unknown) {
    console.error("Google Auth error:", error);
    return NextResponse.json(
      { success: false, message: "Google authentication failed. Please try again." },
      { status: 500 }
    );
  }
}
