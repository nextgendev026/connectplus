import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkStorageQuota, QuotaError } from "@/lib/plans";
import { storeMediaBytes, extensionFor } from "@/lib/media-storage";

const KINDS = new Set(["avatar", "cover", "post"]);

// Per-type size caps (bytes). Overall default is 5MB; GIFs get a larger cap by
// default so longer animations upload cleanly. Any cap can be overridden via
// `MAX_FILE_SIZE` (overall) and `MAX_<TYPE>_SIZE` (per type, e.g. MAX_GIF_SIZE).
const MAX_SIZE = 5 * 1024 * 1024;
const PER_TYPE_LIMITS: Record<string, number> = {
  "image/jpeg": 5 * 1024 * 1024,
  "image/png": 5 * 1024 * 1024,
  "image/webp": 5 * 1024 * 1024,
  "image/gif": 8 * 1024 * 1024,
};

function envBytes(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function maxSizeFor(mimeType: string): number {
  const inferred = PER_TYPE_LIMITS[mimeType] ?? MAX_SIZE;
  const perType = envBytes(`MAX_${mimeType.split("/")[1]?.toUpperCase()}_SIZE`, inferred);
  return Math.min(envBytes("MAX_FILE_SIZE", MAX_SIZE), perType);
}

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

    const ext = extensionFor(file.type);
    // Generated clips are stored through the same helper, but only still images
    // are accepted from a member's upload — the extension map is shared, the
    // accepted set for this route is not.
    if (!ext || !ext.match(/^(jpg|png|webp|gif)$/)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: jpeg, png, webp, gif" },
        { status: 400 }
      );
    }

    const sizeLimit = maxSizeFor(file.type);
    if (file.size > sizeLimit) {
      return NextResponse.json(
        { error: `File size exceeds ${Math.round(sizeLimit / 1024 / 1024)}MB limit for ${file.type.replace("image/", "")} files` },
        { status: 400 }
      );
    }

    // Quota: plans with a storageMb cap throttle new uploads against the
    // bytes the member already owns in the bucket. Staff accounts are exempt.
    const role = (session.user as { role?: string }).role;
    try {
      await checkStorageQuota(session.user.id, role, file.size);
    } catch (err) {
      if (err instanceof QuotaError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
      }
      throw err;
    }

    // Storage lives in lib/media-storage so generated assets take the identical
    // path — Supabase when configured, local ./public/uploads otherwise.
    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      const stored = await storeMediaBytes({
        bytes: buffer,
        mimeType: file.type,
        kind: kindParam as "avatar" | "cover" | "post",
        ownerId: session.user.id,
      });
      return NextResponse.json({ url: stored.url, filename: stored.filename }, { status: 201 });
    } catch (err) {
      console.error("Storage upload failed:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "Upload storage failed" }, { status: 502 });
    }
  } catch (error) {
    console.error("Error uploading file:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}