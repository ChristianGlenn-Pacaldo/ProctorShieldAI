import { NextResponse } from "next/server";
import { getScopedSession } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const session = await getScopedSession(req);

    if (!session) {
      return NextResponse.json(
        { authenticated: false, user: null },
        { status: 401 }
      );
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        userId: session.userId,
        email: session.email,
        role: session.role,
        fullName: session.fullName,
      },
    });
  } catch {
    console.error("Session validation unavailable");
    return NextResponse.json(
      { authenticated: false, user: null },
      { status: 503 }
    );
  }
}
