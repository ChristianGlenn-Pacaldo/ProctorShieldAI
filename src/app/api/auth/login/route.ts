import { scheduleTrackedBackupWork, withBackupWriteGate } from "@/lib/backup-write-gate";
import { after, NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyPassword, setSessionCookie, AuthenticationChangedError } from "@/lib/auth";
import { isTrustedAuthOrigin } from "@/lib/auth-origin";
import { pusherServer } from "@/lib/pusher";
import { consumeRateLimitGroup, getClientIp } from "@/lib/security";
import { requireBrowserAuthentication, BrowserAuthenticationUnavailableError, browserInitializationResponse } from "@/lib/browser-auth";

async function POSTImpl(req: NextRequest) {
  if (!isTrustedAuthOrigin(req)) return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  try {
    const { email, password, role } = await req.json();

    // Validate input
    if (typeof email !== "string" || typeof password !== "string" || !email || !password || (role !== undefined && typeof role !== "string")) {
      return NextResponse.json(
        { success: false, message: "Email and password are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const startingBrowser = await requireBrowserAuthentication(getClientIp(req));
    const rateLimit = await consumeRateLimitGroup(
      [`login:ip:${getClientIp(req)}`, `login:account:${normalizedEmail}`],
      10,
      15 * 60 * 1000
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
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
    if (user.status !== "active") {
      return NextResponse.json(
        { success: false, message: "Your account has been suspended. Contact an administrator." },
        { status: 403 }
      );
    }

    // Create session (sets HttpOnly cookie — token is NOT returned in body for security)
    const ipAddress = req.headers.get("x-forwarded-for") || "unknown";
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role.roleName.toLowerCase(),
        profileImage: user.profileImage,
      },
    });

    await setSessionCookie({
      userId: user.id,
      email: user.email,
      role: user.role.roleName.toLowerCase(),
      fullName: user.fullName,
    }, { userId: user.id, role: user.role.roleName, sessionVersion: user.sessionVersion, password: user.password }, startingBrowser);

    try {
      await scheduleTrackedBackupWork(after, async () => {
        const results = await Promise.allSettled([
          prisma.activityLog.create({
            data: {
              userId: user.id,
              activity: `Logged in as ${user.role.roleName}`,
              ipAddress,
            },
          }),
          (async () => {
            await pusherServer.trigger("private-admin-dashboard", "activity", {
              type: "login",
              userId: user.id,
              fullName: user.fullName,
              role: user.role.roleName,
              activity: `Logged in as ${user.role.roleName}`,
              timestamp: new Date().toISOString(),
            });

            const adminUser = await prisma.user.findFirst({
              where: { role: { roleName: "admin" } },
            });
            if (!adminUser) return;

            const notification = await prisma.notification.create({
              data: {
                userId: adminUser.id,
                title: "New Login",
                message: `${user.fullName} (${user.role.roleName}) just logged in.`,
                isRead: false,
              },
            });
            await pusherServer.trigger(`private-user-${adminUser.id}`, "notification", {
              id: notification.id.toString(),
              title: "New Login",
              message: `${user.fullName} (${user.role.roleName}) just logged in.`,
              createdAt: new Date().toISOString(),
            });
          })(),
        ]);
        for (const result of results) {
          if (result.status === "rejected") console.error("Post-login side effect failed:", result.reason);
        }
      });
    } catch { console.error("Post-authentication scheduling failed"); }

    return response;
  } catch (error: unknown) {
    const initialized = browserInitializationResponse(error);
    if (initialized) return initialized;
    if (error instanceof BrowserAuthenticationUnavailableError) return NextResponse.json({ error: "Sign-in temporarily unavailable" }, { status: 503 });
    if (error instanceof AuthenticationChangedError) return NextResponse.json({ error: "Authentication changed; sign in again" }, { status: 401 });
    console.error("Login error:");
    return NextResponse.json(
      { success: false, message: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}

export const POST = withBackupWriteGate(POSTImpl);
