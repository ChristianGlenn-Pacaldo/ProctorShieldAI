import { after, NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { consumeRateLimitGroup, getClientIp, isStrongPassword } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    const { fullName, email, password, confirmPassword, role } = await req.json();

    // Validate input
    if (!fullName || !email || !password) {
      return NextResponse.json(
        { success: false, message: "Full name, email, and password are required" },
        { status: 400 }
      );
    }

    if (!isStrongPassword(password)) {
      return NextResponse.json(
        { success: false, message: "Password must be 10-128 characters and contain letters and numbers" },
        { status: 400 }
      );
    }

    if (confirmPassword && password !== confirmPassword) {
      return NextResponse.json(
        { success: false, message: "Passwords do not match" },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const rateLimit = await consumeRateLimitGroup(
      [`register:ip:${getClientIp(req)}`, `register:account:${normalizedEmail}`],
      5,
      60 * 60 * 1000
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many registration attempts." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }
    if (
      typeof fullName !== "string"
      || fullName.trim().length < 2
      || fullName.trim().length > 150
      || typeof email !== "string"
      || email.length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      return NextResponse.json(
        { success: false, message: "Enter a valid name and email address" },
        { status: 400 },
      );
    }

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, message: "An account with this email already exists" },
        { status: 409 }
      );
    }

    // Resolve role ID (default to "student")
    const roleName = String(role || "student").toLowerCase();
    if (!['student', 'teacher'].includes(roleName)) {
      return NextResponse.json(
        { success: false, message: "Admin registration is restricted. Contact system administrator." },
        { status: 403 }
      );
    }

    const roleRecord = await prisma.role.findUnique({
      where: { roleName },
    });

    if (!roleRecord) {
      return NextResponse.json(
        { success: false, message: "Account role is not configured." },
        { status: 500 }
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const user = await prisma.user.create({
      data: {
        fullName: fullName.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        roleId: roleRecord.id,
        status: "active",
      },
      include: { role: true },
    });

    // Create session (sets HttpOnly cookie — token is NOT returned in body for security)
    await setSessionCookie({
      userId: user.id,
      email: user.email,
      role: user.role.roleName.toLowerCase(),
      fullName: user.fullName,
    });

    const ipAddress = req.headers.get("x-forwarded-for") || "unknown";
    after(async () => {
      const results = await Promise.allSettled([
        prisma.activityLog.create({
          data: {
            userId: user.id,
            activity: `New ${roleName} account created`,
            ipAddress,
          },
        }),
        (async () => {
          const { pusherServer } = await import("@/lib/pusher");
          await pusherServer.trigger("private-admin-dashboard", "activity", {
            type: "register",
            userId: user.id,
            fullName: user.fullName,
            role: user.role.roleName,
            activity: `New ${user.role.roleName} account created`,
            timestamp: new Date().toISOString(),
          });
        })(),
        (async () => {
          const { sendWelcomeEmail } = await import("@/lib/email");
          await sendWelcomeEmail(user.email, user.fullName, user.role.roleName);
        })(),
      ]);
      for (const result of results) {
        if (result.status === "rejected") console.error("Post-registration side effect failed:", result.reason);
      }
    });

    return NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          role: user.role.roleName.toLowerCase(),
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Register error:", error);
    return NextResponse.json(
      { success: false, message: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
