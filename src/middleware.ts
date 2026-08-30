import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const token = req.cookies.get("ps_session")?.value;
  const path = req.nextUrl.pathname;

  // Paths that need protection
  const isAdminRoute = path.startsWith("/dashboard/admin") || path.startsWith("/api/dashboard/admin");
  const isTeacherRoute = path.startsWith("/dashboard/teacher") || path.startsWith("/api/dashboard/teacher");
  const isStudentRoute = path.startsWith("/dashboard/student") || path.startsWith("/api/dashboard/student");

  // Helper to respond unauthorized
  const unauthorized = () => {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  };

  if (isAdminRoute || isTeacherRoute || isStudentRoute) {
    if (!token) return unauthorized();

    try {
      // Basic payload decoding (Edge compatible)
      const payloadBase64 = token.split(".")[1];
      if (!payloadBase64) return unauthorized();
      
      const payload = JSON.parse(atob(payloadBase64));
      const role = payload.role?.toLowerCase();

      // Route based authorization
      if (isAdminRoute && role !== "admin") {
        return unauthorized();
      }

      // Teachers and Admins can access teacher routes
      if (isTeacherRoute && role !== "teacher" && role !== "admin") {
        return unauthorized();
      }

      // Any authenticated user can access student routes (or restrict to students only if desired)
      if (isStudentRoute && role !== "student" && role !== "admin" && role !== "teacher") {
        return unauthorized();
      }

    } catch (e) {
      console.error("Middleware token decode error", e);
      return unauthorized();
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/dashboard/:path*",
  ],
};
