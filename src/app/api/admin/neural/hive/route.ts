import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hiveBrain } from "@/lib/hive-brain";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    const status = await hiveBrain.status();
    return NextResponse.json({ status });
  } catch (error) {
    console.error("Hive status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    void body;
    const result = await hiveBrain.sweepInternal();
    return NextResponse.json({ result });
  } catch (error) {
    console.error("Hive sweep error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}