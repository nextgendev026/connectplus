import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { StaticPage } from "@/components/ui/StaticPage";

export const metadata: Metadata = {
  title: "About | connectPlus",
  description:
    "connectPlus is a modern social blogging platform connecting East Africa through stories, ideas, and perspectives.",
};

export default function AboutPage() {
  return (
    <StaticPage
      icon={<Sparkles className="w-3.5 h-3.5 text-brand-400" />}
      title="About connectPlus"
      subtitle="We believe every East African has a story worth telling. connectPlus is where those stories come alive."
      updatedAt="5 September 2026"
      sections={[
        {
          heading: "Our mission",
          body: "connectPlus exists to make East African voices impossible to ignore. From the tech startups of Nairobi to the music scenes of Kampala, from Kigali's coffee farms to Dar es Salaam's coast — we connect readers with writers who are shaping the region today.",
        },
        {
          heading: "What we build",
          body: "A social blogging platform with three things at its heart:",
          items: [
            "Writing without barriers — a focused studio where your words lead the way",
            "Discovery built on community — trending topics, categories, and writers worth following",
            "A story economy — writers get rewarded for engagement, joined-up thinking, and honest voices",
          ],
        },
        {
          heading: "Who it is for",
          body: "Students, journalists, creators, founders, and everyday East Africans. If you can tell a story, there is a place for you here. Every writer starts equal, and the community decides what rises.",
        },
        {
          heading: "Where we're going",
          body: "We're growing node by node — Nairobi, Kampala, Dar es Salaam, Kigali and beyond. Every new city we connect adds a new perspective to the conversation, and makes the region at large feel a little smaller.",
        },
      ]}
    />
  );
}