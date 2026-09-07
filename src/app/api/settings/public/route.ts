import { NextResponse } from "next/server";
import { getSiteConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = await getSiteConfig();
    return NextResponse.json({ config });
  } catch (error) {
    console.error("Error loading public settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}