import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { checkEvidenceStorage } from "@/lib/evidence-storage";

export const dynamic = "force-dynamic";

export async function GET() {
  let dependency = "postgresql";
  try {
    await prisma.$queryRaw`SELECT 1`;
    dependency = "redis";
    const redis = getRedis();
    if (!redis || await redis.ping() !== "PONG") throw new Error("Shared cache unavailable");
    dependency = "evidence_storage";
    if (!await checkEvidenceStorage()) throw new Error("Evidence storage unavailable");
    return NextResponse.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error("Readiness check failed:", { dependency });
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
