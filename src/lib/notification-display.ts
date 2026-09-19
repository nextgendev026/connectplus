/**
 * How a notification reads and where it points.
 *
 * The bell and the notifications page disagreeing about what a notification
 * says is how a sports alert ended up rendered as "Someone kick-off soon" — the
 * social template was applied to every type, and sports notifications have no
 * actor to name. One pure function decides the presentation for both callers so
 * that class of bug is impossible to reintroduce in just one of them.
 *
 * Kept dependency-free (no React, no Prisma) so it is cheap to unit test.
 */

export type NotificationKind =
  | "follow"
  | "comment"
  | "reply"
  | "moderation"
  | "sports"
  | "publish"
  | "payment"
  | "system";

export interface NotificationLike {
  type: string;
  title?: string | null;
  message?: string | null;
  actor?: { name?: string | null; username?: string | null } | null;
  post?: { slug?: string | null; title?: string | null } | null;
}

export function notificationKind(type: string): NotificationKind {
  const t = (type ?? "").toUpperCase();
  // Sports alerts are prefixed at creation (`SPORTS_LIVE`, `SPORTS_KICKOFF`, …)
  // and carry their whole meaning in `message`; there is no actor involved.
  if (t.startsWith("SPORTS_")) return "sports";
  if (t === "FOLLOW") return "follow";
  if (t === "COMMENT") return "comment";
  if (t === "REPLY") return "reply";
  if (t.startsWith("MODERATION")) return "moderation";
  if (t === "POST_PUBLISHED") return "publish";
  // Money moving is its own kind — the reader has to recognise a tip landing
  // from across the room, which is the whole reason the sounds differ at all.
  if (/^(TIP|PAYOUT|PAYMENT|SUBSCRIPTION)/.test(t)) return "payment";
  return "system";
}

/**
 * The sound/vibration voice a push notification should arrive with.
 *
 * The server knows the type and the device knows the motif, so only the kind
 * travels over the wire. Kept here rather than in the push sender so a new
 * notification type inherits its voice by adding one line to `notificationKind`
 * instead of an edit in every sender.
 */
export function pushKindForType(type: string): NotificationKind {
  return notificationKind(type);
}

/** Where tapping the notification should land. */
export function notificationHref(n: NotificationLike): string {
  const kind = notificationKind(n.type);
  // A sports alert is about a fixture, so it opens the board — linking to "/"
  // for every post-less notification made match alerts dead ends.
  if (kind === "sports") return "/sports";
  // Earnings live on the monetization page, which is where a creator can see
  // what actually landed rather than a generic inbox.
  if (kind === "payment") return "/monetize";
  if (n.post?.slug) return `/article/${n.post.slug}`;
  if (n.actor?.username) return `/profile/${n.actor.username}`;
  return "/";
}

function titleCaseType(type: string): string {
  return (type ?? "")
    .replace(/^SPORTS_/, "")
    .toLowerCase()
    .replace(/_/g, " ")
    .trim();
}

export interface NotificationDisplay {
  kind: NotificationKind;
  href: string;
  /** Lead line — who acted, or the headline of the event. */
  headline: string;
  /** Supporting line: what happened, with the fixture or story named. */
  body: string;
}

export function describeNotification(n: NotificationLike): NotificationDisplay {
  const kind = notificationKind(n.type);
  const href = notificationHref(n);

  if (kind === "sports") {
    return {
      kind,
      href,
      headline: n.title?.trim() || "Match update",
      body: n.message?.trim() || "Something changed in a match you follow.",
    };
  }

  // Money notifications are system-generated: there is no actor to name, and
  // naming "Someone" on a payout would be a lie about who paid.
  if (kind === "payment") {
    return {
      kind,
      href,
      headline: n.title?.trim() || "Payment update",
      body: n.message?.trim() || "There is a new update on your earnings.",
    };
  }

  const actor = n.actor?.name?.trim() || (n.actor?.username ? `@${n.actor.username}` : "Someone");
  const fallback =
    kind === "follow"
      ? "started following you."
      : kind === "moderation"
        ? "approved your story."
        : kind === "publish"
          ? "published a new story."
          : kind === "comment"
            ? "commented on your story."
            : kind === "reply"
              ? "replied to your comment."
              : "interacted with your story.";

  // `message` is written server-side as a full sentence ("Someone commented on
  // your story."); prefer it, but strip a duplicated leading actor name.
  let body = (n.message ?? "").trim();
  if (body.toLowerCase().startsWith(actor.toLowerCase())) {
    body = body.slice(actor.length).trim();
  }
  if (!body) body = fallback;

  const onPost = n.post?.title ? ` on ${n.post.title}` : "";
  return { kind, href, headline: actor, body: `${body}${body.endsWith(".") ? "" : "."}${onPost}` };
}
