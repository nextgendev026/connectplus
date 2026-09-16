import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckedEditor } from "@/components/studio/CheckedEditor";
import type { WritingSuggestion } from "@/lib/writing-checks";

/**
 * The in-place underlines only work if the mirror renders *exactly* the string
 * in the textarea. A mark that swallows a character, or a range that drifts by
 * one, puts the wavy underline under the wrong word — and that is invisible to
 * every other test in the suite. Rendering the component to markup is enough to
 * pin the invariant, because the mirror is plain text plus spans.
 */

function render(value: string, suggestions: WritingSuggestion[]): string {
  return renderToStaticMarkup(
    createElement(CheckedEditor, {
      value,
      onChange: () => {},
      textareaRef: { current: null },
      suggestions,
      onApply: () => {},
      onDismiss: () => {},
      placeholder: "Start writing…",
    })
  );
}

/** The mirror's own text only — React SSR renders the textarea's value as its child. */
function mirrorText(html: string): string {
  const marker = html.indexOf("data-checked-editor-mirror");
  const open = html.indexOf(">", marker) + 1;
  const close = html.indexOf("</div>", open);
  return html.slice(open, close).replace(/<[^>]+>/g, "");
}

const suggestion = (
  over: Partial<WritingSuggestion> & Pick<WritingSuggestion, "start" | "end">
): WritingSuggestion => ({
  id: `${over.start}-${over.end}`,
  kind: "correctness",
  rule: "test",
  message: "test issue",
  original: "",
  replacement: null,
  severity: "low",
  ...over,
});

describe("CheckedEditor overlay", () => {
  it("renders the mirror as exactly the textarea's string", () => {
    const value = "We recieve the the plan and seperate it later.";
    const html = render(value, []);
    expect(mirrorText(html)).toBe(value);
  });

  it("still reconstructs the string exactly when it is full of marks", () => {
    const value = "We recieve the the plan and seperate it later.";
    const html = render(value, [
      suggestion({ start: 3, end: 10, original: "recieve" }),
      suggestion({ start: 11, end: 18, original: "the the" }),
      suggestion({ start: 28, end: 36, original: "seperate" }),
    ]);
    expect(mirrorText(html)).toBe(value);
  });

  it("draws one mark per usable suggestion", () => {
    const value = "alpha beta gamma";
    const html = render(value, [
      suggestion({ start: 0, end: 5, original: "alpha" }),
      suggestion({ start: 6, end: 10, original: "beta" }),
    ]);
    expect((html.match(/decoration-wavy/g) ?? []).length).toBe(2);
  });

  it("ignores a range that would fall outside the draft", () => {
    // A stale offset from an earlier revision must never make the mirror render
    // a different string than the textarea holds.
    const value = "short draft";
    const html = render(value, [suggestion({ start: 900, end: 905, original: "ghost" })]);
    expect(mirrorText(html)).toBe(value);
    expect(html).not.toContain("decoration-wavy");
  });

  it("drops an overlapping range instead of interleaving the spans", () => {
    const value = "word word word";
    const html = render(value, [
      suggestion({ start: 0, end: 9, original: "word word" }),
      suggestion({ start: 5, end: 14, original: "word word" }),
    ]);
    expect(mirrorText(html)).toBe(value);
    expect((html.match(/decoration-wavy/g) ?? []).length).toBe(1);
  });
});
