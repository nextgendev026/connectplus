import { describe, expect, it } from "vitest";
import { RECORD_INTENTS, isRecordIntent } from "@/lib/neural-intent";
import { isLearnableAnswer } from "@/lib/neural-mind";
import { serializePost, serializePosts } from "@/lib/feed-serialize";

/**
 * Three guards on the intelligence pipeline, each pinning a bug that failed
 * silently in production.
 *
 * They look unrelated — a feed field, an intent classification, a learning
 * filter — and they are one class of bug: a rule that had to be remembered in
 * more than one place, and was not.
 */

describe("RECORD_INTENTS — reports are read, not improvised", () => {
  it("covers the report surface", () => {
    // The one that broke: `hive_report` classified correctly and was then sent
    // to the LLM, which had no hive data and answered "not available".
    expect(isRecordIntent("hive_report")).toBe(true);
    for (const intent of [
      "system_health",
      "growth_report",
      "regional_analysis",
      "traffic_depth",
      "moderation_report",
    ] as const) {
      expect(isRecordIntent(intent)).toBe(true);
    }
  });

  it("leaves writing and conversation to the model", () => {
    // The model adds something here that the database cannot, which is the
    // whole point of keeping these off the list.
    for (const intent of ["write_content", "rewrite_content", "general_chat", "unknown"] as const) {
      expect(isRecordIntent(intent)).toBe(false);
    }
  });

  it("lists every declared record intent exactly once", () => {
    expect(new Set(RECORD_INTENTS).size).toBe(RECORD_INTENTS.length);
  });
});

describe("isLearnableAnswer — a refusal is not knowledge", () => {
  it("rejects the refusal that poisoned the hive", () => {
    // Captured verbatim from the production reply. Storing this as an `ai`
    // lesson made it recallable, and the next answer then cited it as proof the
    // report did not exist — the pipeline arguing for its own failure.
    const poison =
      "Based on the LIVE PLATFORM READINGS and HIVE MEMORIES, the hive mind report is **not available**.\n\n" +
      "Since the ground truth from the platform reads indicates the report is missing, I cannot generate or retrieve it.";
    expect(isLearnableAnswer(poison)).toBe(false);
  });

  it("rejects the other shapes of unavailability", () => {
    for (const answer of [
      "I could not retrieve that information from the platform right now.",
      "The requested records are unavailable at this time, please try again later.",
      "Unable to access the knowledge base for this request.",
      "No matching knowledge found in the memory bank. Try different keywords.",
      "I'm sorry, I cannot generate that report because the data is missing.",
    ]) {
      expect(isLearnableAnswer(answer)).toBe(false);
    }
  });

  it("rejects content too thin to be a lesson", () => {
    expect(isLearnableAnswer("")).toBe(false);
    expect(isLearnableAnswer(null)).toBe(false);
    expect(isLearnableAnswer(undefined)).toBe(false);
    expect(isLearnableAnswer("ok")).toBe(false);
  });

  it("keeps a substantive answer, including one that merely mentions a gap", () => {
    // The pattern has to be narrow: a false positive here silently deletes a
    // real lesson, so ordinary prose that happens to contain "not" must survive.
    expect(
      isLearnableAnswer(
        "Creators publishing more than four stories a month retain 2.3x better; " +
          "the retention curve flattens after the sixth post, so the lever is cadence, not volume."
      )
    ).toBe(true);
    expect(
      isLearnableAnswer(
        "Traffic is concentrated in Nairobi and Kampala, and the sports vertical is not a loss leader — it drives the highest return visits."
      )
    ).toBe(true);
  });
});

describe("serializePosts — one place derives the cover", () => {
  it("attaches a cover URL to every row", () => {
    const rows = [{ id: "post-aaaaaa", title: "A" }, { id: "post-bbbbbb", title: "B" }];
    const out = serializePosts(rows);
    expect(out.map((p) => p.coverImage)).toEqual([
      "/api/thumb/post/post-aaaaaa",
      "/api/thumb/post/post-bbbbbb",
    ]);
    // The selected shape is preserved, not replaced.
    expect(out[0]!.title).toBe("A");
  });

  it("does not mutate the input", () => {
    const row = { id: "post-cccccc" };
    serializePost(row);
    expect("coverImage" in row).toBe(false);
  });
});
