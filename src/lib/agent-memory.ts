import { prisma } from "@/lib/prisma";
import { embedText, encodeVector, decodeVector, cosineSimilarity, normalize } from "@/lib/embeddings";
import { normalizeInput, inferChatLanguageMix } from "@/lib/agent-router";

/**
 * The general-purpose agent's memory of one person.
 *
 * Two halves, because they answer different questions:
 *
 *   • **Profile** (`UserProfile`) — the stable facts: a rolling summary of what
 *     the user has been working on, the language mix they write in, their
 *     name. Written by the Inngest `chat/embed` job so a chat turn never pays
 *     for summarisation inline.
 *   • **Recall** (`NeuralMessage.embedding`) — the conversations themselves,
 *     embedded and searchable by cosine similarity, so "what did I ask about
 *     the M-Pesa callback last week?" is a query, not a scroll.
 *
 * The security property is in the WHERE clauses, not the application code:
 * every recall query filters `userId = session user`. A message embedding
 * belongs to a message; a message belongs to a conversation; a conversation
 * belongs to its owner. Another user's memory is not filtered out by a
 * check afterwards — it is unreachable by construction.
 */

/** How many of the user's own past messages a recall brings back. */
export const RECALL_LIMIT = 5;

/** Below this cosine similarity a "match" is noise, not memory. */
const RECALL_THRESHOLD = 0.35;

/** Per-user rolling summary is refreshed at this message cadence. */
export const SUMMARY_EVERY_N_MESSAGES = 10;

/** Profile shape the chat prompt consumes. */
export interface ChatUserProfile {
  name: string | null;
  languageMix: string | null;
  summary: string | null;
}

/**
 * The user's profile, or a null object when they have none yet.
 *
 * Never throws: a missing profile is the normal first-turn state, not an
 * error, and a chat turn must not fail because a row is absent.
 */
export async function loadUserProfile(userId: string): Promise<ChatUserProfile> {
  try {
    const row = await prisma.userProfile.findUnique({
      where: { userId },
      select: { name: true, languageMix: true, summary: true },
    });
    return row ?? { name: null, languageMix: null, summary: null };
  } catch {
    return { name: null, languageMix: null, summary: null };
  }
}

/** Recall the user's own past messages closest to the given text. */
export async function recallUserMemory(
  userId: string,
  query: string,
  limit = RECALL_LIMIT
): Promise<{ id: string; content: string; createdAt: string; score: number }[]> {
  const text = normalizeInput(query);
  if (text.length < 4) return [];

  const vector = normalize(embedText(text));

  // pgvector path — indexed cosine over the user's own rows only.
  try {
    const literal = `[${vector.map((x) => x.toFixed(6)).join(",")}]`;
    const rows = await prisma.$queryRaw<{ id: string; content: string; createdAt: Date; score: number }[]>`
      SELECT id, content, "createdAt",
             (1 - ("embedding" <=> ${literal}::vector)) AS score
      FROM "NeuralMessage"
      WHERE "userId" = ${userId}
        AND "embedding" IS NOT NULL
        AND (1 - ("embedding" <=> ${literal}::vector)) >= ${RECALL_THRESHOLD}
      ORDER BY "embedding" <=> ${literal}::vector
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      content: r.content.slice(0, 400),
      createdAt: new Date(r.createdAt).toISOString(),
      score: Math.round((Number(r.score) || 0) * 1000) / 1000,
    }));
  } catch {
    // pgvector unavailable on this host — portable JSON-scan fallback.
  }

  try {
    const rows = await prisma.neuralMessage.findMany({
      where: { userId, embeddingVec: { not: null } },
      select: { id: true, content: true, createdAt: true, embeddingVec: true },
      take: 500,
      orderBy: { createdAt: "desc" },
    });
    const scored = rows
      .map((r) => ({
        id: r.id,
        content: r.content.slice(0, 400),
        createdAt: r.createdAt.toISOString(),
        score: cosineSimilarity(vector, normalize(decodeVector(r.embeddingVec))),
      }))
      .filter((r) => r.score >= RECALL_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored;
  } catch {
    // The database is unreachable; a chat turn must not fail over memory.
    return [];
  }
}

/**
 * Persist one message's embedding (JSON mirror + pgvector) and denormalised
 * owner. Best-effort and independently caught, like every other embed path in
 * this codebase: memory is an enhancement, never a precondition.
 */
export async function embedAndStoreMessage(messageId: string, content: string): Promise<boolean> {
  const text = normalizeInput(content);
  if (text.length < 4) return false;
  const vector = normalize(embedText(text));
  const literal = `'[${vector.map((x) => x.toFixed(6)).join(",")}]'::vector`;
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "NeuralMessage"
       SET "embeddingVec" = $1, "embedding" = ${literal}
       WHERE id = $2`,
      encodeVector(vector),
      messageId
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Rolling profile update — called from the Inngest `chat/embed` job.
 *
 * The language mix is inferred from marker words on every turn (the same
 * heuristic documented in `inferChatLanguageMix`) because it is free and it
 * changes fast. The rolling summary is a mechanical distillation of the
 * user's last ten messages, refreshed when the tenth lands — not a model
 * call, so the job stays free-tier-safe, and the user's own words are the
 * data; nothing here invents.
 */
export async function updateProfileFromTurn(userId: string, userText: string): Promise<void> {
  const mix = inferChatLanguageMix(userText);
  await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, languageMix: mix, preferences: {} },
    update: { languageMix: mix },
  });
}

/**
 * Rebuild the rolling summary from the user's last N messages.
 *
 * Newest first, one line each, bounded — a prompt-consumable digest of what
 * this person has been talking about, never anyone else's.
 */
export async function refreshRollingSummary(userId: string): Promise<void> {
  const recent = await prisma.neuralMessage.findMany({
    where: { userId, role: "user" },
    orderBy: { createdAt: "desc" },
    take: SUMMARY_EVERY_N_MESSAGES,
    select: { content: true, createdAt: true },
  });
  if (recent.length === 0) return;

  const summary = recent
    .map((m) => `${m.createdAt.toISOString().slice(0, 10)}: ${m.content.replace(/\s+/g, " ").slice(0, 160)}`)
    .join("\n");

  await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, summary, preferences: {} },
    update: { summary },
  });
}
