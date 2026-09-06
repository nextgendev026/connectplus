"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  X,
  Clock,
  TrendingUp,
  ArrowRight,
  Hash,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  className?: string;
  placeholder?: string;
  onSearch?: (query: string) => void;
}

const MOCK_RECENT = [
  "react server components",
  "next.js 14 app router",
  "tailwind dark mode",
];

const MOCK_TRENDING = [
  { tag: "AI", posts: 342 },
  { tag: "React", posts: 289 },
  { tag: "TypeScript", posts: 256 },
  { tag: "WebDev", posts: 198 },
  { tag: "Design", posts: 167 },
];

const MOCK_SUGGESTIONS = [
  "How to build a real-time chat with WebSockets",
  "Understanding React Server Components",
  "Tailwind CSS dark theme best practices",
  "Building a SaaS with Next.js 14",
  "PostgreSQL indexing strategies",
  "Kubernetes deployment guide for beginners",
];

export function SearchBar({
  className,
  placeholder = "Search articles, topics, authors...",
  onSearch,
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(MOCK_RECENT);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const showDropdown = isFocused;

  const filteredSuggestions = useMemo(() => {
    if (!query.trim()) return [];
    const lower = query.toLowerCase();
    return MOCK_SUGGESTIONS.filter((s) =>
      s.toLowerCase().includes(lower)
    ).slice(0, 5);
  }, [query]);

  const handleSearch = useCallback(
    (searchQuery: string) => {
      if (!searchQuery.trim()) return;
      setIsSearching(true);
      setRecentSearches((prev) => {
        const filtered = prev.filter((s) => s !== searchQuery.trim());
        return [searchQuery.trim(), ...filtered].slice(0, 5);
      });
      onSearch?.(searchQuery.trim());
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setTimeout(() => {
        setIsSearching(false);
        setIsFocused(false);
        inputRef.current?.blur();
      }, 400);
    },
    [onSearch, router]
  );

  const clearRecent = useCallback((e: React.MouseEvent, item: string) => {
    e.stopPropagation();
    setRecentSearches((prev) => prev.filter((s) => s !== item));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsFocused(true);
      }
      if (e.key === "Escape") {
        setIsFocused(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div
        className={cn(
          "flex items-center rounded-2xl border transition-all duration-300",
          isFocused
            ? "border-brand-500/50 bg-surface-800/80 shadow-glow ring-1 ring-brand-500/20"
            : "border-surface-700/50 bg-surface-800/50 hover:border-surface-600/50"
        )}
      >
        <div className="pl-4">
          {isSearching ? (
            <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
          ) : (
            <Search
              className={cn(
                "h-5 w-5 transition-colors",
                isFocused ? "text-brand-400" : "text-surface-500"
              )}
            />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch(query);
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent px-3 py-3.5 text-sm text-surface-50 placeholder-surface-500 outline-none"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="mr-1 rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-50"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <kbd className="mr-3 hidden select-none items-center gap-1 rounded-lg border border-surface-700 bg-surface-800 px-2 py-1 text-[11px] font-medium text-surface-400 sm:flex">
          ⌘K
        </kbd>
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-surface-700/50 bg-surface-900/95 shadow-2xl backdrop-blur-xl">
          {filteredSuggestions.length > 0 ? (
            <div className="p-2">
              <p className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-surface-500">
                Suggestions
              </p>
              {filteredSuggestions.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setQuery(suggestion);
                    handleSearch(suggestion);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-surface-300 transition-colors hover:bg-surface-800 hover:text-surface-50"
                >
                  <Search className="h-4 w-4 flex-shrink-0 text-surface-500" />
                  <span className="flex-1 truncate">{suggestion}</span>
                  <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-surface-600" />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-2">
              {recentSearches.length > 0 && (
                <div>
                  <p className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-surface-500">
                    Recent
                  </p>
                  {recentSearches.map((item, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setQuery(item);
                        handleSearch(item);
                      }}
                      className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-surface-300 transition-colors hover:bg-surface-800 hover:text-surface-50"
                    >
                      <Clock className="h-4 w-4 flex-shrink-0 text-surface-500" />
                      <span className="flex-1 truncate">{item}</span>
                      <button
                        onClick={(e) => clearRecent(e, item)}
                        className="flex-shrink-0 rounded-md p-1 text-surface-600 opacity-0 transition-all hover:bg-surface-700 hover:text-surface-300 group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </button>
                  ))}
                </div>
              )}

              <div className={cn("mt-1", recentSearches.length > 0 && "border-t border-surface-800 pt-1")}>
                <p className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-surface-500">
                  Trending
                </p>
                {MOCK_TRENDING.map((item) => (
                  <button
                    key={item.tag}
                    onClick={() => {
                      setQuery(item.tag);
                      handleSearch(item.tag);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-surface-300 transition-colors hover:bg-surface-800 hover:text-surface-50"
                  >
                    <Hash className="h-4 w-4 flex-shrink-0 text-brand-400" />
                    <span className="flex-1">{item.tag}</span>
                    <span className="text-xs text-surface-500">
                      {item.posts} posts
                    </span>
                    <TrendingUp className="h-3.5 w-3.5 flex-shrink-0 text-brand-500/50" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-surface-800 px-4 py-3">
            <button
              onClick={() => {
                handleSearch(query);
              }}
              disabled={!query.trim()}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-all",
                query.trim()
                  ? "bg-brand-600 text-white hover:bg-brand-500"
                  : "bg-surface-800 text-surface-500 cursor-not-allowed"
              )}
            >
              <Search className="h-4 w-4" />
              Search for &ldquo;{query || "..."}&rdquo;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
