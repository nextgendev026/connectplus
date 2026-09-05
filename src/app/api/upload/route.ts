import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_SIZE = 5 * 1024 * 1024;
const KINDS = new Set(["avatar", "cover", "post"]);

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const kindParam = (formData.get("kind") as string | null) ?? "post";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!KINDS.has(kindParam)) {
      return NextResponse.json({ error: "Invalid upload kind" }, { status: 400 });
    }

    const ext = ALLOWED_TYPES[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: jpeg, png, webp, gif" },
        { status: 400 }
      );
    }

    const sizeLimit = parseInt(process.env.MAX_FILE_SIZE ?? String(MAX_SIZE), 10) || MAX_SIZE;
    if (file.size > sizeLimit) {
      return NextResponse.json(
        { error: `File size exceeds ${Math.round(sizeLimit / 1024 / 1024)}MB limit` },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const filename = `${randomUUID()}.${ext}`;

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;

    if (supabaseUrl && serviceKey) {
      // Supabase Storage (persists across deploys, CDN-servable public bucket).
      const objectKey = `${kindParam}/${session.user.id}/${filename}`;
      const uploadUrl = `${supabaseUrl}/storage/v1/object/${objectKey}`;

      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": file.type,
        },
        body: buffer,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("Storage upload failed:", res.status, body.slice(0, 300));
        return NextResponse.json({ error: "Upload storage failed" }, { status: 502 });
      }

      const url = `${supabaseUrl}/storage/v1/object/public/${objectKey}`;
      return NextResponse.json({ url, filename }, { status: 201 });
    }

    // Local fallback (development / offline): writes to ./public/uploads.
    const uploadDir = join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, filename), buffer);

    return NextResponse.json({ url: `/uploads/${filename}`, filename }, { status: 201 });
  } catch (error) {
    console.error("Error uploading file:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}