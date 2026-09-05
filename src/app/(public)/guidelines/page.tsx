import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { StaticPage } from "@/components/ui/StaticPage";

export const metadata: Metadata = {
  title: "Writing Guidelines | connectPlus",
  description:
    "Learn how to write stories that thrive on connectPlus — our community guidelines for writers.",
};

export default function GuidelinesPage() {
  return (
    <StaticPage
      icon={<Sparkles className="w-3.5 h-3.5 text-brand-400" />}
      title="Writing Guidelines"
      subtitle="A few simple rules keep connectPlus sharp, safe, and worth reading."
      updatedAt="5 September 2026"
      sections={[
        {
          heading: "Write what you know",
          body: "The most-read stories on connectPlus are grounded in real experience. First-hand reporting, honest opinions, and lived perspective outperform content written for algorithms. If you haven't lived it, say so.",
        },
        {
          heading: "Original work only",
          body: "Publish only your own original writing. AI-generated content without meaningful editorial input, plagiarised articles, and unauthorized reposts violate our standards and will be removed.",
        },
        {
          heading: "A good story structure",
          body: "Great articles follow an arc readers can trust:",
          items: [
            "An opening that earns attention in the first two sentences",
            "A body that delivers on the title's promise",
            "A conclusion that gives the reader something to take away",
            "Subheads, short paragraphs, and purposeful formatting",
          ],
        },
        {
          heading: "Respect the community",
          body: "Hate speech, harassment, doxxing, and misinformation have no home here. We moderate with care, and our AI assists human moderators — but every decision keeps community safety first.",
        },
        {
          heading: "Monetization ready",
          body: "Earn as you grow. Once you build a reader base, monetization is available so you can turn attention into income. See the Monetize page for details.",
        },
      ]}
    />
  );
}