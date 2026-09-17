/**
 * The sports desk is a football desk.
 *
 * It used to be two: every fetch surface took a `sport` string, the board had a
 * Football/Basketball toggle, the merge hub carried a basketball league map, the
 * edge worker kept a second snapshot for it, and the season's picks were split
 * across both. Basketball was never the draw — the audience is here for the FKF
 * Premier League and the European leagues — and the split cost real things: half
 * the live-score budget went to a board almost nobody opened, the selector was
 * the first control a reader saw, and every "which sport?" branch in the merge
 * chain was a place the two could drift apart.
 *
 * So the scope is fixed here, in one module, and every entry point asks it rather
 * than carrying its own opinion:
 *
 *  - **Requests are coerced, not rejected.** A stale link, a bookmark, or the
 *    edge worker's own cached URL can still carry `sport=basketball`. Answering
 *    those with a 400 would turn a dead feature into a broken page; answering
 *    them with football is what a reader who clicked a sports link expects. The
 *    coercion is logged by the routes so it is visible rather than silent.
 *  - **`soccer` is football.** Two feeds spell it differently and one of them is
 *    ESPN's; treating them as different sports is how a fixture ends up with no
 *    odds attached.
 */

/** The only sport this desk serves. */
export const SPORTS_SCOPE = "football" as const;

export type SportsScope = typeof SPORTS_SCOPE;

/** ESPN spells it `soccer`; football-data says `football`; readers say both. */
const FOOTBALL_ALIASES = new Set(["football", "soccer", "association football", "fifa"]);

/**
 * Whether a caller asked for football — or for nothing at all, which means the
 * default and is therefore football.
 */
export function isFootballScope(raw: string | null | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "" || FOOTBALL_ALIASES.has(value);
}

/**
 * The sport a request is actually served with.
 *
 * Always football. The parameter is kept so call sites still read like they are
 * passing a sport through, rather than pretending the input never existed.
 */
export function footballScope(_raw?: string | null): SportsScope {
  return SPORTS_SCOPE;
}

/** Human label, for the places a board names what it is showing. */
export const SPORTS_SCOPE_LABEL = "Football";

/** ESPN's path segment for it. */
export const ESPN_SPORT_PATH = "soccer";
