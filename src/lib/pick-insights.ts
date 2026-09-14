/**
 * Explaining a pick in words a normal reader can follow.
 *
 * The model already writes a rationale, but it writes it for itself: it opens
 * with "Poisson model: xG 1.45–0.98", quotes an edge in "pp" above the market's
 * implied price, and calls a form feed a "Hive prior". That is an audit trail,
 * not an explanation, and a tip nobody understands is a tip nobody can judge.
 *
 * So there are two layers here. `explainPick` builds the reasons from the
 * *numbers* the pick carries — how likely it is, what the goals look like, how
 * the bookmakers have priced it, what the recent form says — and `humaniseNote`
 * translates the audit trail into the same plain English for a reader who wants
 * the detail. Same facts, no jargon.
 */

/** Market keys as a punter sees them, not as the model stores them. */
const MARKET_PLAIN: Record<string, string> = {
  "1X2": "Who wins",
  "over-under": "Total goals",
  btts: "Both teams to score",
  "correct-score": "Exact score",
};

export type ReasonIcon = "goals" | "chance" | "value" | "form" | "bookies" | "record";

export interface PickReason {
  icon: ReasonIcon;
  label: string;
  detail: string;
}

export interface PickInsightInput {
  market: string;
  selection: string;
  /** The model's own belief, 0–1. */
  confidence: number;
  /** Percentage points above (positive) or below (negative) the bookmakers' price. */
  valueEdge?: number | null;
  expectedHomeGoals?: number | null;
  expectedAwayGoals?: number | null;
  homeWinPct?: number | null;
  drawPct?: number | null;
  awayWinPct?: number | null;
  /** The model's audit trail — translated, never shown raw. */
  rationale?: string | null;
  match: {
    homeTeam: string;
    awayTeam: string;
    oddsHome?: number | null;
    oddsDraw?: number | null;
    oddsAway?: number | null;
  };
}

export interface PickInsight {
  /** The market in plain words: "Total goals", not "over-under". */
  marketPlain: string;
  /** 0–100, for a meter. */
  belief: number;
  tier: { label: string; tone: "strong" | "good" | "close" | "longshot" };
  /** One sentence that says what the pick is and how sure we are. */
  summary: string;
  reasons: PickReason[];
  /** The honest caveat, shown next to the reasons rather than buried. */
  caution: string;
  /** The audit trail, translated. */
  note: string;
}

const pct = (fraction: number) => Math.round(fraction * 100);

function tierOf(belief: number): PickInsight["tier"] {
  if (belief >= 68) return { label: "Strong call", tone: "strong" };
  if (belief >= 56) return { label: "Good call", tone: "good" };
  if (belief >= 45) return { label: "Close call", tone: "close" };
  return { label: "Long shot", tone: "longshot" };
}

function favouriteOf(match: PickInsightInput["match"]): { name: string; odds: number } | null {
  const options: { name: string; odds: number | null | undefined }[] = [
    { name: match.homeTeam, odds: match.oddsHome },
    { name: "the draw", odds: match.oddsDraw },
    { name: match.awayTeam, odds: match.oddsAway },
  ];
  const priced = options.filter((o): o is { name: string; odds: number } => typeof o.odds === "number" && o.odds > 1);
  if (priced.length === 0) return null;
  return priced.reduce((best, o) => (o.odds < best.odds ? o : best));
}

/** "1.85" — bookmaker prices are quoted to two decimals, never as 1.9. */
const price = (odds: number) => odds.toFixed(2);

function goalsReason(pick: PickInsightInput): PickReason | null {
  const home = pick.expectedHomeGoals;
  const away = pick.expectedAwayGoals;
  if (typeof home !== "number" || typeof away !== "number") return null;
  const total = Math.round((home + away) * 10) / 10;
  const line =
    pick.market === "over-under"
      ? `We expect about ${total} goals (${home} for ${pick.match.homeTeam}, ${away} for ${pick.match.awayTeam}).`
      : `We expect about ${total} goals in this one (${home} – ${away}).`;
  return { icon: "goals", label: "Goals we expect", detail: line };
}

function winReason(pick: PickInsightInput): PickReason | null {
  const rows: { name: string; pct: number | null | undefined }[] = [
    { name: pick.match.homeTeam, pct: pick.homeWinPct },
    { name: "a draw", pct: pick.drawPct },
    { name: pick.match.awayTeam, pct: pick.awayWinPct },
  ];
  const known = rows.filter((r): r is { name: string; pct: number } => typeof r.pct === "number" && r.pct > 0);
  if (known.length === 0) return null;
  const best = known.reduce((a, b) => (b.pct > a.pct ? b : a));
  return {
    icon: "chance",
    label: "What our numbers say",
    detail: `We give ${best.name} the best chance at ${Math.round(best.pct)}%.`,
  };
}

function valueReason(pick: PickInsightInput): PickReason | null {
  const edge = pick.valueEdge;
  if (typeof edge !== "number") return null;
  if (edge > 0.5) {
    return {
      icon: "value",
      label: "Value vs the bookies",
      detail: `We rate this about ${edge.toFixed(1)} points higher than the price on offer — that gap is the reason to look.`,
    };
  }
  if (edge < -0.5) {
    return {
      icon: "value",
      label: "Value vs the bookies",
      detail: `The bookies price this about ${Math.abs(edge).toFixed(1)} points shorter than we do, so the price is not in your favour.`,
    };
  }
  return {
    icon: "value",
    label: "Value vs the bookies",
    detail: "Our number and the price on offer are about the same — a fair price, not a bargain.",
  };
}

function bookiesReason(pick: PickInsightInput): PickReason | null {
  const fav = favouriteOf(pick.match);
  if (!fav) return null;
  return {
    icon: "bookies",
    label: "The bookies' view",
    detail:
      fav.name === "the draw"
        ? `They make the draw the shortest price at ${price(fav.odds)}.`
        : `They make ${fav.name} the favourite at ${price(fav.odds)}.`,
  };
}

/** Pull one labelled fact out of the model's audit trail. */
function factFrom(rationale: string, pattern: RegExp): string | null {
  const match = rationale.match(pattern);
  return match ? (match[1] ?? "").trim() : null;
}

function formReason(pick: PickInsightInput): PickReason | null {
  const rationale = pick.rationale ?? "";
  const forms = factFrom(rationale, /Real form:\s*([^.]+)\./);
  if (!forms) return null;
  const meetings = factFrom(rationale, /(\d+)\s+recent head-to-head meeting/);
  return {
    icon: "form",
    label: "Recent form",
    detail: meetings
      ? `${forms}. We also weighed ${meetings} recent meeting${meetings === "1" ? "" : "s"} between them.`
      : `${forms}.`,
  };
}

function recordReason(pick: PickInsightInput): PickReason | null {
  const rationale = pick.rationale ?? "";
  const match = rationale.match(/Hive prior:\s*(\d+)%\s*accuracy across\s*(\d+)\s*settled\s*([^.]+)\./);
  if (!match) return null;
  return {
    icon: "record",
    label: "How this has gone before",
    detail: `Picks like this in ${match[3]} have landed ${match[1]}% of the time (${match[2]} settled).`,
  };
}

function summaryFor(pick: PickInsightInput, belief: number): string {
  const { homeTeam, awayTeam } = pick.match;
  switch (pick.market) {
    case "over-under":
      return `For ${homeTeam} v ${awayTeam}, our numbers point to ${pick.selection.toLowerCase()} — we make it about ${belief}% likely.`;
    case "btts":
      return `For ${homeTeam} v ${awayTeam}, we make it ${belief}% likely that ${pick.selection.toLowerCase()}.`;
    case "correct-score":
      return `For ${homeTeam} v ${awayTeam}, ${pick.selection} is the single most likely score. Exact scores are the hardest call in football, so treat this as a bit of fun.`;
    default:
      return `For ${homeTeam} v ${awayTeam}, we make "${pick.selection}" the most likely result — about ${belief}% of the time in games like this.`;
  }
}

function cautionFor(pick: PickInsightInput, belief: number): string {
  if (pick.market === "correct-score") {
    return "Exact scorelines are the hardest market there is. Small stakes, if any.";
  }
  if (typeof pick.valueEdge === "number" && pick.valueEdge < -0.5) {
    return "The price is shorter than our own number, so even a good call can be a bad bet.";
  }
  const fav = favouriteOf(pick.match);
  if (fav && fav.odds <= 1.5) {
    return `Backing the favourite at ${price(fav.odds)} leaves very little room for profit.`;
  }
  if (belief < 50) {
    return "This one is closer to a coin toss than the percentage suggests — don't over-stake it.";
  }
  return "Nothing is certain in sport: our number is a probability, not a promise.";
}

/**
 * The reasons behind one pick, in the order a reader wants them: what we think,
 * then why — likelihood, goals, the price, the bookies, the form, the record.
 */
export function explainPick(pick: PickInsightInput): PickInsight {
  const belief = Math.max(1, Math.min(99, pct(pick.confidence)));
  const reasons = [
    winReason(pick),
    goalsReason(pick),
    valueReason(pick),
    bookiesReason(pick),
    formReason(pick),
    recordReason(pick),
  ].filter((r): r is PickReason => r !== null);

  return {
    marketPlain: MARKET_PLAIN[pick.market] ?? pick.market,
    belief,
    tier: tierOf(belief),
    summary: summaryFor(pick, belief),
    reasons: reasons.slice(0, 4),
    caution: cautionFor(pick, belief),
    note: humaniseNote(pick.rationale ?? ""),
  };
}

/**
 * Rewrite the model's audit trail in plain English.
 *
 * Substitutions are deliberately literal: each one replaces a term the model
 * prints with the words a reader would use, so the note stays factually
 * identical to what the model wrote. Anything unrecognised is left alone rather
 * than guessed at.
 */
export function humaniseNote(rationale: string): string {
  let text = rationale.trim();
  if (!text) return "";

  const swaps: [RegExp, string][] = [
    [/Poisson model:\s*xG\s*([\d.]+)–([\d.]+)\./i, "Our goals model expects $1–$2 goals."],
    [/carries the highest modelled probability \(([\d.]+)%\)/i, "is our most likely single result, at about $1%"],
    [/Model is ([\d.]+)pp above the market's implied price\./i, "We rate it $1 points higher than the bookies' price."],
    [/Market is ([\d.]+)pp shorter than the model — thin value\./i, "The bookies price it $1 points shorter than we do — little value there."],
    [/No published odds to price an edge against\./i, "No bookmaker prices were available to compare against."],
    [/Hive prior:\s*([\d.]+)% accuracy across (\d+) settled ([^.]+)\./i, "Our record on picks like this: $1% across $2 settled $3 picks."],
    [/Hive prior: not enough settled ([^.]+) picks yet, leaning on the base model\./i, "We have not settled enough $1 picks to lean on our own record here, so this follows the base model."],
    [/Real form:/i, "Recent form:"],
    [/(\d+) recent head-to-head meetings factored in\./i, "$1 recent meetings between them were weighed too."],
    [/1 recent head-to-head meeting factored in\./i, "One recent meeting between them was weighed too."],
  ];

  for (const [pattern, replacement] of swaps) {
    text = text.replace(pattern, replacement);
  }

  // Collapse the double spaces the substitutions can leave behind.
  return text.replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim();
}
