import { withBackupWriteGate } from "@/lib/backup-write-gate";
import { after, NextRequest, NextResponse } from "next/server";
import { clearSession, getSession, hasConflictingSessionCookies } from "@/lib/auth";
import { isTrustedAuthOrigin } from "@/lib/auth-origin";
import prisma from "@/lib/prisma";
import { sendLogoutActivity } from "@/lib/logout-realtime";

async function POSTImpl(req: NextRequest) {
  try {
    // Caller-supplied roles must not select a different account to revoke.
    const session = await getSession();
    if (!session && await hasConflictingSessionCookies()) {
      return NextResponse.json({ success: false, serverRevocation: "not_performed", error: "Conflicting browser sessions cleared; sign in again before account-wide revocation" }, { status: 409 });
    }
    if (session) {
      const revoked = await prisma.$transaction(async (tx) => {
        // Replayed logout cannot revoke a subsequent login generation. Zero
        // rows means this old version is already invalid.
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
        // Next retains this work after the response. Cookie cleanup and DB
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
    }
    return NextResponse.json({ success: true, serverRevocation: "not_required", message: "Logged out", redirectTo: "/login" });
  } catch {
    // Browser cleanup still occurs, but failed DB revocation is not success.
    console.error("Account session revocation failed");
    return NextResponse.json({ success: false, serverRevocation: "failed", error: "Session revocation unavailable; please retry" }, { status: 503 });
  }
}

const revokeWithWriteGate = withBackupWriteGate(POSTImpl);

export async function POST(req: NextRequest) {
  // Foreign requests cannot force local logout. Trusted requests always receive
  // deletion headers, even when the gate refuses admission before POSTImpl.
  if (!isTrustedAuthOrigin(req)) return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  let response: Response;
  try { response = await revokeWithWriteGate(req); }
  catch { response = NextResponse.json({ success: false, serverRevocation: "failed", error: "Session revocation unavailable; please retry" }, { status: 503 }); }
  // Gate refusals are plain Responses; add an explicit truthful revocation result.
  if (response.status === 503) {
    response = NextResponse.json({ success: false, cookiesCleared: true, serverRevocation: "failed", error: "Session revocation unavailable; please retry" }, { status: 503, headers: response.headers });
  }
  await clearSession(response);
  return response;
}
