import { NextResponse } from "next/server";
import { getSiteConfig } from "@/lib/settings";

export const revalidate = 120;

export async function GET() {
  try {
    const config = await getSiteConfig();
    return NextResponse.json({ config }, {
      headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("Error loading public settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}