import { after, NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import prisma from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/email";
import { consumeRateLimitGroup, generateOtp, getClientIp, hashOtp } from "@/lib/security";
import { hashPassword } from "@/lib/auth";
import { hasVerifiedGoogleEmail } from "@/lib/google-identity";

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
    if (!hasVerifiedGoogleEmail(payload)) {
      return NextResponse.json({ success: false, message: "Invalid Google token" }, { status: 401 });
    }

    const { email, name, picture } = payload;
    const requestedRole = String(role || "student").toLowerCase();
    if (!['student', 'teacher', 'admin'].includes(requestedRole)) {
      return NextResponse.json({ success: false, message: "Invalid account role." }, { status: 400 });
    }

    const rateLimit = await consumeRateLimitGroup(
      [`google-auth:ip:${getClientIp(req)}`, `google-auth:account:${email.toLowerCase()}`],
      8,
      15 * 60 * 1000
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many authentication attempts." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    // Check if user exists
    let user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { role: true },
    });

    // Security Check: Prevent unauthorized users from becoming admins via Google Auth
    if (requestedRole.toLowerCase() === "admin") {
      if (!user || user.role?.roleName.toLowerCase() !== "admin") {
        return NextResponse.json(
          { success: false, message: "Admin registration via Google is restricted." },
          { status: 403 }
        );
      }
    }

    // Fetch or create the requested role
    const dbRole = await prisma.role.findFirst({
      where: { roleName: { equals: requestedRole, mode: "insensitive" } },
    });

    if (!dbRole) {
      return NextResponse.json({ success: false, message: "Account role is not configured." }, { status: 500 });
    }

    if (!user) {
      // If user doesn't exist, create them
      user = await prisma.user.create({
        data: {
          fullName: name || "Google User",
          email: email.toLowerCase().trim(),
          password: await hashPassword(`GOOGLE_OAUTH_${crypto.randomUUID()}`),
          profileImage: picture || null,
          roleId: dbRole.id,
        },
        include: { role: true },
      });

      const createdUser = user;
      const ipAddress = req.headers.get("x-forwarded-for") || "unknown";
      after(async () => {
        const results = await Promise.allSettled([
          prisma.activityLog.create({
            data: {
              userId: createdUser.id,
              activity: `New ${requestedRole} account created via Google`,
              ipAddress,
            },
          }),
          (async () => {
            const { pusherServer } = await import("@/lib/pusher");
            await pusherServer.trigger("private-admin-dashboard", "activity", {
              type: "register",
              userId: createdUser.id,
              fullName: createdUser.fullName,
              role: createdUser.role.roleName,
              activity: `New ${createdUser.role.roleName} account created via Google`,
              timestamp: new Date().toISOString(),
            });

            const adminUser = await prisma.user.findFirst({
              where: { role: { roleName: "admin" } },
            });
            if (!adminUser) return;

            const notification = await prisma.notification.create({
              data: {
                userId: adminUser.id,
                title: "New Google Sign-Up",
                message: `${createdUser.fullName} just registered as a ${createdUser.role.roleName}.`,
                isRead: false,
              },
            });
            await pusherServer.trigger(`private-user-${adminUser.id}`, "notification", {
              id: notification.id.toString(),
              title: "New Google Sign-Up",
              message: `${createdUser.fullName} just registered as a ${createdUser.role.roleName}.`,
              createdAt: new Date().toISOString(),
            });
          })(),
        ]);
        for (const result of results) {
          if (result.status === "rejected") console.error("Post-Google-registration side effect failed:", result.reason);
        }
      });
    } else {
      if (user.role.roleName.toLowerCase() !== requestedRole) {
        return NextResponse.json(
          { success: false, message: `This account is registered as ${user.role.roleName}, not ${requestedRole}.` },
          { status: 403 }
        );
      }

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

    // ── MULTI-FACTOR AUTHENTICATION (MFA) ──
    
    const otpCode = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.otpCode.deleteMany({ where: { userId: user.id } });
    await prisma.otpCode.create({
      data: {
        userId: user.id,
        code: hashOtp(user.id, otpCode, "login"),
        expiresAt: expiresAt,
      }
    });

    const sent = await sendOtpEmail(user.email, otpCode);
    if (!sent) {
      await prisma.otpCode.deleteMany({ where: { userId: user.id } });
      return NextResponse.json(
        { success: false, message: "Unable to send verification code. Please try again." },
        { status: 503 }
      );
    }

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
