import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { generateText } from "@/lib/ai-provider";
import { paintThumb } from "@/lib/thumb-svg";
import { extractKeywords } from "@/lib/neural-text";
import { visualStudio, buildImagePrompt } from "@/lib/visual-studio";

/**
 * Action tools for the combined mind.
 *
 * Until now the mind could only *talk* — every answer was a report. These are
 * the hands: schedule and publish posts, triage comments, and draft the visuals
 * that go with a story.
 *
 * Hardening rules, all enforced here rather than trusted to a caller:
 *
 *  - Anything destructive or publicly visible demands `confirm: true`. Without
 *    it the tool returns a preview of exactly what it *would* do and changes
 *    nothing. A language model mistaking a request for a command must not be
 *    able to publish to production on its own.
 *  - Every mutation writes an audit row where a ledger exists (`ModerationLog`)
 *    or returns the before/after state, so a change can be attributed.
 *  - A missing record is a typed failure, not an exception, so the mind can
 *    report "that post no longer exists" instead of a stack trace.
 */

const log = createLogger("mind-actions");

export interface ActionResult {
  ok: boolean;
  action: string;
  /** Human-readable one-liner the mind can speak verbatim. */
  summary: string;
  /** True when the call changed nothing pending explicit confirmation. */
  needsConfirmation?: boolean;
  detail?: Record<string, unknown>;
  error?: string;
}

/**
 * States a post can be scheduled from.
 *
 * A schedule in this app is `status: "DRAFT"` + a future `scheduledAt` — that
 * is exactly what `runPublishScheduled` sweeps for, and what the Studio writes.
 * Inventing a separate "SCHEDULED" status here would produce a post that no job
 * ever publishes and that the Studio cannot filter, so the convention is
 * followed rather than extended.
 */
const SCHEDULABLE = new Set(["DRAFT"]);

class MindActions {
  private readonly log = createLogger("mind-actions");

  // ── Publishing ──────────────────────────────────────────────────────────

  /**
   * Put a draft on a schedule. The post keeps `status: DRAFT` and gains a
   * future `scheduledAt`; `runPublishScheduled` picks it up when due.
   */
  async schedulePost(input: { postId: string; when: Date | string; confirm?: boolean }): Promise<ActionResult> {
    const when = input.when instanceof Date ? input.when : new Date(input.when);
    if (Number.isNaN(when.getTime())) {
      return { ok: false, action: "schedule_post", summary: "I could not read that date — give me an explicit date and time.", error: "invalid_date" };
    }
    if (when.getTime() < Date.now() - 60_000) {
      return { ok: false, action: "schedule_post", summary: "That time is in the past. Pick a future slot or use publish instead.", error: "past_date" };
    }

    const post = await prisma.post.findUnique({ where: { id: input.postId }, select: { id: true, title: true, status: true, scheduledAt: true } });
    if (!post) return { ok: false, action: "schedule_post", summary: `No post with id ${input.postId}.`, error: "not_found" };
    if (!SCHEDULABLE.has(post.status)) {
      return {
        ok: false,
        action: "schedule_post",
        summary: `"${post.title}" is already ${post.status} — only drafts can carry a schedule.`,
        error: "not_schedulable",
      };
    }

    if (!input.confirm) {
      return {
        ok: true,
        action: "schedule_post",
        needsConfirmation: true,
        summary: `Ready to schedule "${post.title}" for ${when.toISOString()}. Confirm and I will set it.`,
        detail: { postId: post.id, title: post.title, status: post.status, scheduledAt: when.toISOString() },
      };
    }

    // Status stays DRAFT: the cron job publishes on `scheduledAt`, and the
    // Studio's own scheduling UI reads the same pair.
    await prisma.post.update({ where: { id: post.id }, data: { scheduledAt: when } });
    this.log.info("post scheduled", { postId: post.id, scheduledAt: when.toISOString() });
    return {
      ok: true,
      action: "schedule_post",
      summary: `"${post.title}" is scheduled for ${when.toISOString()} — it publishes automatically when that time arrives.`,
      detail: { postId: post.id, status: "DRAFT", scheduledAt: when.toISOString() },
    };
  }

  /** Publish immediately. Explicitly confirmed, never implicit. */
  async publishPost(input: { postId: string; confirm?: boolean }): Promise<ActionResult> {
    const post = await prisma.post.findUnique({
      where: { id: input.postId },
      select: { id: true, title: true, status: true, slug: true, moderationStatus: true },
    });
    if (!post) return { ok: false, action: "publish_post", summary: `No post with id ${input.postId}.`, error: "not_found" };
    if (post.status === "PUBLISHED") {
      return { ok: true, action: "publish_post", summary: `"${post.title}" is already live.`, detail: { postId: post.id, slug: post.slug } };
    }
    if (post.moderationStatus === "REJECTED" || post.moderationStatus === "FLAGGED") {
      return {
        ok: false,
        action: "publish_post",
        summary: `"${post.title}" is ${post.moderationStatus} — publishing it would skip moderation. Clear it there first.`,
        error: "blocked_by_moderation",
      };
    }

    if (!input.confirm) {
      return {
        ok: true,
        action: "publish_post",
        needsConfirmation: true,
        summary: `"${post.title}" is currently ${post.status}. Confirm and it goes live now.`,
        detail: { postId: post.id, from: post.status, to: "PUBLISHED" },
      };
    }

    await prisma.post.update({
      where: { id: post.id },
      data: { status: "PUBLISHED", publishedAt: new Date(), scheduledAt: null },
    });
    this.log.info("post published", { postId: post.id, slug: post.slug });
    return {
      ok: true,
      action: "publish_post",
      summary: `"${post.title}" is live at /posts/${post.slug}.`,
      detail: { postId: post.id, slug: post.slug },
    };
  }

  // ── Comment management ──────────────────────────────────────────────────

  /**
   * Rank a post's comments by community approval so the ones worth pinning
   * surface without an editor reading every reply.
   *
   * Suspicion is scored first — a comment that looks like spam is listed as
   * spam even when it has likes, because link-farm comments are routinely
   * upvoted by the same network that posts them.
   */
  async surfaceTopReplies(input: { postId: string; limit?: number }): Promise<ActionResult> {
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);

    const post = await prisma.post.findUnique({ where: { id: input.postId }, select: { id: true, title: true } });
    if (!post) return { ok: false, action: "surface_replies", summary: `No post with id ${input.postId}.`, error: "not_found" };

    const comments = await prisma.comment.findMany({
      where: { postId: post.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        content: true,
        createdAt: true,
        author: { select: { username: true, isVerified: true } },
        _count: { select: { likes: true, replies: true } },
      },
    });

    const scored = comments.map((c) => {
      const suspicion = spamScore(c.content);
      return {
        id: c.id,
        author: c.author.username,
        verified: c.author.isVerified,
        excerpt: c.content.slice(0, 220),
        likes: c._count.likes,
        replies: c._count.replies,
        suspicion,
        createdAt: c.createdAt.toISOString(),
      };
    });

    const top = [...scored].sort((a, b) => b.likes * 2 + b.replies - (a.likes * 2 + a.replies)).slice(0, limit);
    const spam = scored.filter((c) => c.suspicion >= 0.5).sort((a, b) => b.suspicion - a.suspicion).slice(0, limit);
    const lead = top[0];

    return {
      ok: true,
      action: "surface_replies",
      summary:
        `"${post.title}" has ${comments.length} comments. ` +
        (lead ? `Top reply: @${lead.author} with ${lead.likes} likes. ` : "") +
        (spam.length > 0 ? `${spam.length} look like spam.` : "Nothing looks like spam."),
      detail: { postId: post.id, title: post.title, top, spam },
    };
  }

  /**
   * Log a comment as spam. Comments have no moderation column, so the existing
   * `ModerationLog` ledger is used — the row points at the comment's post and
   * names the comment id in `reason`, which keeps the audit trail in one place
   * rather than inventing a parallel table.
   */
  async flagComment(input: { commentId: string; moderatorId: string; reason?: string; confirm?: boolean }): Promise<ActionResult> {
    const comment = await prisma.comment.findUnique({
      where: { id: input.commentId },
      select: { id: true, content: true, postId: true, author: { select: { username: true } } },
    });
    if (!comment) return { ok: false, action: "flag_comment", summary: `No comment with id ${input.commentId}.`, error: "not_found" };

    const reason = input.reason ?? `Flagged by neural mind (spam score ${spamScore(comment.content).toFixed(2)})`;

    if (!input.confirm) {
      return {
        ok: true,
        action: "flag_comment",
        needsConfirmation: true,
        summary: `I will log @${comment.author.username}'s comment as flagged. Confirm to record it.`,
        detail: { commentId: comment.id, postId: comment.postId, reason },
      };
    }

    const entry = await prisma.moderationLog.create({
      data: {
        postId: comment.postId,
        moderatorId: input.moderatorId,
        action: "FLAG",
        reason: `comment:${comment.id} ${reason}`,
        aiScore: spamScore(comment.content),
        aiFlags: JSON.stringify({ kind: "comment", commentId: comment.id }),
      },
    });

    this.log.info("comment flagged", { commentId: comment.id, logId: entry.id });
    return {
      ok: true,
      action: "flag_comment",
      summary: `Logged @${comment.author.username}'s comment as flagged (audit entry ${entry.id}).`,
      detail: { commentId: comment.id, logId: entry.id, postId: comment.postId },
    };
  }

  /**
   * Delete a comment. The only irreversible action here, so it is double-gated:
   * `confirm` must be true AND the caller must say why removal (rather than a
   * flag) is the right call. Replies cascade, which is stated in the result.
   */
  async removeComment(input: { commentId: string; moderatorId: string; reason: string; confirm?: boolean }): Promise<ActionResult> {
    const comment = await prisma.comment.findUnique({
      where: { id: input.commentId },
      select: { id: true, content: true, postId: true, author: { select: { username: true } }, _count: { select: { replies: true } } },
    });
    if (!comment) return { ok: false, action: "remove_comment", summary: `No comment with id ${input.commentId}.`, error: "not_found" };
    if (!input.reason || input.reason.trim().length < 4) {
      return { ok: false, action: "remove_comment", summary: "Removal needs a reason of a few words before I will delete anything.", error: "reason_required" };
    }
    if (!input.confirm) {
      return {
        ok: true,
        action: "remove_comment",
        needsConfirmation: true,
        summary:
          `This deletes @${comment.author.username}'s comment` +
          (comment._count.replies > 0 ? ` and ${comment._count.replies} replies underneath it` : "") +
          ". Confirm to delete, or flag it instead to keep the record.",
        detail: { commentId: comment.id, cascades: comment._count.replies, reason: input.reason },
      };
    }

    // Audit before deleting: the ledger row must survive the comment.
    await prisma.moderationLog.create({
      data: {
        postId: comment.postId,
        moderatorId: input.moderatorId,
        action: "REJECT",
        reason: `comment:${comment.id} removed — ${input.reason}`,
        aiScore: spamScore(comment.content),
        aiFlags: JSON.stringify({ kind: "comment", commentId: comment.id, excerpt: comment.content.slice(0, 200) }),
      },
    });

    await prisma.comment.delete({ where: { id: comment.id } });
    this.log.warn("comment removed", { commentId: comment.id, cascades: comment._count.replies });

    return {
      ok: true,
      action: "remove_comment",
      summary: `Removed @${comment.author.username}'s comment${comment._count.replies > 0 ? ` and ${comment._count.replies} replies` : ""}. The reason is on the moderation log.`,
      detail: { commentId: comment.id, cascades: comment._count.replies },
    };
  }

  /**
   * Draft a reply to a comment, grounded in the post it sits under. Returns a
   * draft only — it never posts. Community replies are the author's voice, and
   * sending one automatically is how a platform starts sounding like a bot.
   */
  async draftReply(input: { commentId: string; tone?: string; maxChars?: number }): Promise<ActionResult> {
    const comment = await prisma.comment.findUnique({
      where: { id: input.commentId },
      select: {
        id: true,
        content: true,
        author: { select: { username: true } },
        post: { select: { title: true, excerpt: true, content: true, category: { select: { name: true } } } },
      },
    });
    if (!comment) return { ok: false, action: "draft_reply", summary: `No comment with id ${input.commentId}.`, error: "not_found" };

    const tone = input.tone ?? "warm, direct, no corporate filler";
    const maxChars = Math.min(Math.max(input.maxChars ?? 420, 80), 1200);

    const draft = await generateText({
      system:
        "You write replies for the author of a published story on an East African publishing platform. " +
        `Tone: ${tone}. Reply in the same language the commenter used. ` +
        "Never thank the commenter for the comment, never say 'great question', never promise a follow-up you cannot make. " +
        "Answer or engage with the substance. Maximum 120 words, plain text, no markdown, no greeting boilerplate.",
      user: [`STORY: ${comment.post.title}`, comment.post.excerpt ? `EXCERPT: ${comment.post.excerpt}` : "", `COMMENTER (@${comment.author.username}): ${comment.content.slice(0, 900)}`]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 300,
    }).catch(() => null);

    if (!draft) {
      return {
        ok: false,
        action: "draft_reply",
        summary: "No model is configured, so I cannot draft a reply right now. Add an AI key in the console and ask again.",
        error: "no_model",
      };
    }

    const trimmed = draft.trim().slice(0, maxChars);
    return {
      ok: true,
      action: "draft_reply",
      summary: `Draft reply to @${comment.author.username} (not sent — copy it in when you are happy):\n\n${trimmed}`,
      detail: { commentId: comment.id, author: comment.author.username, draft: trimmed, sent: false },
    };
  }

  // ── Visuals ─────────────────────────────────────────────────────────────

  /**
   * Produce a visual for a story: an actual generated image, stored and URL-able
   * as a cover.
   *
   * This used to return a prompt plus a typographic SVG and call that a visual.
   * It now generates the image for real — OpenAI Images when a key is configured,
   * otherwise a keyless provider — and stores it, so the caller gets a URL it can
   * put on a post.
   *
   * The SVG poster is still rendered and still returned, but its role changed: it
   * is the fallback that guarantees the brief is useful even when every image
   * provider is unreachable, rather than the whole deliverable.
   */
  async generateVisualBrief(input: {
    title: string;
    category?: string;
    author?: string;
    format?: "cover" | "feature" | "short-form";
    /** Storage namespace. Defaults to the mind's own folder. */
    ownerId?: string;
    /** Skip the image call and return the brief only. */
    skipGeneration?: boolean;
  }): Promise<ActionResult> {
    const title = input.title?.trim();
    if (!title) return { ok: false, action: "visual_brief", summary: "Give me the story title and I will build the visual.", error: "title_required" };

    const format = input.format ?? "cover";
    const category = input.category ?? "Story";
    const author = input.author ?? "";
    const ownerId = input.ownerId ?? "neural-mind";
    const keywords = extractKeywords(title, 5).map((k) => k.keyword);
    const aspect = format === "short-form" ? "9:16 vertical" : format === "feature" ? "16:9 wide" : "3:2 landscape";
    const prompt = buildImagePrompt({ title, category, format });
    const size = format === "short-form" ? "1024x1536" : format === "feature" ? "1536x1024" : "1024x1024";

    const svg = paintThumb({ title, category, author, seed: `${title}:${category}` });

    let image: Awaited<ReturnType<typeof visualStudio.generateImage>> | null = null;
    if (!input.skipGeneration) {
      image = await visualStudio.generateImage({ prompt, size, ownerId });
      if (!image.ok) {
        this.log.warn("image generation failed", { title, error: image.error });
      } else {
        this.log.info("visual generated", { title, provider: image.provider, url: image.url });
      }
    }

    const summary = image?.ok
      ? `Image generated for "${title}" (${format}, ${aspect}) with ${image.provider}. Ready to use as the cover: ${image.url}`
      : `Visual brief ready for "${title}" (${format}, ${aspect}). Image generation did not run${image?.error ? `: ${image.error}` : ""} — the prompt and the SVG cover are below.`;

    return {
      ok: true,
      action: "visual_brief",
      summary,
      detail: {
        title,
        format,
        aspect,
        prompt,
        keywords,
        image: image
          ? { ok: image.ok, provider: image.provider, url: image.url, size: image.size, bytes: image.media?.bytes ?? null, storage: image.media?.storage ?? null, error: image.error ?? null, notes: image.notes }
          : null,
        thumbnail: { format: "svg", bytes: svg.length, svg },
      },
    };
  }

  /**
   * Generate a short video for a story.
   *
   * Wraps the adapter in visual-studio, which is deliberately not pointed at
   * OpenAI's Sora API — that API is documented to shut down permanently on
   * 2026-09-24, so wiring it would ship a feature with a known expiry date.
   * Without a configured endpoint this reports `unavailable` and says why, which
   * is a truthful answer; returning a fabricated URL would not be.
   */
  async generateVideoClip(input: { title: string; ownerId?: string; seconds?: 4 | 8 | 12; format?: "feature" | "short-form" }): Promise<ActionResult> {
    const title = input.title?.trim();
    if (!title) return { ok: false, action: "generate_video", summary: "Give me the story title and I will build the clip.", error: "title_required" };

    const format = input.format ?? "short-form";
    const prompt = buildImagePrompt({ title, format });
    const video = await visualStudio.generateVideo({
      prompt,
      ownerId: input.ownerId ?? "neural-mind",
      seconds: input.seconds ?? (format === "short-form" ? 4 : 8),
      size: format === "feature" ? "1536x1024" : "1024x1536",
    });

    return {
      ok: video.ok,
      action: "generate_video",
      summary: video.ok
        ? video.status === "completed"
          ? `Clip rendered for "${title}": ${video.media?.url}`
          : `Clip queued for "${title}" (job ${video.jobId}, ${video.progress ?? 0}% done). It keeps rendering — check back with the job id.`
        : `Video is unavailable: ${video.reason}`,
      error: video.ok ? undefined : "unavailable",
      detail: { title, format, prompt, status: video.status, provider: video.provider, jobId: video.jobId, progress: video.progress, url: video.media?.url ?? null, notes: video.notes },
    };
  }
}

/**
 * Cheap, explainable spam signal: link density, contact-solicitation markers
 * and shouty formatting. Deliberately not a model — a moderation decision must
 * be defensible to the person it acts on, and a 0.83 with reasons is.
 */
export function spamScore(content: string): number {
  const text = content.trim();
  if (!text) return 0;
  let score = 0;

  const links = text.match(/https?:\/\/\S+/g)?.length ?? 0;
  if (links >= 3) score += 0.5;
  else if (links === 2) score += 0.3;
  else if (links === 1) score += 0.15;

  if (/(whatsapp|\+254|\+256|\+255|\+250|call me|dm me|inbox me|telegram t\.me)/i.test(text)) score += 0.35;
  if (/(loan|forex|crypto|bitcoin|invest now|double your|earn \$?\d+|betting|aviator|1xbet)/i.test(text)) score += 0.35;
  if (/(viagra|casino|escort|porn|adult dating)/i.test(text)) score += 0.5;
  if (text.length > 40 && text === text.toUpperCase()) score += 0.2;
  if ((text.match(/!/g)?.length ?? 0) >= 5) score += 0.1;
  if (text.length < 6 && links > 0) score += 0.2;

  return Math.min(Math.round(score * 100) / 100, 1);
}

export const mindActions = new MindActions();
