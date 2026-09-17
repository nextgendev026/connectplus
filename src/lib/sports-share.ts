import { prisma } from "./prisma";
import { withDbRetry } from "./db-retry";
import { BASELINE_MODEL } from "./sports-intelligence";
import { beliefPercent } from "./pick-insights";
import { canonicalCompetition } from "./sports";
import { createLogger } from "./logger";

const log = createLogger("sports-share");

/**
 * The numbers behind a shared tips link.
 *
 * A link to the tips board is the sports desk's main export: it is what a reader
 * pastes into a WhatsApp group, and the card that renders in its place is the
 * entire advertisement. It used to render as the generic site card — no pick, no
 * record, nothing to judge — because nothing server-rendered described the tips
 * at all.
 *
 * Everything here is read-only and best-effort: `null` fields mean "unknown",
 * and the card built from them degrades to a plain description rather than
 * failing, because a metadata read must never be the reason a page 500s.
 *
 * Shared by `generateMetadata` on /sports and by /api/share, so the card the
 * crawler reads and the card the API reports can never drift apart.
 */

export interface TipsSharePick {
  fixture: string;
  selection: string;
  /** Canonical competition name, or null when the provider only gave a code. */
  competition: string | null;
  /** Model confidence as a whole percentage, matching the board. */
  confidence: number;
  kickoff: string | null;
}

/**
 * Provider competition codes — "rus.1", "eng.2" — mean nothing to a reader, and
 * a share card has no room to explain them, so the card omits the competition
 * rather than printing a database key.
 */
const PROVIDER_COMPETITION_CODE = /^[a-z]{2,5}[.\-_]?\d+$/i;

function readableCompetition(name: string | null, country: string | null): string | null {
  const canonical = canonicalCompetition(name ?? "", country).trim();
  if (!canonical || PROVIDER_COMPETITION_CODE.test(canonical)) return null;
  return canonical;
}

export interface TipsShareSummary {
  /** Actionable picks the board would show right now. */
  livePicks: number;
  settled: number;
  won: number;
  /** Percentage of settled picks won, or null before anything has settled. */
  accuracy: number | null;
  /** The fixture's headline pick, when the link names a fixture. */
  pick: TipsSharePick | null;
}

/** Pending, non-baseline picks — the same set the public board publishes. */
const LIVE_PICK_WHERE = { status: "PENDING", model: { not: BASELINE_MODEL } } as const;

export async function tipsShareSummary(matchId?: string | null): Promise<TipsShareSummary> {
  const empty: TipsShareSummary = { livePicks: 0, settled: 0, won: 0, accuracy: null, pick: null };

  try {
    const [livePicks, settled, won, lead] = await Promise.all([
      withDbRetry(() => prisma.sportsPrediction.count({ where: LIVE_PICK_WHERE })),
      withDbRetry(() =>
        prisma.sportsPrediction.count({
          where: { status: { in: ["WON", "LOST"] }, model: { not: BASELINE_MODEL } },
        })
      ),
      withDbRetry(() => prisma.sportsPrediction.count({ where: { status: "WON", model: { not: BASELINE_MODEL } } })),
      matchId
        ? withDbRetry(() =>
            prisma.sportsPrediction.findFirst({
              where: { ...LIVE_PICK_WHERE, matchId },
              orderBy: { confidence: "desc" },
              select: {
                selection: true,
                confidence: true,
                match: {
                  select: {
                    homeTeam: true,
                    awayTeam: true,
                    competition: true,
                    country: true,
                    kickoff: true,
                  },
                },
              },
            })
          ).catch(() => null)
        : Promise.resolve(null),
    ]);

    return {
      livePicks,
      settled,
      won,
      accuracy: settled > 0 ? Math.round((won / settled) * 100) : null,
      pick: lead?.match
        ? {
            fixture: `${lead.match.homeTeam} vs ${lead.match.awayTeam}`,
            selection: lead.selection,
            competition: readableCompetition(lead.match.competition, lead.match.country),
            // The board's own scale, not the raw fraction: the card has to agree
            // with the page it links to.
            confidence: beliefPercent(lead.confidence),
            kickoff: lead.match.kickoff ? lead.match.kickoff.toISOString() : null,
          }
        : null,
    };
  } catch (error) {
    log.warn("tips share summary unavailable", { error: error instanceof Error ? error.message : String(error) });
    return empty;
  }
}
