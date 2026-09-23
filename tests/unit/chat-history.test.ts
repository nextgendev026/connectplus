import { describe, expect, it } from "vitest";
import {
  chronologicalHistory,
  deriveConversationTitle,
  historyFetchSize,
  previewOf,
  toConversationSummary,
  HISTORY_TURNS,
  PREVIEW_CHARS,
} from "@/lib/chat-history";

/**
 * The conversation window the console's chat is composed against.
 *
 * The defect these replace was not a crash. The route asked the database for
 * `orderBy: createdAt asc, take: 10` — which reads as "the first ten messages",
 * and is why a long thread got worse the longer it ran: past ten turns the mind
 * was answering the current question while looking at the opening of the
 * conversation. On the live console that had already produced 108 conversations
 * of which 100 held a single exchange, because a second defect (the widget never
 * sending a conversation id) meant there was usually no history to get wrong.
 *
 * The ordering is asserted directly because the failure is silent either way: a
 * reversed prompt produces a fluent answer that is merely confused, which is
 * exactly what "it lost the plot mid-conversation" looks like from outside.
 */

/** A page as a `createdAt desc` query returns it: newest first. */
const newestFirst = [
  { role: "assistant", content: "third" },
  { role: "user", content: "second" },
  { role: "assistant", content: "first" },
];

describe("chronologicalHistory", () => {
  it("reverses a newest-first page into the order it was said", () => {
    expect(chronologicalHistory(newestFirst).map((t) => t.content)).toEqual(["first", "second", "third"]);
  });

  it("keeps the most recent turns, not the oldest", () => {
    // The regression. A ten-turn conversation must hand the model the *end* of
    // it, because that is what the next question is a reply to.
    const long = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn-${i}`,
    })).reverse(); // newest first, as the query returns it

    const history = chronologicalHistory(long, 4);
    expect(history).toHaveLength(4);
    // The last thing said is last, and it is turn-39 — the newest row.
    expect(history.at(-1)?.content).toBe("turn-39");
    expect(history.map((t) => t.content)).toEqual(["turn-36", "turn-37", "turn-38", "turn-39"]);
  });

  it("never presents the oldest turns as if they were the recent ones", () => {
    const long = Array.from({ length: 30 }, (_, i) => ({ role: "user", content: `t${i}` })).reverse();
    const history = chronologicalHistory(long, 3);
    // The bug returned t0..t2. Assert the specific wrong answer is absent.
    expect(history.map((t) => t.content)).not.toContain("t0");
    expect(history.map((t) => t.content)).toEqual(["t27", "t28", "t29"]);
  });

  it("drops rows that are not conversation turns", () => {
    const mixed = [
      { role: "assistant", content: "answer" },
      { role: "system", content: "tool notice" },
      { role: "user", content: "question" },
      { role: "tool", content: "{}" },
    ];
    // A role the backend will not accept is worse than a missing turn.
    expect(chronologicalHistory(mixed).map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("truncates an individual turn rather than dropping it", () => {
    const huge = [{ role: "user", content: "x".repeat(50_000) }];
    const [turn] = chronologicalHistory(huge);
    expect(turn?.content.length).toBe(2_000);
  });

  it("handles an empty conversation and a nonsensical limit without throwing", () => {
    expect(chronologicalHistory([])).toEqual([]);
    expect(chronologicalHistory(newestFirst, 0)).toHaveLength(1);
    expect(chronologicalHistory(newestFirst, -5)).toHaveLength(1);
    expect(chronologicalHistory(newestFirst, Number.NaN).length).toBeGreaterThan(0);
  });

  it("prefers user turns when a limit falls between an answer and its question", () => {
    // Not a policy so much as a description of what slice does: with the newest
    // two rows being [assistant, user], the window opens on a question. Worth
    // pinning so a future change to the slicing is a decision, not an accident.
    const rows = [
      { role: "assistant", content: "a2" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q1" },
    ];
    expect(chronologicalHistory(rows, 2).map((t) => t.content)).toEqual(["q2", "a2"]);
  });
});

describe("historyFetchSize", () => {
  it("asks for more rows than the window needs", () => {
    // Sized exactly to the window, a page of dropped rows could filter down to
    // nothing and hand the model an empty history that looks like a new chat.
    expect(historyFetchSize(10)).toBe(20);
    expect(historyFetchSize()).toBe(HISTORY_TURNS * 2);
  });

  it("survives a nonsense window", () => {
    expect(historyFetchSize(0)).toBe(2);
    expect(historyFetchSize(-1)).toBe(2);
  });

  it("always fetches enough to survive filtering", () => {
    // For any window, half the fetched rows may be dropped and the window is
    // still fillable.
    for (const limit of [1, 3, 12, 50]) {
      expect(historyFetchSize(limit)).toBeGreaterThanOrEqual(limit);
    }
  });
});

describe("deriveConversationTitle", () => {
  it("keeps a short question whole", () => {
    expect(deriveConversationTitle("How is the platform health?")).toBe("How is the platform health?");
  });

  it("cuts at a word boundary rather than mid-word", () => {
    const original = "Trigger the scheduled jobs that are lagging behind and report what you find";
    const title = deriveConversationTitle(original);
    expect(title.endsWith("…")).toBe(true);

    // The property, stated precisely: what was kept is a prefix of the sentence
    // that stops exactly where a word does. Checking "does not end in one letter"
    // would pass on a half-word like "laggi" — the cut has to be at a separator.
    const kept = title.replace(/…$/, "");
    expect(original.startsWith(kept)).toBe(true);
    expect(original[kept.length]).toBe(" ");
    expect(original.slice(0, kept.length).endsWith(" ")).toBe(false);
    // And no word was chopped in half on the way.
    expect(original.split(" ")).toContain(kept.split(" ").pop());
  });

  it("collapses whitespace so a pasted newline does not become the title", () => {
    expect(deriveConversationTitle("  line one\n\nline   two  ")).toBe("line one line two");
  });

  it("never returns an empty title", () => {
    expect(deriveConversationTitle("")).toBe("New conversation");
    expect(deriveConversationTitle("   ")).toBe("New conversation");
  });

  it("respects the caller's own limit", () => {
    expect(deriveConversationTitle("abcdef", 4).length).toBeLessThanOrEqual(5);
  });
});

/**
 * The saved-chat list row.
 *
 * This is the half of the history pipeline that can be wrong *silently*. The
 * list is built by a join, and every way that join can come back differently —
 * no messages, no `_count`, dates that arrived as strings rather than `Date` —
 * used to be an unhandled throw inside the route. The console renders an empty
 * list for any failure, so the operator saw "no saved chats" and nothing
 * anywhere said why. Pinning the tolerant behaviour is what keeps it from
 * drifting back into that state.
 */
describe("toConversationSummary", () => {
  const row = {
    id: "conv_1",
    title: "How is the platform health?",
    createdAt: new Date("2026-09-23T15:00:00.000Z"),
    updatedAt: new Date("2026-09-23T15:49:44.837Z"),
    shareToken: null as string | null,
    _count: { messages: 4 },
    messages: [{ content: "The scheduler is healthy.", role: "assistant" }],
  };

  it("maps a row to exactly what the console renders", () => {
    expect(toConversationSummary(row)).toEqual({
      id: "conv_1",
      title: "How is the platform health?",
      createdAt: "2026-09-23T15:00:00.000Z",
      updatedAt: "2026-09-23T15:49:44.837Z",
      messageCount: 4,
      preview: "The scheduler is healthy.",
      shared: false,
    });
  });

  it("reads a row that has no preview rather than failing on it", () => {
    // A thread whose transcript was pruned, or that exists only as a title.
    const summary = toConversationSummary({ ...row, messages: [] });
    expect(summary.preview).toBe("");
    expect(summary.title).toBe("How is the platform health?");
  });

  it("survives dates that arrive as strings", () => {
    // Which is what happens the moment a row comes back from a cache or a JSON
    // boundary instead of straight out of Postgres. `.toISOString()` on a string
    // is the exact throw that turned the whole list into "no saved chats".
    const summary = toConversationSummary({
      ...row,
      createdAt: "2026-09-23T15:00:00.000Z",
      updatedAt: "2026-09-23T15:49:44.837Z",
    });
    expect(summary.createdAt).toBe("2026-09-23T15:00:00.000Z");
    expect(summary.updatedAt).toBe("2026-09-23T15:49:44.837Z");
  });

  it("never renders an Invalid Date, and never a count it does not have", () => {
    const summary = toConversationSummary({
      ...row,
      createdAt: "not a date",
      updatedAt: undefined as unknown as Date,
      _count: undefined as unknown as { messages: number },
    });
    expect(summary.createdAt).toBe("");
    expect(summary.updatedAt).toBe("");
    expect(summary.messageCount).toBe(0);
  });

  it("reports a shared thread, and only from the token", () => {
    expect(toConversationSummary({ ...row, shareToken: "tok_abc" }).shared).toBe(true);
    expect(toConversationSummary({ ...row, shareToken: "" }).shared).toBe(false);
  });

  it("carries the newest message as the preview", () => {
    // The query returns the newest first; the row shown is that one, not the
    // opening question, which is what makes the list scannable.
    const summary = toConversationSummary({
      ...row,
      messages: [{ content: "and the queue is draining", role: "assistant" }],
    });
    expect(summary.preview).toBe("and the queue is draining");
  });
});

describe("previewOf", () => {
  it("collapses a multi-line message onto one line", () => {
    // Model output and pasted articles both arrive full of newlines; keeping
    // them shows the reader whitespace instead of words.
    expect(previewOf("first line\n\nsecond   line\t third")).toBe("first line second line third");
  });

  it("truncates at the preview length and not at the full body", () => {
    const preview = previewOf("x".repeat(500));
    expect(preview.length).toBe(PREVIEW_CHARS);
  });

  it("is empty rather than undefined for a missing message", () => {
    expect(previewOf(null)).toBe("");
    expect(previewOf(undefined)).toBe("");
    expect(previewOf("   ")).toBe("");
  });

  it("honours a caller's own length", () => {
    expect(previewOf("abcdefghij", 4)).toBe("abcd");
  });
});
