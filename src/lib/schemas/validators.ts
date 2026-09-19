/**
 * Input validation schemas for ConnectPlus.
 *
 * Every API route that accepts user input should validate it at the boundary,
 * not inside the handler — the handler then receives typed data it can trust,
 * and a malformed request gets a 400 with a clear message instead of a 500
 * with a stack trace.
 *
 * These schemas are shared: the frontend can import them for form validation,
 * the API uses them for server-side checks, and the tests assert against them.
 * A single source of truth eliminates the "the server rejected it but the
 * form said it was fine" class of bug.
 *
 * All string lengths are chosen to match the database column limits — a Post
 * title is 500 chars in the schema, and the database column is VARCHAR(500).
 * CUID IDs are validated by shape (25-char alphanumeric) rather than checked
 * against the database, because a database round-trip for validation is a
 * denial-of-service waiting to happen.
 */

import { z } from "zod";

/* ── Shared helpers ──────────────────────────────────────────────────────── */

/** A Prisma CUID — 25 chars of `[a-z0-9]`. */
export const cuid = z.string().regex(/^c[a-z0-9]{24}$/, "Invalid ID format");

/** An optional string that trims whitespace and coerces empty to null. */
export const optionalTrimmed = (max: number) =>
  z.string().max(max).transform((s) => s.trim() || null);

/** A trimmed string that rejects empty values. */
export const requiredTrimmed = (min: number, max: number) =>
  z.string().min(min, `Must be at least ${min} characters`).max(max, `Must be at most ${max} characters`).transform((s) => s.trim());

/** A simple email validation without relying on the browser's built-in. */
const emailSchema = z.string().email("Invalid email address").max(320);

/* ── Authentication ──────────────────────────────────────────────────────── */

export const RegisterSchema = z.object({
  email: emailSchema,
  name: requiredTrimmed(1, 100),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers and underscores"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof LoginSchema>;

/* ── Posts ───────────────────────────────────────────────────────────────── */

export const CreatePostSchema = z.object({
  title: requiredTrimmed(1, 500),
  content: z.string().min(1, "Content is required").max(100_000, "Content must be at most 100,000 characters"),
  excerpt: optionalTrimmed(500),
  coverImage: optionalTrimmed(2048),
  categoryId: z.union([cuid, z.literal("")]).optional().transform((v) => (v === "" ? null : v)),
  tags: z
    .array(z.string().max(50).transform((s) => s.trim().toLowerCase()))
    .max(10, "At most 10 tags")
    .optional()
    .default([]),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional().default("DRAFT"),
  scheduledAt: z.string().datetime().optional(),
  source: optionalTrimmed(500),
  sourceUrl: optionalTrimmed(2048),
});

export type CreatePostInput = z.infer<typeof CreatePostSchema>;

export const UpdatePostSchema = z.object({
  title: requiredTrimmed(1, 500).optional(),
  content: z.string().min(1).max(100_000).optional(),
  excerpt: optionalTrimmed(500),
  coverImage: optionalTrimmed(2048),
  categoryId: z.union([cuid, z.literal("")]).optional().transform((v) => (v === "" ? null : v)),
  tags: z.array(z.string().max(50)).max(10).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  source: optionalTrimmed(500),
  sourceUrl: optionalTrimmed(2048),
});

export type UpdatePostInput = z.infer<typeof UpdatePostSchema>;

/* ── Comments ────────────────────────────────────────────────────────────── */

export const CreateCommentSchema = z.object({
  content: requiredTrimmed(1, 2000),
  postId: cuid,
  parentId: cuid.nullish(),
});

export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;

/* ── Follows ─────────────────────────────────────────────────────────────── */

export const FollowSchema = z.object({
  targetId: cuid,
});

export type FollowInput = z.infer<typeof FollowSchema>;

/* ── Likes ───────────────────────────────────────────────────────────────── */

export const LikeSchema = z.object({
  postId: cuid,
});

export type LikeInput = z.infer<typeof LikeSchema>;

/* ── Bookmarks ───────────────────────────────────────────────────────────── */

export const BookmarkSchema = z.object({
  postId: cuid,
});

export type BookmarkInput = z.infer<typeof BookmarkSchema>;

/* ── Notifications ───────────────────────────────────────────────────────── */

export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url("Invalid subscription endpoint"),
  keys: z.object({
    p256dh: z.string().min(1, "Missing p256dh key"),
    auth: z.string().min(1, "Missing auth key"),
  }),
});

export type PushSubscriptionInput = z.infer<typeof PushSubscriptionSchema>;

/* ── Ads ─────────────────────────────────────────────────────────────────── */

export const CreateAdSchema = z.object({
  title: requiredTrimmed(1, 200),
  imageUrl: z.string().url().max(2048),
  targetUrl: z.string().url().max(2048),
  position: z.enum(["banner", "sidebar", "inline", "footer"]),
  categoryId: cuid.nullish(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  impressions: z.number().int().min(0).max(10_000_000).optional(),
  budget: z.number().min(0).max(1_000_000).optional(),
});

export type CreateAdInput = z.infer<typeof CreateAdSchema>;

/* ── Feedback ────────────────────────────────────────────────────────────── */

export const FeedbackSchema = z.object({
  type: z.enum(["bug", "feature", "improvement", "other"]),
  message: requiredTrimmed(10, 2000),
  url: optionalTrimmed(2048),
});

export type FeedbackInput = z.infer<typeof FeedbackSchema>;

/* ── Writer Application ──────────────────────────────────────────────────── */

export const WriterApplicationSchema = z.object({
  bio: requiredTrimmed(20, 1000),
  portfolioUrl: optionalTrimmed(2048),
  writingSamples: z
    .array(z.string().max(5000))
    .min(1, "Provide at least one writing sample")
    .max(5, "At most 5 writing samples"),
});

export type WriterApplicationInput = z.infer<typeof WriterApplicationSchema>;

/* ── Brain / AI Studio ───────────────────────────────────────────────────── */

export const BrainChatSchema = z.object({
  message: z.string().min(1, "Message is required").max(5000, "Message must be at most 5,000 characters"),
  conversationId: cuid.nullish(),
});

export type BrainChatInput = z.infer<typeof BrainChatSchema>;

export const BrainApprovalDecisionSchema = z.object({
  id: cuid,
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(1000).optional(),
});

export type BrainApprovalDecisionInput = z.infer<typeof BrainApprovalDecisionSchema>;

/* ── Moderation ──────────────────────────────────────────────────────────── */

export const ModerationActionSchema = z.object({
  postId: cuid,
  action: z.enum(["approve", "reject", "flag"]),
  reason: z.string().max(500).optional(),
});

export type ModerationActionInput = z.infer<typeof ModerationActionSchema>;

/* ── Settings ────────────────────────────────────────────────────────────── */

export const UpdateProfileSchema = z.object({
  name: optionalTrimmed(100),
  bio: optionalTrimmed(500),
  avatar: optionalTrimmed(2048),
  coverImage: optionalTrimmed(2048),
  node: optionalTrimmed(500),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

/* ── Search ──────────────────────────────────────────────────────────────── */

export const SearchSchema = z.object({
  q: z.string().min(1, "Search query is required").max(200),
  category: optionalTrimmed(100),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type SearchInput = z.infer<typeof SearchSchema>;

/* ── Sports ──────────────────────────────────────────────────────────────── */

export const SportsPredictionSchema = z.object({
  matchId: cuid,
  prediction: z.enum(["HOME", "AWAY", "DRAW"]),
  stake: z.number().min(0).max(10_000).optional(),
});

export type SportsPredictionInput = z.infer<typeof SportsPredictionSchema>;
