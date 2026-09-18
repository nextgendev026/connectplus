import { faqJsonLd, resolveSiteOrigin, type FaqEntry } from "@/lib/seo";

/**
 * `FAQPage` markup for a public page.
 *
 * Kept beside `PageJsonLd` so both kinds of structured data are emitted from
 * one place. The questions passed here must also be visible on the page — see
 * the warning on `faqJsonLd`.
 */
export async function FaqJsonLd({
  path,
  questions,
}: {
  /** Route path, e.g. `/help`. */
  path: string;
  questions: readonly FaqEntry[];
}) {
  if (questions.length === 0) return null;
  const origin = await resolveSiteOrigin();
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: faqJsonLd({ url: `${origin}${path}`, questions }) }}
    />
  );
}
