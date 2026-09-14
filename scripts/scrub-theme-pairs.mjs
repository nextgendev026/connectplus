/**
 * Normalise legacy light/dark class pairs in the admin console.
 *
 * The admin console was written against a light-first theme: every colour is
 * spelled as a light value plus a `dark:` override
 * (`text-surface-900 dark:text-surface-50`). This app's theme is the opposite
 * shape — the surface ramp FLIPS between modes, so a single token already
 * resolves to the right value in both (see the token blocks in
 * `src/app/globals.css`). The legacy halves therefore actively break light
 * mode: `text-surface-900` is near-white on paper, and `bg-surface-100` is a
 * near-black chip.
 *
 * Two passes, both deliberately narrow:
 *
 * 1. **Unwrap** — drop the `dark:` prefix from a colour token. The dark half is
 *    already the "on the flipped ramp" step, so under this theme it resolves to
 *    the right value on paper as well.
 * 2. **Resolve collisions** — unloading the `dark:` half can leave a class
 *    string declaring the same property twice (`text-surface-900 ...
 *    text-surface-50`). Which one wins is decided by Tailwind's own stylesheet
 *    order, not by the order they appear in the attribute, so the survivor is
 *    picked here instead of left to chance: the more specific surface, i.e. the
 *    one that used to be dark-only.
 *
 * 3. **Remap stranded light-first steps** — a handful of tokens were never
 *    paired with a `dark:` twin, so passes 1–2 leave them alone and they are
 *    still wrong in *both* modes: on paper `text-surface-600` is #A7A7AB
 *    (1.6:1 — invisible) and on night it is #4C525C (also invisible), and
 *    `border-surface-200` is a near-black hairline on a light card. Each is
 *    mapped to the step that means the same thing in the flipped ramp.
 *
 * Only whitelisted `<property>-<colour>` tokens are touched. `bg-gradient-*`,
 * `border-b`, `text-white` and friends never match, so nothing structural and
 * no brand or ink fill is rewritten.
 *
 *   node scripts/scrub-theme-pairs.mjs            # report only
 *   node scripts/scrub-theme-pairs.mjs --write    # apply
 */

/**
 * Light-first token → the flipped-ramp token with the same meaning.
 *
 * Kept as data so the intent of every rewrite is reviewable in one place, and
 * so a later reader can tell a deliberate mapping from a typo.
 */
const REMAP = {
  // Hairlines: surface-200/300 are dark greys in light mode, which draws a
  // near-black rule on a light card. 700/800 are the app's real border steps.
  "border-surface-100": "border-surface-700",
  "border-surface-200": "border-surface-800",
  "border-surface-200/70": "border-surface-800/60",
  "border-surface-200/60": "border-surface-800/60",
  "border-surface-300": "border-surface-700",
  "border-surface-600": "border-surface-700",
  "border-surface-600/60": "border-surface-700/60",

  // Wells and chips: 100–300 are nearly black in light mode.
  "bg-surface-100": "bg-surface-800",
  "bg-surface-200/70": "bg-surface-800/70",
  "bg-surface-200/60": "bg-surface-800/60",
  "bg-surface-300/40": "bg-surface-800/40",
  "bg-surface-300/70": "bg-surface-800/70",
  "bg-surface-600": "bg-surface-700",

  // Muted copy: 600/700 fail AA in both modes; 300/400 are the real steps.
  "text-surface-600": "text-surface-400",
  "text-surface-700": "text-surface-300",
  "text-surface-800": "text-surface-200",
  "text-surface-900": "text-surface-50",
};
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/app/(admin)", "src/components/admin"];
const WRITE = process.argv.includes("--write");

/** Colour steps that are safe to collapse. */
const COLOUR = String.raw`(?:transparent|inherit|current|white|black|surface-\d{2,3}|brand-\d{2,3}|red-\d{2,3}|rose-\d{2,3}|emerald-\d{2,3}|green-\d{2,3}|amber-\d{2,3}|yellow-\d{2,3}|orange-\d{2,3}|sky-\d{2,3}|cyan-\d{2,3}|blue-\d{2,3}|indigo-\d{2,3}|violet-\d{2,3}|purple-\d{2,3})`;
/** Properties whose value is a colour and can be overridden by a dark: twin. */
const PROP = `(?:bg|text|border|border-[trblxy]|ring|divide|placeholder|fill|stroke|from|via|to|decoration|outline|shadow|caret|accent)`;

/** `[variant:]property-colour[/opacity]` */
const LIGHT_TOKEN = new RegExp(
  String.raw`^(?<variants>(?:[a-z0-9-]+:)*)(?<prop>${PROP})-(?<colour>${COLOUR})(?:\/(?:\d+|\[[^\]]+\]))?$`
);
/** Same, but must start with the `dark:` variant. */
const DARK_TOKEN = new RegExp(
  String.raw`^dark:(?<variants>(?:[a-z0-9-]+:)*)(?<prop>${PROP})-(?<colour>${COLOUR})(?:\/(?:\d+|\[[^\]]+\]))?$`
);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) yield full;
  }
}

/**
 * Collapse pairs inside one class string.
 *
 * Backwards scan for the nearest token that is the same variant chain and the
 * same property. "Same variant chain" is what stops `hover:bg-x dark:bg-y` from
 * eating the hover state, and the property match is what stops a dark text
 * colour from eating a background.
 */
function collapse(classString) {
  const tokens = classString.split(/(\s+)/);
  let changed = 0;

  // Pass 1 — unwrap `dark:` from colour tokens.
  for (let i = 0; i < tokens.length; i++) {
    if (DARK_TOKEN.test(tokens[i])) {
      tokens[i] = tokens[i].slice("dark:".length);
      changed++;
    }
  }

  // Pass 2 — where a string now declares the same property twice with no
  // variant between them, keep the last (the step that used to be dark-only).
  // Pass 3 — resolve stranded light-first steps. The state variants are kept:
  // a stranded step is just as illegible behind `hover:` as it is on its own.
  for (let i = 0; i < tokens.length; i++) {
    const split = /^(?<variants>(?:[a-z0-9-]+:)*)(?<rest>.+)$/.exec(tokens[i]);
    if (!split) continue;
    const remapped = REMAP[split.groups.rest];
    if (remapped) {
      tokens[i] = split.groups.variants + remapped;
      changed++;
    }
  }

  const seen = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const match = LIGHT_TOKEN.exec(tokens[i]);
    if (!match) continue;
    const key = `${match.groups.variants}|${match.groups.prop}`;
    const previous = seen.get(key);
    if (previous !== undefined) {
      tokens[previous] = ""; // superseded — only the last declaration survives
      changed++;
    }
    seen.set(key, i);
  }

  // Removing a token leaves its separator behind. Collapsing the runs keeps the
  // rewritten class lists as legible as the ones that were never touched, and
  // tidies up the ones an earlier pass left with a gap in them.
  const text = tokens.join("").replace(/\s{2,}/g, " ").trim();
  return { text, changed: text === classString ? 0 : Math.max(1, changed) };
}

/**
 * Every quoted or backticked string literal in the file. A literal that
 * contains `dark:` is a class string by construction — `dark:` has no other
 * meaning in this codebase — so matching literals rather than `className=`
 * sites also catches class strings passed through `cn()`, ternaries and
 * template literals, without needing to parse JSX.
 */
const TARGET = /(["`])((?:\\.|(?!\1)[^\\])*)\1/g;

let files = 0;
let pairs = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const source = readFileSync(file, "utf8");
    let hits = 0;
    const next = source.replace(TARGET, (match, quote, body) => {
      // Nothing to do for a literal that cannot hold a colour utility.
      if (!/(?:^|\s)[a-z0-9-]*:?(?:bg|text|border|ring|from|via|to|divide|fill|stroke|caret|accent|decoration)-/.test(body)) {
        return match;
      }
      const { text, changed } = collapse(body);
      if (!changed) return match;
      hits += changed;
      return quote + text + quote;
    });
    if (hits) {
      files++;
      pairs += hits;
      console.log(`${WRITE ? "fixed" : "would fix"} ${String(hits).padStart(3)} tokens  ${file}`);
      if (WRITE) writeFileSync(file, next);
    }
  }
}
console.log(`\n${WRITE ? "Fixed" : "Would fix"} ${pairs} tokens across ${files} files.`);
