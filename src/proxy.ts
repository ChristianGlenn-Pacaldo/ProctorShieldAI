import { NextRequest, NextResponse } from "next/server";
import { verifyToken, type TokenPayload } from "@/lib/auth";

const SESSION_CLASSES = ["admin", "user"] as const;

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/login/student",
  "/login/teacher",
  "/login/forgot-password",
  "/admin/login",
]);

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/google",
  "/api/auth/verify-otp",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  // Logout validates its own session and Origin, and must clear stale cookies.
  "/api/auth/logout",
  "/api/billing/webhook",
  "/api/health",
  "/api/internal/maintenance",
  "/api/internal/backup-write-gate",
]);

const PUBLIC_API_PREFIXES = ["/api/models/coco/"];

const ROLE_PATHS: Record<string, string> = {
  student: "/dashboard/student",
  teacher: "/dashboard/teacher",
  admin: "/dashboard/admin",
};

function addSecurityHeaders(response: NextResponse): NextResponse {
  const isDevelopment = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""} https://accounts.google.com`,
    "style-src 'self' 'unsafe-inline' https://accounts.google.com https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.googleusercontent.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://accounts.google.com https://storage.googleapis.com https://*.pusher.com wss://*.pusher.com",
    "frame-src https://accounts.google.com",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(self), geolocation=()"
  );
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (!isDevelopment) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

function targetRoleForPage(pathname: string): string | null {
  if (pathname.startsWith("/dashboard/admin")) return "admin";
  if (pathname.startsWith("/dashboard/teacher")) return "teacher";
  if (pathname.startsWith("/dashboard/student") || pathname.startsWith("/quiz/")) {
    return "student";
  }
  return null;
}

function studentRetakeReauthentication(request: NextRequest) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login/student";
  loginUrl.search = "?reason=session-changed";
  const response = NextResponse.redirect(loginUrl);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return addSecurityHeaders(response);
}

// Only marked retake document requests enter this final authorization boundary.
// Read the request's verified cookie and persisted account, not a prior fetch.
async function authorizeStudentRetakeNavigation(request: NextRequest, payload: TokenPayload) {
  try {
    const { default: prisma } = await import("@/lib/prisma");
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { status: true, sessionVersion: true, role: { select: { roleName: true } } },
    });
    if (!user || user.status !== "active" || user.sessionVersion !== payload.sessionVersion
      || user.role.roleName.toLowerCase() !== "student") {
      return studentRetakeReauthentication(request);
    }

    if (request.nextUrl.pathname !== "/dashboard/student") {
      const quizId = Number(request.nextUrl.pathname.split("/")[2]);
      const attempt = Number.isSafeInteger(quizId) && quizId > 0 && quizId <= 2_147_483_647
        ? await prisma.studentQuiz.findFirst({
          where: { studentId: payload.userId, quizId },
          orderBy: { attemptNumber: "desc" },
          select: { attemptNumber: true, quizStatus: true, endTime: true, attemptMode: true,
            quiz: { select: { quizMode: true, quizStatus: true } } },
        }) : null;
      const mode = attempt?.attemptMode ?? attempt?.quiz.quizMode;
      if (!attempt || attempt.attemptNumber <= 1 || attempt.endTime !== null
        || !["enrolled", "in_progress"].includes(attempt.quizStatus || "")
        || !["in_progress", "ended"].includes(attempt.quiz.quizStatus)
        || !["arena", "proctored"].includes(mode || "") || mode !== attempt.quiz.quizMode) {
        return addSecurityHeaders(NextResponse.json({ error: "This retake is no longer available" },
          { status: 409, headers: { "Cache-Control": "private, no-store, max-age=0" } }));
      }
      const destination = `/${mode === "arena" ? "arena" : "quiz"}/${quizId}`;
      if (request.nextUrl.pathname !== destination) {
        // Legacy approval events can omit the mode. Preserve the guard on the
        // redirect so its eventual request must authorize the current cookie.
        const destinationUrl = request.nextUrl.clone();
        destinationUrl.pathname = destination;
        const response = NextResponse.redirect(destinationUrl);
        response.headers.set("Cache-Control", "private, no-store, max-age=0");
        return addSecurityHeaders(response);
      }
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-active-role", "student");
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return addSecurityHeaders(response);
  } catch {
    return addSecurityHeaders(NextResponse.json({ error: "Session validation unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } }));
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const retakeNavigation = (pathname === "/dashboard/student" || /^\/(quiz|arena)\/[1-9]\d*$/.test(pathname))
    && request.nextUrl.searchParams.has("_retakeStudent");

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  if (
    PUBLIC_PATHS.has(pathname)
    || PUBLIC_API_PATHS.has(pathname)
    || PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    const response = NextResponse.next();
    if (pathname.startsWith("/login") || pathname === "/admin/login") {
      response.headers.set("Cache-Control", "no-store, max-age=0");
    }
    return addSecurityHeaders(response);
  }

  const targetRole = retakeNavigation ? "student" : targetRoleForPage(pathname);
  const candidateClasses = targetRole ? [targetRole === "admin" ? "admin" : "user"] : [...SESSION_CLASSES];
  let tokenName = "";
  let payload = null;

  // Mixed-role endpoints have no safe implicit account selection. Legacy
  // role cookies are not accepted; they require a fresh authentication.
  const ambiguous = !targetRole && request.cookies.get("ps_session_admin")?.value && request.cookies.get("ps_session_user")?.value;
  for (const sessionClass of ambiguous ? [] : candidateClasses) {
    const name = `ps_session_${sessionClass}`;
    const token = request.cookies.get(name)?.value;
    if (!token) continue;

    const verified = verifyToken(token);
    if (verified && verified.sessionClass === sessionClass &&
      (sessionClass === "admin" ? verified.role === "admin" : ["teacher", "student"].includes(verified.role))) {
      tokenName = name;
      payload = verified;
      break;
    }
  }

  if (retakeNavigation) {
    // The marker can only restrict access. It cannot supply a role or identity.
    if (!payload || payload.sessionClass !== "user" || payload.role.toLowerCase() !== "student"
      || request.cookies.get("ps_session_admin")?.value
      || request.nextUrl.searchParams.getAll("_retakeStudent").length !== 1
      || request.nextUrl.searchParams.get("_retakeStudent") !== payload.userId) {
      return studentRetakeReauthentication(request);
    }
    return authorizeStudentRetakeNavigation(request, payload);
  }

  if (!payload) {
    if (pathname.startsWith("/api/")) {
      const response = NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
      if (tokenName) response.cookies.delete(tokenName);
      return addSecurityHeaders(response);
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = targetRole === "admin" ? "/admin/login" : "/login";
    const response = NextResponse.redirect(loginUrl);
    if (tokenName) response.cookies.delete(tokenName);
    return addSecurityHeaders(response);
  }

  const userRole = payload.role.toLowerCase();

  if (pathname.startsWith("/dashboard/")) {
    const allowedPrefix = ROLE_PATHS[userRole];
    if (!allowedPrefix || !pathname.startsWith(allowedPrefix)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = allowedPrefix || "/login";
      return addSecurityHeaders(NextResponse.redirect(redirectUrl));
    }
  }

  if (pathname.startsWith("/quiz/") && userRole !== "student") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = ROLE_PATHS[userRole] || "/login";
    return addSecurityHeaders(NextResponse.redirect(redirectUrl));
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-active-role", userRole);
  return addSecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } })
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
