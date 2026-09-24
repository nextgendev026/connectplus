import { tool } from "ai";
import { z } from "zod";
import { createContext, runInContext } from "node:vm";
import { platformIntelligence } from "@/lib/platform-intelligence";
import { searchWeb } from "@/lib/web-research";
import { prisma } from "@/lib/prisma";

/**
 * The general-purpose agent's tools.
 *
 * Platform senses already exist — `platform-intelligence.ts` reads creators,
 * trends, traffic and the economy out of the real database, with hard timeouts
 * and a no-fabrication policy. This module does not reimplement any of that;
 * it wraps it, so the agent and the dashboards can never disagree about what
 * the platform's numbers are.
 *
 * Two new capabilities sit beside them:
 *
 *   • **webSearch** — the open web. The keyless DuckDuckGo/Wikipedia research
 *     stack already in this repo is the default; Tavily is used only when
 *     `TAVILY_API_KEY` is set, and both degrade to `[]` rather than failing
 *     the turn.
 *   • **codeRunner** — arithmetic and algorithms. Model-written code runs in a
 *     `node:vm` context with no `require`, no `process`, no network, a 3s
 *     wall-clock timeout and a hard output cap. It cannot read files or make
 *     requests; when it fails, the failure text is the output.
 *
 * `getMyAccount` is scoped by construction: it takes no argument the model
 * could fill in, and the route injects the session's userId when it builds
 * the closure — the same principal-capture pattern the Super Admin agent
 * uses in `src/lib/ai/tools.ts`.
 */

/* ── webSearch ───────────────────────────────────────────────────────────── */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

/**
 * One search, Tavily when configured, keyless stack otherwise.
 *
 * Exported so the Inngest-side research helpers can reuse the same provider
 * choice without importing tools.
 */
export async function runWebSearch(query: string, limit = 5): Promise<WebSearchResult[] | { error: string }> {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          query,
          max_results: limit,
          search_depth: "basic",
        }),
        signal: AbortSignal.timeout(9_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
        const out = (data.results ?? []).slice(0, limit).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: (r.content ?? "").slice(0, 300),
          source: "tavily",
        }));
        if (out.length > 0) return out;
      }
    } catch {
      // fall through to the keyless stack
    }
  }

  const keyless = await searchWeb(query, limit);
  if (keyless.length === 0) return { error: "search unavailable" };
  return keyless.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet, source: r.source }));
}

/* ── codeRunner ──────────────────────────────────────────────────────────── */

/** One result of running model-written JavaScript in isolation. */
export interface CodeRunResult {
  ok: boolean;
  /** Console output plus the final expression's value. */
  output: string;
  /** Wall-clock duration in ms. */
  durationMs: number;
}

/**
 * Execute JavaScript in a `node:vm` sandbox: no require, no process, no
 * fetch, 3-second timeout, 8k output cap. The model cannot reach the
 * filesystem or the network with this; a `console` shim collects output
 * because the default console writes to the server's stdout, which would
 * interleave agent output with platform logs.
 */
export function runJsSandboxed(code: string): CodeRunResult {
  const started = Date.now();
  const lines: string[] = [];
  const push = (...args: unknown[]) => {
    if (lines.length >= 64) return;
    const rendered = args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
    lines.push(rendered.slice(0, 2_000));
  };

  try {
    const context = createContext({
      console: { log: push, error: push, warn: push },
      Math,
      JSON,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Map,
      Set,
      Date,
      BigInt,
      RegExp,
      Error,
      isNaN,
      parseInt,
      parseFloat,
      Intl,
    });
    const result = runInContext(code, context, { timeout: 3_000 });
    if (result !== undefined) push(String(result));
    return {
      ok: true,
      output: (lines.join("\n") || "(no output)").slice(0, 8_000),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      output: `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`.slice(0, 2_000),
      durationMs: Date.now() - started,
    };
  }
}

/* ── The toolset ─────────────────────────────────────────────────────────── */

/**
 * Build the toolset for one verified caller.
 *
 * The principal is captured in the closure, exactly as `agentTools` does in
 * the Super Admin toolset — there is no argument the model can fill in to
 * read someone else's account.
 */
export function generalAgentTools(principal: { userId: string }) {
  return {
    webSearch: tool({
      description:
        "Search the live web for current facts, news, prices, sport results, weather or who-is questions. " +
        "Returns up to five {title,url,snippet} results, or {error} when every provider fails.",
      inputSchema: z.object({
        query: z.string().min(3).describe("The search query, phrased the way a search engine wants it."),
      }),
      execute: async ({ query }) => runWebSearch(query, 5),
    }),

    codeRunner: tool({
      description:
        "Run a short JavaScript snippet in a sandbox for arithmetic, algorithms, data reshaping or logic. " +
        "No network, no filesystem, 3-second timeout. The final expression's value and console output are returned.",
      inputSchema: z.object({
        code: z.string().min(1).max(10_000).describe("JavaScript to run. console.log works; the last expression is returned."),
      }),
      execute: async ({ code }) => runJsSandboxed(code),
    }),

    getCreatorStats: tool({
      description:
        "Live stats for ONE creator from the ConnectPlus platform: followers, posts, views, engagement rate, " +
        "city, niches, 30-day follower growth. Read-only, from the same data the dashboards show.",
      inputSchema: z.object({
        creator: z.string().min(1).describe("Username of the creator, without the @."),
      }),
      execute: async ({ creator }) => {
        // Resolved by username — the tool the model sees takes a name it can
        // read off a chat message, not a database id.
        const user = await prisma.user.findUnique({
          where: { username: creator.toLowerCase() },
          select: { id: true, username: true },
        });
        if (!user) return { found: false, error: `No creator named "${creator}" exists on this platform.` };
        const context = await platformIntelligence.getCreatorContext(user.id);
        return context.found ? context : { found: false, error: `No stats found for "${creator}".` };
      },
    }),

    getRegionalTrends: tool({
      description:
        "What is trending on ConnectPlus, optionally scoped to one East African city (Nairobi, Kampala, " +
        "Dar es Salaam, Kigali): top topics, viral stories, per-city activity. Read-only.",
      inputSchema: z.object({
        city: z.string().optional().describe("City name, e.g. 'Nairobi'. Omit for all cities."),
        window: z.enum(["24h", "7d", "30d"]).optional().describe("Time window, default 7d."),
      }),
      execute: async ({ city, window }) => {
        const trends = await platformIntelligence.getTrendingFeeds(window ?? "7d");
        if (!city) return trends;
        const wanted = city.trim().toLowerCase();
        const byCity = trends.byCity.filter((c) => c.city.toLowerCase() === wanted);
        const cities = new Set(byCity.map((c) => c.city));
        return {
          window: trends.window,
          city: byCity[0]?.city ?? wanted,
          found: byCity.length > 0,
          topics: trends.topics.filter((t) => t.cities.some((c) => cities.has(c))),
          viral: trends.viral.filter((v) => v.city && cities.has(v.city)),
        };
      },
    }),

    getMyAccount: tool({
      description:
        "The signed-in user's own ConnectPlus account: profile, followers, posts, views, engagement, " +
        "subscription, tips received and payouts. Only ever returns the caller's own data.",
      inputSchema: z.object({}),
      execute: async () => {
        const context = await platformIntelligence.getCreatorContext(principal.userId);
        if (!context.found) {
          // A reader with no posts is a normal state, not an error.
          const me = await prisma.user.findUnique({
            where: { id: principal.userId },
            select: {
              username: true,
              name: true,
              bio: true,
              followersCount: true,
              followingCount: true,
              role: true,
              isVerified: true,
              node: true,
              createdAt: true,
              subscriptions: { where: { status: { in: ["active", "trialing"] } }, select: { status: true, provider: true } },
            },
          });
          if (!me) return { found: false, error: "Account not found." };
          return { found: true, account: me };
        }
        return context;
      },
    }),
  };
}

export const GENERAL_AGENT_TOOL_NAMES = [
  "webSearch",
  "codeRunner",
  "getCreatorStats",
  "getRegionalTrends",
  "getMyAccount",
] as const;

/**
 * A one-line description of each tool for the system prompt, so the model
 * knows what exists without the schema noise.
 */
export const GENERAL_AGENT_TOOL_NOTES =
  "Available tools: webSearch (live web facts), codeRunner (sandboxed JS for math/logic), " +
  "getCreatorStats (one creator's real stats), getRegionalTrends (city-level platform trends), " +
  "getMyAccount (the user's own account data)."
