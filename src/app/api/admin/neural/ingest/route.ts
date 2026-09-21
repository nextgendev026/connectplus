import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { extractKeywords, stripHtml, summarizeText, wordCount } from "@/lib/neural-text";
import { contentHash, deriveProvenance } from "@/lib/memory-provenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Research material an operator hands the mind directly.
 *
 * The web-research path (`/api/admin/neural/knowledge`) can only learn about a
 * subject the open web already covers. An operator often holds material we
 * cannot search for at all — an internal brief, a pasted earnings table, a
 * research note that is not indexed — and until now there was nowhere to put it.
 *
 * The upload is filed with the *same* shape live web research uses:
 * `source: "external"`, `category: "external_knowledge"`. That is deliberate and
 * not cosmetic. Retrieval selects on those two fields, so a row filed under a new
 * category would be stored, listed in the console, and never read — which is a
 * worse outcome than not accepting the upload, because it looks like it worked.
 * Provenance is what distinguishes the two origins: `sourceType: "operator"`
 * carries a higher reliability and an `observed` verification than scraped text.
 *
 * Idempotent on content hash: re-uploading the same document refreshes nothing
 * and does not stack a near-identical row that would skew keyword recall.
 */

const log = createLogger("admin-ingest");

/** Enough for a brief or a dataset description; not enough to exhaust a prompt. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Stored memory body. The rest of the document is summarised into it. */
const MAX_STORED_CHARS = 2_000;

/**
 * Text formats only, and by content type where the browser gives one.
 *
 * PDFs and office documents are refused rather than accepted and mangled: there
 * is no parser in this codebase, so a binary would be stored as noise that
 * matches nothing while claiming to be knowledge. Saying so is more useful than
 * silently producing a memory full of `%PDF-1.4`.
 */
const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "text/html",
  "text/xml",
  "application/json",
  "application/xml",
  "application/xhtml+xml",
]);

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".html", ".htm", ".xml", ".log", ".rst"];

function looksTextual(name: string, type: string): boolean {
  if (type && TEXT_TYPES.has(type.toLowerCase())) return true;
  if (type && !type.startsWith("text/") && !TEXT_TYPES.has(type.toLowerCase())) {
    // A declared binary type is a refusal even when the extension looks harmless.
    return false;
  }
  const lower = name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function requireAdmin() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") return null;
  return session;
}

export interface IngestResult {
  filename: string;
  ok: boolean;
  /** Why it was refused, when it was. */
  reason?: string;
  /** True when the identical document was already in memory. */
  duplicate?: boolean;
  memoryId?: string;
  characters?: number;
  words?: number;
  keywords?: string[];
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected a multipart upload." }, { status: 400 });
  }

  const entries = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "text" in f);
  const single = form.get("file");
  const files: File[] = entries.length > 0 ? entries : single instanceof File ? [single] : [];

  if (files.length === 0) {
    return NextResponse.json({ error: "Attach at least one text file." }, { status: 400 });
  }

  const rawTags = form.getAll("tags").flatMap((t) => String(t).split(","));
  const extraTags = rawTags
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length < 24)
    .slice(0, 8);

  const results: IngestResult[] = [];

  for (const file of files.slice(0, 10)) {
    const name = file.name || "upload";

    if (file.size > MAX_UPLOAD_BYTES) {
      results.push({
        filename: name,
        ok: false,
        reason: `Larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB. Split it or summarise it first.`,
      });
      continue;
    }
    if (!looksTextual(name, file.type)) {
      results.push({
        filename: name,
        ok: false,
        reason: "Only text formats are readable here (txt, md, csv, json, html, xml).",
      });
      continue;
    }

    const raw = await file.text().catch(() => "");
    // HTML is stripped to its text rather than stored with its markup: the
    // stored body becomes a prompt fragment, and tags in a prompt are noise that
    // costs tokens on every future retrieval.
    const cleaned = (name.toLowerCase().endsWith(".html") || name.toLowerCase().endsWith(".htm") ? stripHtml(raw) : raw)
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length < 120) {
      results.push({ filename: name, ok: false, reason: "No usable text found in that file." });
      continue;
    }

    const hash = contentHash(cleaned);

    // Deduped on content, not filename: the same brief re-saved under a new name
    // is the same knowledge, and stacking it would double its weight in keyword
    // recall for no gain.
    const existing = await prisma.neuralMemory
      .findFirst({ where: { sourceHash: hash }, select: { id: true } })
      .catch(() => null);
    if (existing) {
      results.push({ filename: name, ok: true, duplicate: true, memoryId: existing.id, characters: cleaned.length });
      continue;
    }

    const keywords = extractKeywords(cleaned, 12).map((k) => k.keyword);
    const summary = summarizeText(cleaned, 4);
    const body = `${name} — ${summary}`.slice(0, MAX_STORED_CHARS);

    const provenance = deriveProvenance({
      content: cleaned,
      // The operator vouched for this document by uploading it, which is a
      // different standing from something a crawler found. `operator` says so.
      sourceType: "operator",
      sourceHash: hash,
      scope: "platform",
      sensitivity: "internal",
      verificationStatus: "observed",
      // An uploaded document has no publication date we can trust, so the
      // observation is deliberately "when we read it".
      observedAt: new Date(),
      expiresAt: null,
    });

    const created = await prisma.neuralMemory
      .create({
        data: {
          source: "external",
          category: "external_knowledge",
          content: body,
          tags: [name.replace(/\.[a-z0-9]+$/i, "").toLowerCase(), ...keywords, ...extraTags, "upload"].join(","),
          confidence: provenance.sourceReliability,
          metadata: JSON.stringify({
            kind: "operator_upload",
            filename: name,
            uploadedBy: session.user.id,
            uploadedAt: new Date().toISOString(),
            characters: cleaned.length,
            words: wordCount(cleaned),
            summary,
            provenanceNotes: provenance.notes,
          }),
          sourceUrl: null,
          sourceType: provenance.sourceType,
          sourceHash: provenance.sourceHash,
          sourceReliability: provenance.sourceReliability,
          observedAt: provenance.observedAt,
          expiresAt: provenance.expiresAt,
          verificationStatus: provenance.verificationStatus,
          scope: "platform",
          sensitivity: "internal",
        },
        select: { id: true },
      })
      .catch(() => null);

    if (!created) {
      results.push({ filename: name, ok: false, reason: "The memory could not be written." });
      continue;
    }

    results.push({
      filename: name,
      ok: true,
      memoryId: created.id,
      characters: cleaned.length,
      words: wordCount(cleaned),
      keywords: keywords.slice(0, 6),
    });
  }

  const stored = results.filter((r) => r.ok && !r.duplicate).length;
  const duplicates = results.filter((r) => r.duplicate).length;
  const refused = results.filter((r) => !r.ok).length;

  log.info("operator material ingested", { stored, duplicates, refused, files: files.length });

  return NextResponse.json({
    results,
    stored,
    duplicates,
    refused,
    // Says which of the three things happened rather than reporting a bare count,
    // because "already known" and "could not read it" need different responses.
    note:
      stored > 0
        ? `Filed ${stored} document${stored === 1 ? "" : "s"}.${duplicates ? ` ${duplicates} already known.` : ""}`
        : duplicates > 0
          ? "Already in memory — nothing new was filed."
          : "Nothing could be read from those files.",
  });
}
