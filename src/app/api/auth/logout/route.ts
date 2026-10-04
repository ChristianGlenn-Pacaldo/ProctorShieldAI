import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { after, NextRequest, NextResponse } from "next/server";
import { getSession, hasConflictingSessionCookies, type TokenPayload } from "@/lib/auth";
import { isTrustedAuthOrigin } from "@/lib/auth-origin";
import prisma from "@/lib/prisma";
import { sendLogoutActivity } from "@/lib/logout-realtime";
import { invalidateBrowserAuthentication } from "@/lib/browser-auth";

async function POSTImpl(req: NextRequest, session: TokenPayload) {
  try {
    // The caller supplies only its already strictly validated request identity.
    const revoked = await prisma.$transaction(async (tx) => {
      // Revoke the observed account version across devices. A same-account
      // login before this increment shares that version; one after uses the
      // new version. Zero rows means this version is already revoked.
      const revoked = await tx.user.updateMany({
        where: { id: session.userId, sessionVersion: session.sessionVersion },
        data: { sessionVersion: { increment: 1 }, isOnline: false, lastSeenAt: new Date() },
      });
      if (revoked.count === 1) await tx.activityLog.create({
        data: {
          userId: session.userId, activity: `Logged out all sessions as ${session.role}`,
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
        },
      });
      return revoked.count === 1;
    });
    if (revoked) {
      // Next retains this work after the response. Browser invalidation and DB
      // revocation do not wait for it; the transport has a real abort deadline.
      try {
        after(async () => {
          try {
            await sendLogoutActivity({
              type: "logout", userId: session.userId, fullName: session.fullName,
              role: session.role, activity: `Logged out as ${session.role}`, timestamp: new Date().toISOString(),
            });
          } catch { console.error("Logout activity delivery failed"); }
        });
      } catch { console.error("Logout activity scheduling failed"); }
    }
    return NextResponse.json({ success: true, serverRevocation: revoked ? "succeeded" : "already_invalid", message: "Logged out", redirectTo: "/login" });
  } catch {
    // Failed account-wide revocation is not reported as success.
    console.error("Account session revocation failed");
    return NextResponse.json({ success: false, serverRevocation: "failed", error: "Session revocation unavailable; please retry" }, { status: 503 });
  }
}

const revokeWithWriteGate = withBackupWriteGate(POSTImpl);

export async function POST(req: NextRequest) {
  if (!isTrustedAuthOrigin(req)) return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  let expected: TokenPayload | null;
  try {
    // Read-only validation precedes gate admission so valid logout can still
    // invalidate locally if DB writes are paused. Revoked tokens cannot do so.
    expected = await getSession(undefined, { touchActivity: false });
  } catch {
    return NextResponse.json({ success: false, cookiesCleared: false, serverRevocation: "failed",
      error: "Session revocation unavailable; please retry" }, { status: 503 });
  }
  if (!expected) {
    if (await hasConflictingSessionCookies()) return NextResponse.json({ success: false, serverRevocation: "not_performed", error: "Conflicting browser sessions; sign in again" }, { status: 409 });
    // Sessionless requests have no authenticated generation to invalidate.
    return NextResponse.json({ success: true, serverRevocation: "not_required", cookiesCleared: false, redirectTo: "/login" });
  }
  let response: Response;
  try { response = await revokeWithWriteGate(req, expected); }
  catch { response = NextResponse.json({ success: false, serverRevocation: "failed", error: "Session revocation unavailable; please retry" }, { status: 503 }); }
  try { await invalidateBrowserAuthentication(expected); }
  catch { response = NextResponse.json({ success: false, serverRevocation: "failed", error: "Browser authentication invalidation unavailable; please retry" }, { status: 503 }); }
  if (response.status === 503) {
    response = NextResponse.json({ success: false, cookiesCleared: false, serverRevocation: "failed", error: "Session revocation unavailable; please retry" }, { status: 503, headers: response.headers });
  }
  // Retain revoked HttpOnly cookies: HTTP deletion headers cannot conditionally
  // delete their old value and would erase a newer login on delayed delivery.
  // Fresh authentication still clears all opposite/legacy session cookies.
  return response;
}
