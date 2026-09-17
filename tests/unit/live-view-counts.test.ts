import { describe, expect, it } from "vitest";
import { convexViewCounts, mergeLiveViewCounts } from "../../src/lib/convex";

/**
 * The overlay that makes a feed card's view count true.
 *
 * `Post.viewCount` is only brought up to date by a nightly fold of Convex's view
 * deltas — and the home pool is additionally served from Redis for up to six
 * hours — so the number on a card drifted from the number on the article page it
 * pointed at. The article page has always read the live Convex total; these
 * tests pin the card side of the same rule.
 *
 * The two ways this can go wrong are both silent, which is why they are pinned
 * here rather than left to review: a count that moves *downwards* (a Convex row
 * folded into Postgres and reset) and a count that is zeroed because Convex has
 * never heard of the post (every story imported since the offload).
 */

interface Card {
  id: string;
  title: string;
  viewCount: number;
}

const card = (id: string, viewCount: number, title = `Story ${id}`): Card => ({
  id,
  title,
  viewCount,
});

/** The single card a one-post overlay returns. Destructuring would give
 *  `Card | undefined`, since the project compiles with
 *  `noUncheckedIndexedAccess` — the assertion says which is intended. */
function only(rows: Card[]): Card {
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("merging live view counts into a page of posts", () => {
  it("raises a stale stored count to the live total", () => {
    const post = only(mergeLiveViewCounts([card("a", 40)], new Map([["a", 5075]])));
    expect(post.viewCount).toBe(5075);
  });

  it("keeps the live count on a syndicated story that stored zero", () => {
    // Every RSS import is created with `viewCount: 0`, so without the overlay
    // the card read "0 views" for the whole day its article page showed the
    // real figure.
    const post = only(mergeLiveViewCounts([card("rss-1", 0)], new Map([["rss-1", 812]])));
    expect(post.viewCount).toBe(812);
  });

  it("never lets a count move backwards", () => {
    // Convex's own row can legitimately be behind Postgres: the nightly sync
    // applies a delta and moves the counter it has already reported.
    const original = card("a", 900);
    const post = only(mergeLiveViewCounts([original], new Map([["a", 120]])));
    expect(post.viewCount).toBe(900);
    // Unchanged, and the very same object — nothing to re-render.
    expect(post).toBe(original);
  });

  it("leaves a post Convex has never seen exactly as it was", () => {
    const original = card("native", 321);
    const post = only(mergeLiveViewCounts([original], new Map([["other", 9999]])));
    expect(post).toBe(original);
    expect(post.viewCount).toBe(321);
  });

  it("ignores a malformed live value instead of blanking the card", () => {
    const original = card("a", 55);
    expect(only(mergeLiveViewCounts([original], new Map([["a", Number.NaN]])))).toBe(original);
    expect(
      only(mergeLiveViewCounts([original], new Map([["a", Number.POSITIVE_INFINITY as number]])))
    ).toBe(original);
  });

  it("survives a stored count that is not a number", () => {
    const broken = { id: "a", title: "Story", viewCount: Number.NaN } as Card;
    const post = only(mergeLiveViewCounts([broken], new Map([["a", 7]])));
    expect(post.viewCount).toBe(7);
  });

  it("passes the list straight through when Convex has nothing to say", () => {
    // The common case on an unconfigured or unreachable deployment: no
    // allocation, no copying, no behaviour change.
    const posts = [card("a", 1), card("b", 2)];
    expect(mergeLiveViewCounts(posts, new Map())).toBe(posts);
  });

  it("does not disturb the other fields on a card", () => {
    const post = only(mergeLiveViewCounts([card("a", 1, "Kept title")], new Map([["a", 9]])));
    expect(post.title).toBe("Kept title");
    expect(post.id).toBe("a");
  });
});

describe("the batch view-count request", () => {
  it("asks for nothing when there is nothing to ask about", async () => {
    // An empty feed, or a category with no stories, must not spend a round trip.
    await expect(convexViewCounts([])).resolves.toEqual(new Map());
  });
});
