import { extractKeywords, extractEntities } from "@/lib/neural-text";
import { slugify } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";

const log = createLogger("auto-tag");

const BLACKLIST = new Set<string>([
  "story",
  "stories",
  "news",
  "read",
  "people",
  "africa",
  "eastafrica",
  "east-africa",
  "kenya",
  "world",
  "today",
  "year",
  "time",
]);

function cleanKeyword(keyword: string): string | null {
  const cleaned = keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  if (!cleaned || cleaned.length < 3 || BLACKLIST.has(cleaned)) return null;
  return cleaned;
}

/**
 * Automatically derive tags from post text using the neural-text keyword and
 * entity extractors, then attach them to the post. Best-effort; never throws.
 */
export async function autoTagPost(
  postId: string,
  text: string,
  maxTags = 8
): Promise<string[]> {
  try {
    const textForAnalysis = text?.trim() ?? "";
    if (textForAnalysis.length < 20) return [];

    const candidates: string[] = [];
    const seen = new Set<string>();

    for (const kw of extractKeywords(textForAnalysis, 14)) {
      const tag = cleanKeyword(kw.keyword);
      if (tag && !seen.has(tag)) {
        seen.add(tag);
        candidates.push(tag);
      }
    }

    for (const entity of extractEntities(textForAnalysis)) {
      const tag = cleanKeyword(entity.value);
      if (tag && !seen.has(tag)) {
        seen.add(tag);
        candidates.push(tag);
      }
    }

    const chosen = candidates.slice(0, maxTags);
    if (chosen.length === 0) return [];

    const tagIds: string[] = [];
    for (const tag of chosen) {
      const tagSlug = slugify(tag);
      const row = await prisma.tag.upsert({
        where: { slug: tagSlug },
        update: {},
        create: { name: tag, slug: tagSlug },
      });
      tagIds.push(row.id);
    }

    await prisma.post.update({
      where: { id: postId },
      data: { tags: { set: tagIds.map((id) => ({ id })) } },
    });

    return chosen;
  } catch (err: unknown) {
    log.warn("auto-tag failed", { postId, error: err });
    return [];
  }
}