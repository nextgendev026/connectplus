import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { SearchX, Search, ArrowRight } from "lucide-react";
import { PostCard } from "@/components/blog/PostCard";
import type { PostWithAuthor } from "@/types";

export const metadata = {
  title: "Search - connectPlus",
  description: "Search stories from across East Africa.",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = params?.q?.trim() ?? "";

  const results = q
    ? await prisma.post.findMany({
        where: {
          status: "PUBLISHED",
          moderationStatus: "APPROVED",
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { excerpt: { contains: q, mode: "insensitive" } },
            { content: { contains: q, mode: "insensitive" } },
            { author: { name: { contains: q, mode: "insensitive" } } },
            { author: { username: { contains: q, mode: "insensitive" } } },
            { tags: { some: { name: { contains: q, mode: "insensitive" } } } },
          ],
        },
        include: {
          author: { select: { id: true, name: true, username: true, avatar: true } },
          category: { select: { id: true, name: true, slug: true } },
          tags: { select: { id: true, name: true, slug: true } },
          _count: { select: { comments: true, likes: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 40,
      })
    : [];

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-surface-50 mb-2">
          Search stories
        </h1>
        <p className="text-surface-400 text-sm">
          Find ideas, writers, and perspectives from across East Africa.
        </p>
      </div>

      <form
        method="GET"
        action="/search"
        className="mb-8 flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search by title, topic, writer, or tag..."
            className="w-full rounded-xl border border-surface-700 bg-surface-800 pl-9 pr-4 py-2.5 text-sm text-surface-50 placeholder-surface-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            autoFocus
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 transition-colors"
        >
          Search
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>

      {q ? (
        <>
          <p className="text-xs text-surface-500 mb-4">
            {results.length} {results.length === 1 ? "result" : "results"} for{" "}
            <span className="text-brand-400 font-medium">&quot;{q}&quot;</span>
          </p>
          {results.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {results.map((post) => (
                <PostCard key={post.id} post={post as PostWithAuthor} variant="wide" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-surface-700 py-16 text-center">
              <SearchX className="h-10 w-10 text-surface-600 mb-3" />
              <h2 className="text-surface-50 font-semibold mb-1">
                No stories found
              </h2>
              <p className="text-sm text-surface-400 max-w-sm mb-4">
                Try a different keyword, or browse the latest stories in the
                feed.
              </p>
              <Link
                href="/"
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 transition-colors"
              >
                Back to feed
              </Link>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-surface-700 py-16 text-center">
          <Search className="h-10 w-10 text-surface-600 mb-3" />
          <h2 className="text-surface-50 font-semibold mb-1">
            Start typing to explore
          </h2>
          <p className="text-sm text-surface-400 max-w-sm">
            Search by keyword, category, writer, or tag to discover stories
            across East Africa.
          </p>
        </div>
      )}
    </main>
  );
}
