import { postCoverSrc } from "@/lib/thumb";

/**
 * The single place a feed/list post payload is given its derived fields.
 *
 * Why this module exists. `POST_SELECT` in `/api/posts` omits `coverImage` on
 * purpose — stored covers can be multi-megabyte base64 `data:` URIs, so selecting
 * them inflated every response (and the Redis body cache) by megabytes. The
 * contract that replaces it is "the response derives the field", and for a long
 * time that contract was honoured only by whichever branch its author was looking
 * at. The unranked branch mapped `coverImage: postCoverSrc(id)`; the ranked
 * (`?personalized=true`) branch did not, so a ranked post arrived at the client
 * with the property *absent*.
 *
 * Absent is not neutral here. `coverSrc(undefined, …)` reads a missing field
 * exactly like a missing cover and mints a generated `/api/thumb/<code>`
 * placeholder, so the home page — the one surface that swaps the server's pool
 * for the ranked response once a signed-in reader is ranked — replaced every real
 * cover with a generic branded card. It looked correct to a crawler and to a
 * signed-out visitor, who both receive the server pool, and only broke for the
 * readers who had an account.
 *
 * The lesson is not "remember the mapping". A rule that must be repeated in N
 * branches is a rule that will be missing from branch N+1, and this one failed
 * silently in exactly the way that is hardest to notice. So the derivation lives
 * here, once, and every branch calls it. Adding a derived field means adding it
 * here rather than remembering to add it everywhere.
 */
export interface DerivedCover {
  /** The `coverImage` every consumer resolves through `coverSrc`. Always set. */
  coverImage: string;
}

/**
 * Attach the fields a post payload derives rather than selects.
 *
 * Generic over the row so callers keep their own selected shape — a ranked post
 * and an unranked one select different columns, and both come out of here with
 * `coverImage` present.
 */
export function serializePost<T extends { id: string }>(post: T): T & DerivedCover {
  return { ...post, coverImage: postCoverSrc(post.id) };
}

/** `serializePost` over a page. Returns a new array; the input is not mutated. */
export function serializePosts<T extends { id: string }>(posts: T[]): (T & DerivedCover)[] {
  return posts.map(serializePost);
}
