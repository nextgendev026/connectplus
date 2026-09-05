import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hiveBrain } from "@/lib/hive-brain";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    const result = await hiveBrain.train();
    return NextResponse.json({ result });
  } catch (error) {
    console.error("Neural train error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}