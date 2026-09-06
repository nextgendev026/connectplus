import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");

    if (!url) {
      return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
    }

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Error fetching share preview:", error);
    return NextResponse.json({ error: "Failed to fetch share preview" }, { status: 500 });
  }
}