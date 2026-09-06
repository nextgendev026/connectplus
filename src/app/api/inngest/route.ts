import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";

// POST: Trigger Inngest function manually
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { function: functionName } = body;

    if (!functionName) {
      return NextResponse.json(
        { error: "Function name is required" },
        { status: 400 }
      );
    }

    // Trigger the Inngest function
    await inngest.send({
      name: functionName,
    });

    return NextResponse.json({ 
      success: true, 
      function: functionName,
      message: "Inngest function triggered successfully"
    });
  } catch (error) {
    console.error("Inngest trigger error:", error);
    return NextResponse.json(
      { error: "Failed to trigger Inngest function" },
      { status: 500 }
    );
  }
}

// GET: Health check
export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    status: "ok", 
    message: "Inngest endpoint is active" 
  });
}