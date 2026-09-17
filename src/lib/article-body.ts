/**
 * Splitting an article body for an in-content placement.
 *
 * Mid-content is the most valuable position there is — it is the only placement
 * a reader who finishes the piece is guaranteed to pass through — and it is also
 * the easiest one to ruin. A naive cut at the halfway byte lands inside a code
 * sample, between a list item and its marker, or mid-emphasis, and the reader
 * meets broken markup where a story used to be.
 *
 * So the split only ever happens at a real block boundary, only in the middle
 * half of the piece, and only on a body long enough to carry an interruption.
 * When no safe boundary exists the caller gets `null` and shows no mid-content
 * ad at all: a missed impression is a rounding error, a mangled article is not.
 */

export interface BodySplit {
  lead: string;
  rest: string;
}

/**
 * Split `content` for an in-content ad, or return null to place none.
 *
 * `minWords` is the floor below which a piece is too short to interrupt: an
 * article that is mostly the ad is a worse experience than no ad.
 */
export function splitForInlineAd(content: string, minWords = 400): BodySplit | null {
  if (!content) return null;

  const words = content.split(/\s+/).filter(Boolean).length;
  if (words < minWords) return null;

  const looksLikeHtml = /<\/(?:p|h[1-6]|blockquote|ul|ol|div|figure)>/i.test(content);
  const cut = looksLikeHtml ? htmlBoundary(content) : markdownBoundary(content);
  if (cut === null) return null;

  return { lead: content.slice(0, cut), rest: content.slice(cut) };
}

/** The boundary closest to the middle, restricted to the middle half. */
function nearestMiddle(candidates: number[], length: number): number | null {
  const low = Math.floor(length * 0.25);
  const high = Math.floor(length * 0.75);
  const middle = length / 2;

  let best: number | null = null;
  for (const candidate of candidates) {
    if (candidate < low || candidate > high) continue;
    if (best === null || Math.abs(candidate - middle) < Math.abs(best - middle)) best = candidate;
  }
  return best;
}

/**
 * Markdown: a blank line that is not inside a fenced code block.
 *
 * The fence state has to be tracked explicitly — a blank line inside a fenced
 * sample looks exactly like a paragraph break, and splitting there leaves an
 * unterminated fence in the lead and a stray closing fence in the rest.
 */
function markdownBoundary(content: string): number | null {
  const lines = content.split("\n");
  const candidates: number[] = [];
  let fence: string | null = null;
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    const marker = trimmed.match(/^(```+|~~~+)/);

    if (marker) {
      if (!fence) fence = marker[1] ?? "";
      else if (trimmed.startsWith(fence)) fence = null;
      offset += line.length + 1;
      continue;
    }

    // `offset` is the index where this line begins, so a cut here ends the lead
    // on the previous line and starts the rest on a blank line.
    if (!fence && trimmed === "" && i > 0) candidates.push(offset);

    offset += line.length + 1;
  }

  return nearestMiddle(candidates, content.length);
}

/**
 * HTML: the end of a block-level element, never inside a `<pre>`.
 *
 * `split`/`indexOf` counting is enough here because the strings are article
 * bodies, not arbitrary documents: a `<pre>` that is opened and closed before
 * this point cannot contain the cut.
 */
function htmlBoundary(content: string): number | null {
  const candidates: number[] = [];
  const closing = /<\/(?:p|h[1-6]|blockquote|ul|ol|figure)>/gi;

  let match: RegExpExecArray | null;
  while ((match = closing.exec(content)) !== null) {
    const end = match.index + match[0].length;
    const before = content.slice(0, end).toLowerCase();
    const opens = before.split("<pre").length - 1;
    const closes = before.split("</pre>").length - 1;
    if (opens > closes) continue;
    candidates.push(end);
  }

  return nearestMiddle(candidates, content.length);
}
