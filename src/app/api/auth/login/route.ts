import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyPassword, setSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password, role } = await req.json();

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: "Email and password are required" },
        { status: 400 }
      );
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { role: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Invalid email or password" },
        { status: 401 }
      );
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return NextResponse.json(
        { success: false, message: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Check if role matches (optional — if user tries to log in as wrong role)
    if (role && user.role.roleName.toLowerCase() !== role.toLowerCase()) {
      return NextResponse.json(
        { success: false, message: `This account is registered as ${user.role.roleName}, not ${role}` },
        { status: 403 }
      );
    }

    // Check if user is suspended
    if (user.status === "suspended") {
      return NextResponse.json(
        { success: false, message: "Your account has been suspended. Contact an administrator." },
        { status: 403 }
      );
    }

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
        activity: `Logged in as ${user.role.roleName}`,
        ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      },
    });

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
    console.error("Login error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
