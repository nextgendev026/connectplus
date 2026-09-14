import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { StaticPage } from "@/components/ui/StaticPage";
import { PageJsonLd } from "@/components/seo/PageJsonLd";

const DESCRIPTION =
  "How to write stories that thrive on connectPlus: structure that holds a reader, original work and proper attribution, corrections, images and headlines, plus the community standards our moderators apply.";

const UPDATED_LABEL = "14 September 2026";
const UPDATED_ISO = "2026-09-14";

export const metadata: Metadata = {
  title: "Writing Guidelines",
  description: DESCRIPTION,
  keywords: [
    "how to write for connectPlus",
    "community guidelines",
    "attribution and corrections",
    "headline and image standards",
    "Kenyan writers publishing platform",
  ],
  alternates: { canonical: "/guidelines" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Writing Guidelines · connectPlus",
    description: DESCRIPTION,
    type: "website",
    url: "/guidelines",
  },
  twitter: {
    card: "summary",
    title: "Writing Guidelines · connectPlus",
    description: DESCRIPTION,
  },
};

export default function GuidelinesPage() {
  return (
    <>
      <PageJsonLd
        path="/guidelines"
        title="Writing Guidelines"
        description={DESCRIPTION}
        updated={UPDATED_ISO}
      />
      <StaticPage
        icon={<Sparkles className="w-3.5 h-3.5 text-brand-400" />}
        title="Writing Guidelines"
        subtitle="A few simple rules keep connectPlus sharp, safe and worth reading — here is what our editors look for and what our moderators act on."
        updatedAt={UPDATED_LABEL}
        sections={[
          {
            heading: "Write what you know",
            body: "The most-read stories on connectPlus are grounded in real experience. First-hand reporting, honest opinions and lived perspective outperform content written for algorithms. If you have not lived it, say so — that honesty is the difference between a useful piece and a hollow one.",
          },
          {
            heading: "Original work only",
            body: "Publish only your own original writing. AI-generated content without meaningful editorial input, plagiarised articles, and unauthorised reposts violate our standards and will be removed. Using an assistant to draft, tighten or translate is welcome; publishing its output unread is not, and the judgement in the finished piece has to be yours.",
          },
          {
            heading: "A good story structure",
            body: "Great articles follow an arc readers can trust:",
            items: [
              "An opening that earns attention in the first two sentences — the news, not the throat-clearing",
              "A body that delivers on the title's promise, in the order a reader needs it",
              "A conclusion that gives the reader something to take away",
              "Subheads, short paragraphs and purposeful formatting so the piece can be skimmed and still understood",
              "Sources named and linked inline, so a reader can check you rather than trust you",
            ],
          },
          {
            heading: "Headlines and images that do not mislead",
            body: "A headline should be a fair summary, not a dare. Avoid bait phrasing, invented urgency and claims the body does not support — a mismatched headline is the fastest way to lose a reader who would otherwise have stayed. Use an image you have the right to use, credit its creator where the licence requires it, and never present a stock or archival photo as a picture of a different event or person. Your cover is what a reader sees first in the feed and on every share card, so choose one that survives being cropped to a wide, small rectangle.",
          },
          {
            heading: "Attribution, syndication and quotes",
            body: "If you quote another publication, name it and link to it. If you are republishing an item that arrived through a public feed, keep the publisher's credit and the link back — that is what makes syndication legitimate rather than copying. Do not remove a source's watermark, byline or attribution, and do not present syndicated material as your own reporting.",
          },
          {
            heading: "Corrections",
            body: "Getting something wrong is not a hanging offence; hiding it is. When a fact changes or an error is pointed out, edit the story and add a short, dated note at the end saying what changed and when. We do not silently rewrite published pieces, and we treat a correction made honestly as a sign of a writer worth following.",
          },
          {
            heading: "Respect the community",
            body: "Hate speech, harassment, doxxing and misinformation have no home here. We moderate with care, and our AI assists human moderators — but every decision keeps community safety first, and a person reviews the outcome of every report. Disagreement is welcome, including sharp disagreement; targeting a person for who they are is not.",
          },
          {
            heading: "Monetization ready",
            body: "Earn as you grow. Once you build a reader base, monetization is available so you can turn attention into income — and the work that qualifies is the work this page describes: original, well-structured, honest, and worth a reader's time. See the Monetize page for the current requirements and payouts.",
          },
        ]}
      />
    </>
  );
}
