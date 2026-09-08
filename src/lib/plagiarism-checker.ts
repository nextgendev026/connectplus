import { prisma } from "./prisma";
import { stripHtml } from "./neural-text";

export interface PlagiarismResult {
  overallScore: number; // 0-100, 0 = unique, 100 = fully copied
  isOriginal: boolean;
  matchingArticles: {
    id: string;
    title: string;
    slug: string;
    similarity: number;
    matchedSentences: string[];
  }[];
  sentenceAnalysis: {
    sentence: string;
    similarity: number;
    matchSource: string | null;
  }[];
  suggestions: string[];
}

const NGRAM_SIZE = 3; // trigrams for comparison
const MIN_SENTENCE_LENGTH = 15;
const MATCH_THRESHOLD = 0.6; // 60% similarity to flag a sentence
const OVERALL_THRESHOLD = 15; // >15% overall similarity = flagged

function generateNgrams(text: string, n: number): string[] {
  const words = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(w => w.length > 1);
  const ngrams: string[] = [];
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(" "));
  }
  return ngrams;
}

function ngramSimilarity(a: string, b: string): number {
  const ngramsA = generateNgrams(a, NGRAM_SIZE);
  const ngramsB = generateNgrams(b, NGRAM_SIZE);
  if (ngramsA.length === 0 || ngramsB.length === 0) return 0;

  const setB = new Set(ngramsB);
  let overlap = 0;
  for (const ng of ngramsA) {
    if (setB.has(ng)) overlap++;
  }
  return overlap / Math.max(ngramsA.length, ngramsB.length);
}

function sentenceSimilarity(a: string, b: string): number {
  const wordsA = a.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(w => w.length > 1);
  const wordsB = b.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(w => w.length > 1);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setB = new Set(wordsB);
  let overlap = 0;
  for (const w of wordsA) {
    if (setB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.length, wordsB.length);
}

function extractSentences(text: string): string[] {
  return text
    .split(/[.!?]+(?:\s|$)/)
    .map(s => s.trim())
    .filter(s => s.length >= MIN_SENTENCE_LENGTH);
}

export async function checkPlagiarism(
  draftTitle: string,
  draftContent: string,
  excludePostId?: string
): Promise<PlagiarismResult> {
  const draftText = stripHtml(draftContent);
  const draftSentences = extractSentences(draftText);

  if (draftSentences.length === 0) {
    return {
      overallScore: 0,
      isOriginal: true,
      matchingArticles: [],
      sentenceAnalysis: [],
      suggestions: [],
    };
  }

  // Fetch recent published articles from the database
  const where: Record<string, unknown> = { status: "PUBLISHED" };
  if (excludePostId) {
    where.id = { not: excludePostId };
  }

  const existingPosts = await prisma.post.findMany({
    where,
    orderBy: { publishedAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      slug: true,
      content: true,
    },
  });

  const matchingArticles: PlagiarismResult["matchingArticles"] = [];
  const sentenceAnalysis: PlagiarismResult["sentenceAnalysis"] = [];

  for (const post of existingPosts) {
    const existingText = stripHtml(post.content);
    const existingSentences = extractSentences(existingText);

    // Quick n-gram similarity check
    const overallSim = ngramSimilarity(draftText, existingText);
    if (overallSim < 0.05) continue; // Skip if very dissimilar

    const matchedSentences: string[] = [];
    let totalSentenceSim = 0;

    for (const draftSentence of draftSentences) {
      let bestSim = 0;
      let bestSource: string | null = null;

      for (const existingSentence of existingSentences) {
        const sim = sentenceSimilarity(draftSentence, existingSentence);
        if (sim > bestSim) {
          bestSim = sim;
          bestSource = existingSentence;
        }
      }

      if (bestSim >= MATCH_THRESHOLD) {
        matchedSentences.push(draftSentence);
        sentenceAnalysis.push({
          sentence: draftSentence.slice(0, 100),
          similarity: Math.round(bestSim * 100),
          matchSource: bestSource?.slice(0, 100) ?? null,
        });
      }
      totalSentenceSim += bestSim;
    }

    if (matchedSentences.length > 0 || overallSim > 0.15) {
      const articleSimilarity = Math.round(Math.max(overallSim, matchedSentences.length / Math.max(draftSentences.length, 1)) * 100);
      matchingArticles.push({
        id: post.id,
        title: post.title,
        slug: post.slug,
        similarity: articleSimilarity,
        matchedSentences: matchedSentences.map(s => s.slice(0, 100)),
      });
    }
  }

  // Calculate overall score
  const maxArticleSimilarity = matchingArticles.length > 0
    ? Math.max(...matchingArticles.map(a => a.similarity))
    : 0;
  const flaggedSentenceRatio = sentenceAnalysis.length / Math.max(draftSentences.length, 1);
  const overallScore = Math.round(Math.max(maxArticleSimilarity, flaggedSentenceRatio * 100));
  const isOriginal = overallScore <= OVERALL_THRESHOLD;

  // Sort matching articles by similarity
  matchingArticles.sort((a, b) => b.similarity - a.similarity);

  // Generate suggestions
  const suggestions: string[] = [];
  if (overallScore > 50) {
    suggestions.push("High similarity detected. Rewrite significantly to ensure originality.");
  } else if (overallScore > 25) {
    suggestions.push("Moderate similarity found. Paraphrase matching sentences and add original analysis.");
  } else if (overallScore > 10) {
    suggestions.push("Minor similarity detected. Review flagged sentences for proper attribution.");
  }

  if (matchingArticles.length > 0) {
    suggestions.push(`Similar to ${matchingArticles.length} existing article(s). Consider adding unique perspectives.`);
  }

  if (sentenceAnalysis.length > 3) {
    suggestions.push(`${sentenceAnalysis.length} sentences match existing content. Use quotes with attribution or rewrite.`);
  }

  return {
    overallScore,
    isOriginal,
    matchingArticles: matchingArticles.slice(0, 5),
    sentenceAnalysis: sentenceAnalysis.slice(0, 10),
    suggestions,
  };
}
