import { analyzeSeo, type SeoAnalysis } from "./seo-analyzer";
import { checkPlagiarism, type PlagiarismResult } from "./plagiarism-checker";
import { extractKeywords, analyzeSentiment, wordCount, stripHtml } from "./neural-text";

export interface OptimizationResult {
  overallScore: number;
  overallGrade: string;
  seo: SeoAnalysis;
  plagiarism: PlagiarismResult;
  contentQuality: {
    score: number;
    grade: string;
    metrics: {
      sentenceVariety: number;
      paragraphBalance: number;
      transitionUsage: number;
      activeVoice: number;
      factualDensity: number;
    };
  };
  optimizationPlan: {
    priority: "critical" | "important" | "suggestion";
    category: string;
    action: string;
    impact: string;
  }[];
  summary: string;
}

const TRANSITION_WORDS = new Set([
  "however", "moreover", "furthermore", "additionally", "consequently",
  "therefore", "meanwhile", "nevertheless", "conversely", "similarly",
  "likewise", "specifically", "particularly", "notably", "especially",
  "first", "second", "third", "finally", "next", "then", "also",
  "in addition", "on the other hand", "as a result", "for example",
  "in contrast", "in conclusion", "to sum up", "overall",
]);

const PASSIVE_INDICATORS = /\b(was|were|been|being|is|are|am)\s+(being\s+)?\w+ed\b/gi;
const ACTIVE_INDICATORS = /\b(I|we|you|he|she|they|the\s+\w+)\s+(wrote|published|created|developed|launched|introduced|reported|announced|discovered|found|said|noted|explained|argued|claimed|stated)\b/gi;

function analyzeSentenceVariety(sentences: string[]): number {
  if (sentences.length < 3) return 50;
  const lengths = sentences.map(s => s.split(/\s+/).length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / lengths.length;
  const stdDev = Math.sqrt(variance);
  // Good variety = stdDev of 5-12 words
  const score = stdDev < 3 ? 40 : stdDev < 5 ? 60 : stdDev <= 12 ? 85 : 70;
  return score;
}

function analyzeParagraphBalance(paragraphs: string[]): number {
  if (paragraphs.length < 2) return 40;
  const lengths = paragraphs.map(p => p.split(/\s+/).length);
  const idealRange: [number, number] = [50, 200]; // 50-200 words per paragraph
  const inRange = lengths.filter(l => l >= idealRange[0] && l <= idealRange[1]).length;
  const tooLong = lengths.filter(l => l > 300).length;
  let score = (inRange / lengths.length) * 100;
  if (tooLong > 0) score -= tooLong * 15;
  return Math.max(20, Math.min(100, Math.round(score)));
}

function analyzeTransitions(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  const total = words.length || 1;
  let transitionCount = 0;
  const lowerText = text.toLowerCase();
  for (const t of TRANSITION_WORDS) {
    if (lowerText.includes(t)) transitionCount++;
  }
  // 1-3 transitions per 500 words is ideal
  const per500 = (transitionCount / total) * 500;
  if (per500 >= 1 && per500 <= 4) return 85;
  if (per500 >= 0.5 && per500 <= 6) return 70;
  if (per500 === 0) return 30;
  return 50;
}

function analyzeActiveVoice(text: string): number {
  const passiveMatches = text.match(PASSIVE_INDICATORS);
  const activeMatches = text.match(ACTIVE_INDICATORS);
  const passive = passiveMatches?.length ?? 0;
  const active = activeMatches?.length ?? 0;
  const total = passive + active || 1;
  const activeRatio = active / total;
  return Math.round(activeRatio * 100);
}

function analyzeFactualDensity(text: string): number {
  // Count numbers, dates, proper nouns, quotes as factual indicators
  const numbers = (text.match(/\b\d+(?:\.\d+)?(?:\s*(?:%|percent|million|billion|thousand))?\b/g) ?? []).length;
  const dates = (text.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s*\d{4})?\b/gi) ?? []).length;
  const quotes = (text.match(/"[^"]{10,}"/g) ?? []).length;
  const properNouns = (text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? []).length;

  const wc = wordCount(text) || 1;
  const factualPer = (numbers + dates * 3 + quotes * 5 + properNouns * 2) / wc * 100;
  // 2-5 factual indicators per 100 words is ideal
  if (factualPer >= 2 && factualPer <= 5) return 85;
  if (factualPer >= 1 && factualPer <= 8) return 70;
  if (factualPer < 0.5) return 35;
  return 55;
}

export async function optimizeContent(
  title: string,
  content: string,
  excerpt?: string,
  excludePostId?: string
): Promise<OptimizationResult> {
  const plainText = stripHtml(content);
  const sentences = plainText.split(/[.!?]+(?:\s|$)/).filter(s => s.trim().length > 3);
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);

  // Run SEO and plagiarism analyses in parallel
  const [seo, plagiarism] = await Promise.all([
    Promise.resolve(analyzeSeo(title, content, excerpt)),
    checkPlagiarism(title, content, excludePostId),
  ]);

  // Content quality metrics
  const metrics = {
    sentenceVariety: analyzeSentenceVariety(sentences),
    paragraphBalance: analyzeParagraphBalance(paragraphs),
    transitionUsage: analyzeTransitions(plainText),
    activeVoice: analyzeActiveVoice(plainText),
    factualDensity: analyzeFactualDensity(plainText),
  };

  const qualityScore = Math.round(
    metrics.sentenceVariety * 0.2 +
    metrics.paragraphBalance * 0.2 +
    metrics.transitionUsage * 0.2 +
    metrics.activeVoice * 0.2 +
    metrics.factualDensity * 0.2
  );

  const qualityGrade = qualityScore >= 80 ? "Excellent" : qualityScore >= 65 ? "Good" : qualityScore >= 50 ? "Fair" : qualityScore >= 35 ? "Needs Work" : "Poor";

  // Overall score: blend SEO (40%), quality (35%), plagiarism (25%)
  const plagiarismScore = Math.max(0, 100 - plagiarism.overallScore);
  const overallScore = Math.round(seo.score * 0.4 + qualityScore * 0.35 + plagiarismScore * 0.25);
  const overallGrade = overallScore >= 80 ? "A" : overallScore >= 65 ? "B" : overallScore >= 50 ? "C" : overallScore >= 35 ? "D" : "F";

  // Optimization plan
  const plan: OptimizationResult["optimizationPlan"] = [];

  // Critical: plagiarism
  if (plagiarism.overallScore > 50) {
    plan.push({
      priority: "critical",
      category: "Originality",
      action: "Significant rewriting required — high similarity with existing content.",
      impact: "Ensures content originality and avoids copyright issues.",
    });
  } else if (plagiarism.overallScore > 25) {
    plan.push({
      priority: "critical",
      category: "Originality",
      action: "Paraphrase flagged sentences and add unique analysis.",
      impact: "Improves content originality score.",
    });
  }

  // SEO suggestions
  const highSeo = seo.suggestions.filter(s => s.priority === "high");
  for (const s of highSeo.slice(0, 3)) {
    plan.push({
      priority: "important",
      category: "SEO",
      action: s.message,
      impact: `Improves search visibility and keyword ranking.`,
    });
  }

  // Quality improvements
  if (metrics.activeVoice < 60) {
    plan.push({
      priority: "important",
      category: "Style",
      action: `Only ${metrics.activeVoice}% of sentences use active voice. Convert passive constructions to active voice.`,
      impact: "Makes writing more direct and engaging.",
    });
  }

  if (metrics.sentenceVariety < 50) {
    plan.push({
      priority: "suggestion",
      category: "Style",
      action: "Sentences are too similar in length. Mix short punchy sentences with longer detailed ones.",
      impact: "Improves reading rhythm and engagement.",
    });
  }

  if (metrics.transitionUsage < 50) {
    plan.push({
      priority: "suggestion",
      category: "Flow",
      action: "Add transition words between paragraphs (however, moreover, for example, etc.).",
      impact: "Improves logical flow and readability.",
    });
  }

  if (metrics.factualDensity < 30) {
    plan.push({
      priority: "suggestion",
      category: "Credibility",
      action: "Add specific facts, statistics, dates, or expert quotes to strengthen credibility.",
      impact: "Increases reader trust and shareability.",
    });
  }

  // Summary
  const strengths: string[] = [];
  const improvements: string[] = [];

  if (seo.score >= 70) strengths.push("Strong SEO foundation");
  if (qualityScore >= 70) strengths.push("Good content quality");
  if (plagiarism.isOriginal) strengths.push("Original content");
  if (metrics.activeVoice >= 70) strengths.push("Active, engaging voice");
  if (metrics.factualDensity >= 50) strengths.push("Well-sourced with facts");

  if (seo.score < 50) improvements.push("SEO optimization");
  if (qualityScore < 50) improvements.push("Content quality");
  if (!plagiarism.isOriginal) improvements.push("Originality");
  if (metrics.activeVoice < 50) improvements.push("Active voice usage");

  const summary = strengths.length > 0
    ? `Strengths: ${strengths.join(", ")}. ${improvements.length > 0 ? `Focus on: ${improvements.join(", ")}.` : "Ready to publish!"}`
    : `Needs improvement in: ${improvements.join(", ") || "multiple areas"}.`;

  return {
    overallScore,
    overallGrade,
    seo,
    plagiarism,
    contentQuality: {
      score: qualityScore,
      grade: qualityGrade,
      metrics,
    },
    optimizationPlan: plan,
    summary,
  };
}
