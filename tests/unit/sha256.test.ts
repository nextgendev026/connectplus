import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/sha256";

/**
 * `sha256Hex` is a hand-written hash, so it is only worth using if it is the
 * *same* hash `node:crypto` produces. That is the whole contract: the Studio
 * compares fresh digests against ones it already holds, so a correct-but-
 * different algorithm would flag every unchanged document as edited.
 *
 * Each case below is the digest `createHash("sha256")` gives for the same
 * string, and the suite computes both rather than hard-coding vectors — a
 * literal hex string copied from the implementation would prove only that the
 * implementation is stable, not that it is SHA-256.
 */
function expected(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

describe("sha256Hex", () => {
  it("matches node:crypto on the published vectors", () => {
    // FIPS 180-4 / RFC 6234's own test vectors, which pin the answer
    // independently of any implementation in this repo.
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
  });

  it("matches node:crypto at every block-boundary length", () => {
    // The padding rules are where a hand-written SHA-256 actually goes wrong:
    // a message that already fills a block needs a whole extra one, and the
    // length field has to survive the transition. 55/56/64/119/120 are the
    // edges of that.
    for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 111, 119, 120, 127, 128, 129, 1000]) {
      const input = "a".repeat(length);
      expect(sha256Hex(input), `length ${length}`).toBe(expected(input));
    }
  });

  it("matches node:crypto on multi-byte text", () => {
    // UTF-8, not code points: an emoji is four bytes and would shift every
    // later offset if the encoder differed.
    const cases = [
      "composer",
      "Habari ya leo — tunapika?",
      "emoji 🚀 and combining e\u0301",
      "خط عربي and 日本語",
      JSON.stringify({ title: "Rage", tags: ["nai", "spo"] }),
    ];
    for (const input of cases) {
      expect(sha256Hex(input)).toBe(expected(input));
    }
  });

  it("matches node:crypto across a random sample", () => {
    // Property-style, because a fixed list only proves the cases someone
    // thought of. The seed is fixed, so a failure is reproducible.
    let seed = 0x2f6e2b1;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 200; i++) {
      const length = Math.floor(rand() * 300);
      let input = "";
      for (let j = 0; j < length; j++) input += String.fromCharCode(32 + Math.floor(rand() * 95));
      expect(sha256Hex(input), `sample ${i} (length ${length})`).toBe(expected(input));
    }
  });
});
