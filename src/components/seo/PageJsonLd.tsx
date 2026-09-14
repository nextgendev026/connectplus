import { getSiteConfig } from "@/lib/settings";
import { resolveSiteOrigin, webPageJsonLd } from "@/lib/seo";

/**
 * `WebPage` + `BreadcrumbList` markup for a static page.
 *
 * Static pages are the ones a crawler reaches without any of the context an
 * article carries (no author, no dates in the markup), so giving each one an
 * explicit URL, name and description is what stops search engines inferring
 * them from the surrounding chrome — or from a syndicated story that quotes the
 * same words.
 */
export async function PageJsonLd({
  path,
  title,
  description,
  updated,
}: {
  /** Route path, e.g. `/privacy`. */
  path: string;
  title: string;
  description: string;
  /** ISO date the copy last changed. */
  updated?: string;
}) {
  const origin = await resolveSiteOrigin();
  let siteName = "connectPlus";
  try {
    siteName = (await getSiteConfig()).siteName;
  } catch {
    // keep the default brand name
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: webPageJsonLd({
          url: `${origin}${path}`,
          name: title,
          description,
          siteName,
          updated,
        }),
      }}
    />
  );
}
