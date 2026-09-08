import { extractKeywords, stripHtml, wordCount, analyzeSentiment } from "./neural-text";

export interface SeoAnalysis {
  score: number;
  grade: string;
  keywordDensity: { keyword: string; density: number; count: number }[];
  headingStructure: { level: number; text: string }[];
  readabilityScore: number;
  readabilityGrade: string;
  contentLength: { words: number; chars: number; paragraphs: number; sentences: number };
  metaDescription: string;
  suggestions: { category: string; priority: "high" | "medium" | "low"; message: string }[];
  internalLinks: number;
  externalLinks: number;
  imageCount: number;
  imagesWithAlt: number;
  firstParagraph: { hasKeyword: boolean; wordCount: number };
}

const READABILITY_LEVELS = [
  { max: 30, grade: "Very Difficult", label: "Academic/Technical" },
  { max: 50, grade: "Difficult", label: "College Level" },
  { max: 60, grade: "Fairly Difficult", label: "High School" },
  { max: 70, grade: "Standard", label: "Standard" },
  { max: 80, grade: "Fairly Easy", label: "Conversational" },
  { max: 100, grade: "Easy", label: "Simple/Child-friendly" },
];

function computeReadability(text: string): { score: number; grade: string } {
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter(s => s.trim().length > 2);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const syllableCount = words.reduce((sum, w) => sum + countSyllables(w), 0);

  if (sentences.length === 0 || words.length === 0) return { score: 50, grade: "Standard" };

  const avgWordsPerSentence = words.length / sentences.length;
  const avgSyllablesPerWord = syllableCount / words.length;

  // Flesch Reading Ease approximation
  const score = Math.round(206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord);
  const clamped = Math.max(0, Math.min(100, score));

  const level = READABILITY_LEVELS.find(l => clamped <= l.max) ?? READABILITY_LEVELS[5]!;
  return { score: clamped, grade: level.grade };
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  let count = 0;
  const vowels = "aeiouy";
  let prevVowel = false;
  for (const ch of w) {
    const isVowel = vowels.includes(ch);
    if (isVowel && !prevVowel) count++;
    prevVowel = isVowel;
  }
  if (w.endsWith("e") && count > 1) count--;
  return Math.max(1, count);
}

function extractHeadings(content: string): { level: number; text: string }[] {
  const headings: { level: number; text: string }[] = [];
  const htmlHeadings = content.matchAll(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi);
  for (const m of htmlHeadings) {
    if (m[1] && m[2]) headings.push({ level: parseInt(m[1]), text: stripHtml(m[2]) });
  }
  // Also check markdown headings
  for (const line of content.split("\n")) {
    const mdHeading = line.match(/^(#{1,6})\s+(.+)$/);
    if (mdHeading && mdHeading[2] && !headings.some(h => h.text === mdHeading[2])) {
      headings.push({ level: mdHeading[1]!.length, text: mdHeading[2] });
    }
  }
  return headings;
}

function generateMetaDescription(title: string, content: string, maxLen = 160): string {
  const plain = stripHtml(content).trim();
  const sentences = plain.split(/[.!?]+(?:\s|$)/).filter(s => s.trim().length > 15);
  const best = sentences.sort((a, b) => {
    let scoreA = 0, scoreB = 0;
    if (a.toLowerCase().includes(title.toLowerCase().split(" ")[0]?.toLowerCase() ?? "")) scoreA += 3;
    if (b.toLowerCase().includes(title.toLowerCase().split(" ")[0]?.toLowerCase() ?? "")) scoreB += 3;
    const wcA = a.split(/\s+/).length;
    const wcB = b.split(/\s+/).length;
    if (wcA >= 15 && wcA <= 30) scoreA += 2;
    if (wcB >= 15 && wcB <= 30) scoreB += 2;
    return scoreB - scoreA;
  });

  const selected = best.slice(0, 2).join(". ").trim();
  if (selected.length <= maxLen) return selected;
  return selected.slice(0, maxLen - 3).trimEnd() + "...";
}

export function analyzeSeo(title: string, content: string, excerpt?: string): SeoAnalysis {
  const plainText = stripHtml(content);
  const wc = wordCount(plainText);
  const chars = plainText.length;
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0).length;
  const sentences = plainText.split(/[.!?]+(?:\s|$)/).filter(s => s.trim().length > 3);

  // Keyword analysis
  const keywords = extractKeywords(title + " " + plainText, 10);
  const keywordDensity = keywords.map(k => ({
    keyword: k.keyword,
    density: Math.round((k.score * 1000)) / 10,
    count: (plainText.toLowerCase().match(new RegExp("\\b" + k.keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g")) ?? []).length,
  }));

  // Heading structure
  const headings = extractHeadings(content);

  // Readability
  const readability = computeReadability(plainText);

  // Link analysis
  const internalLinks = (content.match(/href="[^"]*(?:connectplus|\/article|\/category)/gi) ?? []).length;
  const externalLinks = (content.match(/href="https?:\/\/(?!connectplus)/gi) ?? []).length;

  // Image analysis
  const imageCount = (content.match(/<img\s/gi) ?? []).length + (content.match(/!\[/g) ?? []).length;
  const imagesWithAlt = (content.match(/<img[^>]*alt="[^"]+"/gi) ?? []).length + (content.match(/!\[[^\]]+\]/g) ?? []).length;

  // First paragraph keyword check
  const firstParagraph = plainText.split(/\n\n+/)[0] ?? "";
  const firstParaWords = firstParagraph.split(/\s+/).length;
  const topKeyword = keywords[0]?.keyword ?? "";
  const hasKeywordInFirst = topKeyword ? firstParagraph.toLowerCase().includes(topKeyword.toLowerCase()) : false;

  // Meta description
  const metaDescription = excerpt || generateMetaDescription(title, content);

  // Suggestions
  const suggestions: SeoAnalysis["suggestions"] = [];

  // Content length
  if (wc < 300) {
    suggestions.push({ category: "content", priority: "high", message: `Content is ${wc} words. Aim for 600+ words for better SEO.` });
  } else if (wc < 600) {
    suggestions.push({ category: "content", priority: "medium", message: `Content is ${wc} words. Consider expanding to 800+ for deeper coverage.` });
  }

  // Headings
  if (headings.length === 0) {
    suggestions.push({ category: "structure", priority: "high", message: "No headings found. Add H2/H3 headings to organize content and improve SEO." });
  } else if (!headings.some(h => h.level === 2)) {
    suggestions.push({ category: "structure", priority: "medium", message: "No H2 headings found. Add subheadings to break up long sections." });
  }

  // Keyword in first paragraph
  if (!hasKeywordInFirst && topKeyword) {
    suggestions.push({ category: "keywords", priority: "high", message: `Include "${topKeyword}" in the first paragraph for better keyword targeting.` });
  }

  // Keyword in title
  if (topKeyword && !title.toLowerCase().includes(topKeyword.toLowerCase())) {
    suggestions.push({ category: "keywords", priority: "medium", message: `Consider including "${topKeyword}" in the title.` });
  }

  // Readability
  if (readability.score < 40) {
    suggestions.push({ category: "readability", priority: "high", message: "Content may be too complex for general readers. Use shorter sentences and simpler words." });
  } else if (readability.score > 85) {
    suggestions.push({ category: "readability", priority: "low", message: "Content is very simple. Consider adding more depth or technical detail." });
  }

  // Images
  if (imageCount === 0) {
    suggestions.push({ category: "media", priority: "medium", message: "No images found. Add relevant images with descriptive alt text." });
  } else if (imagesWithAlt < imageCount) {
    suggestions.push({ category: "media", priority: "medium", message: `${imageCount - imagesWithAlt} images missing alt text. Add descriptive alt text for accessibility and SEO.` });
  }

  // Links
  if (internalLinks === 0 && wc > 200) {
    suggestions.push({ category: "links", priority: "low", message: "No internal links found. Link to related articles to improve navigation and SEO." });
  }

  // Sentiment balance
  const sentiment = analyzeSentiment(plainText);
  if (sentiment.score > 0.5) {
    suggestions.push({ category: "tone", priority: "low", message: "Content has a very positive tone. Consider adding balanced perspectives for credibility." });
  } else if (sentiment.score < -0.3) {
    suggestions.push({ category: "tone", priority: "medium", message: "Content has a negative tone. Consider adding positive outcomes or solutions." });
  }

  // Paragraph length
  const longParas = content.split(/\n\n+/).filter(p => p.trim().split(/\s+/).length > 150).length;
  if (longParas > 0) {
    suggestions.push({ category: "readability", priority: "medium", message: `${longParas} paragraph(s) exceed 150 words. Break them into shorter paragraphs.` });
  }

  // Score calculation
  let score = 70;
  if (headings.length >= 2) score += 5;
  if (headings.some(h => h.level === 2)) score += 3;
  if (wc >= 600) score += 5;
  if (wc >= 1000) score += 5;
  if (hasKeywordInFirst) score += 5;
  if (readability.score >= 50 && readability.score <= 80) score += 5;
  if (imageCount > 0) score += 3;
  if (internalLinks > 0) score += 2;
  const highPriCount = suggestions.filter(s => s.priority === "high").length;
  score -= highPriCount * 8;
  const medPriCount = suggestions.filter(s => s.priority === "medium").length;
  score -= medPriCount * 3;
  score = Math.max(0, Math.min(100, score));

  const grade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "F";

  return {
    score,
    grade,
    keywordDensity,
    headingStructure: headings,
    readabilityScore: readability.score,
    readabilityGrade: readability.grade,
    contentLength: { words: wc, chars, paragraphs, sentences: sentences.length },
    metaDescription,
    suggestions: suggestions.sort((a, b) => {
      const pri: Record<string, number> = { high: 3, medium: 2, low: 1 };
      return (pri[b.priority] ?? 0) - (pri[a.priority] ?? 0);
    }),
    internalLinks,
    externalLinks,
    imageCount,
    imagesWithAlt,
    firstParagraph: { hasKeyword: hasKeywordInFirst, wordCount: firstParaWords },
  };
}
