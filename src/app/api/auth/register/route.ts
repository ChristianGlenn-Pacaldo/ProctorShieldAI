import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword, setSessionCookie } from "@/lib/auth";

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

    if (password.length < 6) {
      return NextResponse.json(
        { success: false, message: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    if (confirmPassword && password !== confirmPassword) {
      return NextResponse.json(
        { success: false, message: "Passwords do not match" },
        { status: 400 }
      );
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, message: "An account with this email already exists" },
        { status: 409 }
      );
    }

    // Resolve role ID (default to "student")
    const roleName = role || "student";
    let roleRecord = await prisma.role.findUnique({
      where: { roleName },
    });

    if (!roleRecord) {
      // Auto-create role if missing
      roleRecord = await prisma.role.create({
        data: {
          roleName: roleName.toLowerCase(),
          description: `Auto-created ${roleName} role`
        }
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const user = await prisma.user.create({
      data: {
        fullName: fullName.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        roleId: roleRecord.id,
        status: "active",
      },
      include: { role: true },
    });

    // Create session
    const token = await setSessionCookie({
      userId: user.id,
      email: user.email,
      role: user.role.roleName.toLowerCase(),
      fullName: user.fullName,
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        activity: `New ${roleName} account created`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      },
    });

    // Broadcast activity to admin
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger("admin-dashboard", "activity", {
        type: "register",
        userId: user.id,
        fullName: user.fullName,
        role: user.role.roleName,
        activity: `New ${user.role.roleName} account created`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Failed to broadcast activity to admin:", e);
    }

    return NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          role: user.role.roleName.toLowerCase(),
        },
        token,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Register error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
