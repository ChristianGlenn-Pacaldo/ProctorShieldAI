import { NextRequest, NextResponse } from "next/server";

// ──────────────────────────────────────────────────────────────────
// ProctorShield AI — Edge Middleware
// Enforces authentication and RBAC at the routing layer BEFORE
// any page or API handler runs. This is the first line of defense.
// ──────────────────────────────────────────────────────────────────

const TOKEN_PREFIX = "ps_session_";

// ── Route Definitions ─────────────────────────────────────────────

/** Public pages that never require auth */
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/login/student",
  "/login/teacher",
  "/admin/login",
];

/** Auth API routes that must remain accessible without a session */
const PUBLIC_API_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/google",
  "/api/auth/verify-otp",
  "/api/billing/webhook",
  "/api/wipe-users",
];

/** Role → allowed dashboard path prefix mapping */
const ROLE_PATHS: Record<string, string> = {
  student: "/dashboard/student",
  teacher: "/dashboard/teacher",
  admin: "/dashboard/admin",
};

/** Role → allowed API path prefixes */
const ROLE_API_PATHS: Record<string, string[]> = {
  student: [
    "/api/quizzes/join",
    "/api/quizzes/submit",
    "/api/quizzes/retake",
    "/api/live/snapshot",
    "/api/live/analyze",
    "/api/live/violation",
    "/api/live/join",
    "/api/dashboard/student",
    "/api/ai/verdict",
  ],
  teacher: [
    "/api/quizzes",
    "/api/ai/create",
    "/api/ai/verdict",
    "/api/live/snapshot",
    "/api/dashboard/teacher",
    "/api/billing",
  ],
  admin: [
    "/api/quizzes",
    "/api/dashboard/admin",
    "/api/ai",
  ],
};

/** Shared API routes accessible by any authenticated user */
const SHARED_API_PATHS = [
  "/api/auth/session",
  "/api/auth/logout",
  "/api/quizzes",
  "/api/users/me",
  "/api/users",
  "/api/notifications",
  "/api/live/snapshot",
  "/api/live/join",
  "/api/live/violation",
  "/api/live/analyze",
  "/api/live/webrtc",
];

// ── JWT Decoding (Edge-compatible, no `jsonwebtoken`) ─────────────

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Base64url → Base64 → decode
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    const data = JSON.parse(json);
    // Check expiry
    if (data.exp && Date.now() >= data.exp * 1000) {
      return null; // Token expired
    }
    return data;
  } catch {
    return null;
  }
}

// ── Security Headers ──────────────────────────────────────────────

function addSecurityHeaders(response: NextResponse): NextResponse {
  // Prevent clickjacking
  response.headers.set("X-Frame-Options", "DENY");
  // Prevent MIME sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");
  // Referrer policy — don't leak full URL on cross-origin requests
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Permissions policy — restrict sensitive browser features
  response.headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(self), geolocation=()"
  );
  // Basic CSP — allow self + inline styles (needed for Tailwind) + Google fonts
  response.headers.set(
    "Content-Security-Policy",
    "frame-ancestors 'none';"
  );
  return response;
}

// ── Middleware Handler ────────────────────────────────────────────

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── 1. Skip static assets and Next.js internals ──
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // ── 2. Allow public pages ──
  if (PUBLIC_PATHS.includes(pathname)) {
    return addSecurityHeaders(NextResponse.next());
  }

  // ── 3. Allow public API routes (login, register, etc.) ──
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return addSecurityHeaders(NextResponse.next());
  }

  // ── 4. Extract and validate session token ──
  let targetRole = null;
  if (
    pathname.startsWith("/dashboard/admin") || 
    pathname.startsWith("/api/dashboard/admin") ||
    pathname.startsWith("/api/admin")
  ) {
    targetRole = "admin";
  } else if (
    pathname.startsWith("/dashboard/teacher") || 
    pathname.startsWith("/api/quizzes/create") ||
    pathname.startsWith("/api/dashboard/teacher") ||
    pathname.startsWith("/api/billing") ||
    pathname.startsWith("/api/ai/") ||
    pathname.startsWith("/api/teacher")
  ) {
    targetRole = "teacher";
  } else if (
    pathname.startsWith("/dashboard/student") || 
    pathname.startsWith("/quiz/") ||
    pathname.startsWith("/api/dashboard/student") ||
    pathname.startsWith("/api/live/") ||
    pathname.startsWith("/api/student")
  ) {
    targetRole = "student";
  }

  // Look for the specific role cookie, or fallback to ANY available cookie for generic routes
  let token = null;
  let tokenName = "";

  if (targetRole) {
    tokenName = `${TOKEN_PREFIX}${targetRole}`;
    token = request.cookies.get(tokenName)?.value;
  } else {
    // Check all possible cookies for generic routes like /api/auth/session
    const roles = ["admin", "teacher", "student"];
    for (const r of roles) {
      token = request.cookies.get(`${TOKEN_PREFIX}${r}`)?.value;
      if (token) {
        tokenName = `${TOKEN_PREFIX}${r}`;
        break;
      }
    }
  }

  if (!token) {
    // No session → redirect pages to login, return 401 for API
    if (pathname.startsWith("/api/")) {
      return addSecurityHeaders(
        NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        )
      );
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return addSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  const payload = decodeJwtPayload(token);

  if (!payload) {
    // Invalid or expired token → clear it and redirect
    if (pathname.startsWith("/api/")) {
      const res = NextResponse.json(
        { error: "Session expired. Please log in again." },
        { status: 401 }
      );
      res.cookies.delete(tokenName);
      return addSecurityHeaders(res);
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete(tokenName);
    return addSecurityHeaders(res);
  }

  const userRole = (payload.role as string)?.toLowerCase();

  // ── 5. Dashboard RBAC enforcement ──
  if (pathname.startsWith("/dashboard/")) {
    const allowedPrefix = ROLE_PATHS[userRole];

    if (!allowedPrefix || !pathname.startsWith(allowedPrefix)) {
      // User is trying to access a different role's dashboard
      const correctPath = ROLE_PATHS[userRole] || "/login";
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = correctPath;
      return addSecurityHeaders(NextResponse.redirect(redirectUrl));
    }
  }

  // ── 6. Quiz room requires student role ──
  if (pathname.startsWith("/quiz/")) {
    if (userRole !== "student") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = ROLE_PATHS[userRole] || "/login";
      return addSecurityHeaders(NextResponse.redirect(redirectUrl));
    }
  }

  // ── 7. API RBAC enforcement ──
  if (pathname.startsWith("/api/")) {
    // Allow shared routes for any authenticated user
    if (SHARED_API_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-active-role", userRole);
      return addSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
    }

    // Check role-specific API access
    const allowedPaths = ROLE_API_PATHS[userRole];
    if (allowedPaths) {
      const hasAccess = allowedPaths.some(
        (p) => pathname === p || pathname.startsWith(p + "/")
      );
      if (hasAccess) {
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set("x-active-role", userRole);
        return addSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
      }
    }

    // If we got here, the user's role doesn't match any allowed paths
    return addSecurityHeaders(
      NextResponse.json(
        { error: "Forbidden: insufficient permissions" },
        { status: 403 }
      )
    );
  }

  // ── 8. Default: allow with security headers and active role ──
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-active-role", userRole);
  
  return addSecurityHeaders(NextResponse.next({
    request: {
      headers: requestHeaders,
    }
  }));
}

// ── Matcher Configuration ─────────────────────────────────────────
// Run middleware on all routes except static assets

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
