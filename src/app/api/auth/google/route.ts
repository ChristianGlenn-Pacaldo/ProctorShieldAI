import { requireBrowserAuthentication, BrowserAuthenticationUnavailableError, browserInitializationResponse } from "@/lib/browser-auth";
import { scheduleTrackedBackupWork, withBackupWriteGate } from "@/lib/backup-write-gate";
import { after, NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import prisma from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/email";
import { consumeRateLimitGroup, generateOtp, getClientIp, hashOtp } from "@/lib/security";
import { hashPassword, AuthenticationChangedError } from "@/lib/auth";
import { isTrustedAuthOrigin } from "@/lib/auth-origin";
import { hasVerifiedGoogleEmail } from "@/lib/google-identity";
import { beginGoogleSignIn, readGoogleIntent, createGoogleChallenge, hashGoogleOtp } from "@/lib/google-signin-challenge";

const client = new OAuth2Client(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);

async function POSTImpl(req: NextRequest) {
  if (!isTrustedAuthOrigin(req)) return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  try {
    const { credential, role, mode, intent: intentToken } = await req.json();
    if (mode !== undefined && mode !== "signin" && mode !== "begin") {
      return NextResponse.json({ success: false, message: "Invalid authentication mode" }, { status: 400 });
    }
    if (mode !== "begin" && (typeof credential !== "string" || !credential)) {
      return NextResponse.json({ success: false, message: "Missing Google credential" }, { status: 400 });
    }
    const startingBrowser = await requireBrowserAuthentication(getClientIp(req));
    if (mode === "begin") {
      const limit = await consumeRateLimitGroup([`google-intent:ip:${getClientIp(req)}`], 30, 15 * 60 * 1000);
      if (!limit.allowed) return NextResponse.json({ success: false }, { status: 429 });
      // Bootstrap completes on a separate response before signing an intent.
      return NextResponse.json(await beginGoogleSignIn(startingBrowser), { headers: { "Cache-Control": "no-store" } });
    }
    const signInOnly = mode === "signin";
    const intent = signInOnly ? await readGoogleIntent(intentToken) : null;
    if (signInOnly && !intent) {
      return NextResponse.json({ success: false, message: "Sign-in changed. Please start again." }, { status: 401 });
    }

    // Verify the Google ID Token
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!hasVerifiedGoogleEmail(payload) || (intent && payload.nonce !== intent.nonce)) {
      return NextResponse.json({ success: false, message: "Invalid Google token" }, { status: 401 });
    }

    const { email, name, picture } = payload;
    let requestedRole = signInOnly ? "" : String(role || "student").toLowerCase();
    if (!signInOnly && !['student', 'teacher'].includes(requestedRole)) {
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

    // Existing-account authorization comes only from PostgreSQL. Admin Google
    // login is deliberately disabled; only password authentication can issue it.
    if (user) {
      requestedRole = user.role.roleName.toLowerCase();
      if (!["teacher", "student"].includes(requestedRole)) {
        return NextResponse.json({ error: "Admin login requires a password" }, { status: 403 });
      }
      if (user.status !== "active") return NextResponse.json({ error: "Account inactive" }, { status: 403 });
    }

    // Fetch or create the requested role
    const dbRole = await prisma.role.findFirst({
      where: { roleName: { equals: requestedRole, mode: "insensitive" } },
    });

    if (signInOnly && !user) {
      return NextResponse.json({ success: false, code: "ACCOUNT_NOT_FOUND",
        message: "No existing account was found. Create a Student or Teacher account first." }, { status: 404 });
    }

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
      await scheduleTrackedBackupWork(after, async () => {
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
    } else if (!signInOnly) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          // Google initializes names at signup; preserve existing profile edits,
          // including edits committed after the account lookup above.
          profileImage: picture || user.profileImage,
        },
        include: { role: true },
      });
    }

    // Recheck after the profile update, which may have raced account changes.
    if (!["teacher", "student"].includes(user.role.roleName.toLowerCase())) {
      return NextResponse.json({ error: "Admin login requires a password" }, { status: 403 });
    }
    if (user.status !== "active") {
      return NextResponse.json({ success: false, message: "Account suspended" }, { status: 403 });
    }

    // ── MULTI-FACTOR AUTHENTICATION (MFA) ──
    
    const otpCode = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.otpCode.deleteMany({ where: { userId: user.id } });
    const otpNonce = crypto.randomUUID();
    const challenge = intent ? createGoogleChallenge({ ...intent, nonce: otpNonce }, user) : undefined;
    await prisma.otpCode.create({
      data: {
        userId: user.id,
        code: intent ? hashGoogleOtp(otpNonce, user.id, otpCode) : hashOtp(user.id, otpCode, "login"),
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
      role: user.role.roleName.toLowerCase(),
      ...(challenge ? { challenge } : {})
    });
  } catch (error: unknown) {
    const initialized = browserInitializationResponse(error);
    if (initialized) return initialized;
    if (error instanceof BrowserAuthenticationUnavailableError) return NextResponse.json({ error: "Sign-in temporarily unavailable" }, { status: 503 });
    if (error instanceof AuthenticationChangedError) return NextResponse.json({ error: "Authentication changed; sign in again" }, { status: 401 });
    console.error("Google Auth error:");
    return NextResponse.json(
      { success: false, message: "Google authentication failed. Please try again." },
      { status: 500 }
    );
  }
}

export const POST = withBackupWriteGate(POSTImpl);
