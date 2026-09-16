import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { createLogger } from "@/lib/logger";

/**
 * One implementation of "put these bytes somewhere publicly reachable".
 *
 * The upload route had this logic inline, and generated assets need the same
 * thing. Duplicating it would mean two places to fix when the bucket name
 * changes or Supabase's response handling needs to change — and a bug in the
 * copy would only show up on whichever path was less exercised. So the write is
 * extracted here and the route calls it.
 *
 * Supabase Storage is used when configured, because it survives a deploy and is
 * CDN-servable. The local `public/uploads` fallback exists for development and
 * offline work; it is not durable on a serverless host, which is why the
 * environment is reported back to the caller rather than hidden.
 */

const log = createLogger("media-storage");

export type StorageKind = "avatar" | "cover" | "post" | "generated";

export interface StoredMedia {
  url: string;
  filename: string;
  bytes: number;
  mimeType: string;
  storage: "supabase" | "local";
}

/** Extensions accepted per MIME type. Video is included for generated clips. */
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function extensionFor(mimeType: string): string | null {
  return EXTENSION_BY_MIME[mimeType] ?? null;
}

export async function storeMediaBytes(input: {
  /**
   * Typed as `Uint8Array` rather than `Buffer` on purpose: a bare `Buffer`
   * parameter widens to `Buffer<ArrayBufferLike>`, which fetch's `BodyInit`
   * rejects. `Buffer.from` re-narrows it to the `ArrayBuffer`-backed variant the
   * DOM typings accept, which is the same path the upload route already uses.
   */
  bytes: Uint8Array;
  mimeType: string;
  kind: StorageKind;
  /** Used to namespace the object key. Generated assets are parked under one. */
  ownerId: string;
}): Promise<StoredMedia> {
  const ext = EXTENSION_BY_MIME[input.mimeType];
  if (!ext) throw new Error(`Unsupported media type: ${input.mimeType}`);

  const filename = `${randomUUID()}.${ext}`;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "uploads";

  if (supabaseUrl && serviceKey) {
    const objectKey = `${input.kind}/${input.ownerId}/${filename}`;
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectKey}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": input.mimeType,
      },
      body: Buffer.from(input.bytes),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error("storage upload failed", { status: res.status, body: body.slice(0, 200) });
      throw new Error(`Storage upload failed with ${res.status}`);
    }

    return {
      url: `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectKey}`,
      filename,
      bytes: input.bytes.length,
      mimeType: input.mimeType,
      storage: "supabase",
    };
  }

  const uploadDir = join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });
  await writeFile(join(uploadDir, filename), input.bytes);

  log.warn("stored media locally — not durable on serverless hosts", { filename, bytes: input.bytes.length });

  return {
    url: `/uploads/${filename}`,
    filename,
    bytes: input.bytes.length,
    mimeType: input.mimeType,
    storage: "local",
  };
}
