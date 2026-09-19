import type { ReactNode } from "react";

/**
 * Render the assistant's markdown, safely.
 *
 * The console's chat used `whitespace-pre-wrap`, which was fine while replies
 * were plain prose. The operations assistant writes markdown on purpose — bold
 * figures, bulleted evidence, `code` for operation names — because that is how a
 * dense answer stays readable. Two things this deliberately does *not* do:
 *
 *   • **No `dangerouslySetInnerHTML`.** The text ranges from model output to
 *     strings built from database rows, so it is parsed into React nodes and
 *     never into HTML. Anything not recognised is rendered as the literal
 *     characters it is.
 *   • **No block-level rendering.** Headings and tables are not supported, on
 *     purpose: an assistant answering in an operator's console should not be
 *     able to reshape the page. Bold, italic, inline code and list lines cover
 *     what the answers actually use.
 */

/** Inline spans: `**bold**`, `_italic_`, `` `code` ``. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;

    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-surface-50">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded border border-surface-700 bg-surface-800 px-1 py-0.5 font-mono text-[12px] text-accent-strong"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else {
      nodes.push(
        <em key={key} className="text-surface-400">
          {token.slice(1, -1)}
        </em>
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function AssistantText({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flush = (key: string) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`ul-${key}`} className="ml-1 space-y-1">
        {bullets.map((item, i) => (
          <li key={`${key}-${i}`} className="flex gap-2">
            <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-surface-500" />
            <span className="min-w-0">{inline(item, `${key}-${i}`)}</span>
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]!);
      return;
    }
    flush(String(i));
    if (line.trim() === "") {
      blocks.push(<span key={`sp-${i}`} className="block h-2" aria-hidden />);
      return;
    }
    blocks.push(
      <p key={`p-${i}`} className="min-w-0">
        {inline(line, `p-${i}`)}
      </p>
    );
  });
  flush("end");

  return <div className={className}>{blocks}</div>;
}
