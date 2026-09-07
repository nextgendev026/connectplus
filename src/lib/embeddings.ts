/**
 * Semantic embedding engine.
 *
 * This implementation is a lightweight, deterministic, dependency-free
 * "hashed bag-of-words" embedding (random projection over token hashes). It
 * runs anywhere (serverless, no model downloads, no network) and yields real
 * cosine similarity — enough to power semantic related/recommendation features
 * out of the box.
 *
 * The public interface (`embedText`, `cosineSimilarity`) is intentionally
 * stable so we can later drop in a true model (e.g. all-MiniLM via Xenova/ONNX)
 * without touching callers. Vectors are stored as JSON in PostEmbedding.
 */

export const EMBEDDING_DIM = 384;

// Deterministic string hash (FNV-1a) → uniform-ish 32-bit int in [0,1).
function hashTo01(token: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

// Split into token features: unigrams and character bigrams (captures some
// morphology so morphologically-similar words reinforce each other).
function tokenize(text: string): string[] {
  const clean = text
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return [];
  const unigrams = clean.split(" ");
  const features: string[] = [...unigrams];
  for (const u of unigrams) {
    if (u.length >= 4) {
      for (let i = 0; i < u.length - 1; i++) {
        features.push(`bg:${u.slice(i, i + 2)}`);
      }
    }
  }
  return features;
}

/** Produce a fixed-dim embedding vector from text (no external model needed). */
export function embedText(text: string, dim: number = EMBEDDING_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const features = tokenize(text);
  if (features.length === 0) return vec;

  // Weight: 1/sqrt(freq) softens the dominance of repeated tokens, and adds a
  // hashed sign so a feature is either "toward" or "away" (random projection).
  const seen = new Map<string, number>();
  let n = 0;
  for (const f of features) {
    seen.set(f, (seen.get(f) ?? 0) + 1);
    n++;
  }
  for (const [f, count] of seen) {
    const weight = 1 / Math.sqrt(count);
    const base = hashTo01(f, 0x9e3779b9);
    const idx = Math.floor(base * dim) % dim;
    const sign = hashTo01(f, 0x8_5ebca6b) > 0.5 ? 1 : -1;
    vec[idx] = (vec[idx] ?? 0) + sign * weight;
    // second probe reduces collisions
    const idx2 = (idx + Math.floor(hashTo01(f, 0xc2b2ae35) * (dim - 1)) + 1) % dim;
    vec[idx2] = (vec[idx2] ?? 0) + sign * weight * 0.5;
  }
  return vec;
}

/** Normalize a vector to unit length (L2). Mutates-free, returns new array. */
export function normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/** Cosine similarity in [-1, 1]. Treats near-zero vectors as dissimilar. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) * (a[i] ?? 0);
    nb += (b[i] ?? 0) * (b[i] ?? 0);
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

/** Encode embedding to a compact JSON string for storage. */
export function encodeVector(v: number[]): string {
  return JSON.stringify(v);
}

/** Decode a stored vector string back to number[]. */
export function decodeVector(s: string | null | undefined): number[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// Comprehensive tokenization for generation/summarization (heavy for /api/ai).
export function toWords(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean) || []
  );
}
