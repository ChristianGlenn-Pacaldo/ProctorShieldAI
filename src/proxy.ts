import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

const TOKEN_PREFIX = "ps_session_";
const ROLES = ["admin", "teacher", "student"] as const;

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
  "/api/billing/webhook",
  "/api/health",
  "/api/internal/maintenance",
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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

  const targetRole = targetRoleForPage(pathname);
  const candidateRoles = targetRole ? [targetRole] : [...ROLES];
  let tokenName = "";
  let payload = null;

  for (const role of candidateRoles) {
    const name = `${TOKEN_PREFIX}${role}`;
    const token = request.cookies.get(name)?.value;
    if (!token) continue;

    const verified = verifyToken(token);
    if (verified && verified.role.toLowerCase() === role) {
      tokenName = name;
      payload = verified;
      break;
    }
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
    loginUrl.pathname = "/login";
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
