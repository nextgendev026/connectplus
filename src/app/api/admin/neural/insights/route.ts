import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { neuralMind } from "@/lib/neural-mind";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const userRole = (session.user as any).role;
    if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const insights = await neuralMind.getInsights();
    return NextResponse.json({ insights });
  } catch (error) {
    console.error("Neural insights error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
