import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users CASCADE;`);
    return NextResponse.json({ success: true, message: "All users wiped!" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}
