/**
 * Self-contained content moderation scanner.
 *
 * A lightweight, rule+lexicon based safety layer — the "open source"
 * replacement for third-party moderation APIs (Perspective/Hive). It scores a
 * post for toxicity, spam, and policy risk and returns:
 *   - aiScore (0..1, higher = more risky)
 *   - flags (list of human-readable reasons)
 *   - suggested status (APPROVED | FLAGGED | REJECTED)
 *
 * It is deliberately conservative: clear abuse → REJECTED, borderline → FLAGGED,
 * clean → APPROVED. Human moderators always retain final say (Phase 3/4 loop).
 */

const TOXIC = [
  "fuck", "shit", "bitch", "asshole", "bastard", "whore", "slut", "dick", "piss",
  "cunt", "nigga", "nigger", "retard", "faggot", "fag", "idiot", "stupid",
  "moron", "loser", "scum", "trash", "hate", "kill yourself", "die", "rape",
];

const HARASSMENT = [
  "u deserve", "worthless", "disgusting human", "no one likes you", "shut up",
  "delete yourself", "nobody cares about you", "why are you alive",
];

const VIOLENCE = [
  "kill", "murder", "bomb", "shoot", "stab", "behead", "slaughter", "assault",
  "beat up", "threaten",
];

const NSFW = [
  "porn", "xxx", "nude pics", "sexting", "penis", "vagina", "blowjob", "camgirl",
  "sex tape", "pornhub",
];

const SPAM = [
  "click here", "free money", "make money fast", "get rich quick", "subscribe now",
  "buy now", "limited time offer", "ur welcome back", "join my telegram",
  "dm me for", "cheap prices", "bitcoin", "crypto giveaway", "follow for follow",
  "earn per day", "guaranteed profits", "work from home", "lottery winner",
];

const INFO_HAZARD = [
  "how to make a bomb", "how to hack", "install keylogger", "buy a gun no license",
];

export interface ModerationRisk {
  score: number;
  flags: string[];
  suggested: "APPROVED" | "FLAGGED" | "REJECTED";
  categories: { toxicity: number; harassment: number; violence: number; nsfw: number; spam: number; infoHazard: number };
}

function countMatches(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((acc, t) => (lower.includes(t) ? acc + 1 : acc), 0);
}

export function moderateContent(title: string, content: string): ModerationRisk {
  const text = `${title}\n${content}`;
  const toxicity = countMatches(text, TOXIC);
  const harassment = countMatches(text, HARASSMENT);
  const violence = countMatches(text, VIOLENCE);
  const nsfw = countMatches(text, NSFW);
  const spam = countMatches(text, SPAM);
  const infoHazard = countMatches(text, INFO_HAZARD);

  const flags: string[] = [];
  if (toxicity > 0) flags.push("toxic-language");
  if (harassment > 0) flags.push("harassment");
  if (violence > 2) flags.push("promotes-violence");
  if (nsfw > 0) flags.push("nsfw");
  if (spam > 0) flags.push("spam");
  if (infoHazard > 0) flags.push("info-hazard");

  const total =
    toxicity +
    harassment +
    (violence > 2 ? violence : 0) +
    nsfw +
    spam +
    infoHazard;

  let score = Math.min(1, total * 0.22);
  let suggested: ModerationRisk["suggested"] = "APPROVED";

  if (toxicity >= 3 || harassment >= 2 || violence >= 3 || nsfw >= 2 || infoHazard > 0) {
    suggested = "REJECTED";
    score = Math.max(score, 0.85);
  } else if (total >= 1 || toxicity >= 2) {
    suggested = "FLAGGED";
    score = Math.max(score, 0.45);
  }

  return {
    score: Math.round(score * 100) / 100,
    flags,
    suggested,
    categories: {
      toxicity,
      harassment,
      violence,
      nsfw,
      spam,
      infoHazard,
    },
  };
}
