/**
 * Hardening for admin-configured integration snippets.
 *
 * The problem: `headScripts` and `chatWidgetScript` were rendered verbatim with
 * `dangerouslySetInnerHTML`, so *anyone who could write those settings could run
 * arbitrary JavaScript on every page of the site* — a stored-XSS capability
 * hiding behind a CMS field. A snippet is not content; it is code.
 *
 * The fix has three parts:
 *
 *   1. **Vetted provider templates.** The common case — Google Analytics,
 *      Plausible, Fathom, Umami — is generated from a provider id, so a
 *      legitimate analytics tag never requires pasting code at all.
 *   2. **A strict sanitizer for custom snippets.** External scripts are allowed
 *      only from an allowlist of analytics/chat hosts; inline `<script>` bodies
 *      are refused; event handlers, `javascript:`/`data:` URLs and any tag other
 *      than `script`/`noscript`/`img` are dropped. Nothing survives that can
 *      execute attacker-chosen code.
 *   3. **Escaping.** Any `</script` sequence left in the output is neutralised,
 *      so a snippet can never break out of the tag it is injected into.
 *
 * Pure and dependency-free so the rules are unit-tested without a browser.
 */

export type AnalyticsProvider = "none" | "ga4" | "plausible" | "fathom" | "umami";

export const ANALYTICS_PROVIDERS: { id: AnalyticsProvider; label: string; idHint: string }[] = [
  { id: "none", label: "None", idHint: "" },
  { id: "ga4", label: "Google Analytics 4", idHint: "G-XXXXXXXXXX" },
  { id: "plausible", label: "Plausible", idHint: "your-domain.com" },
  { id: "fathom", label: "Fathom", idHint: "site key" },
  { id: "umami", label: "Umami", idHint: "website id (UUID)" },
];

/** Hosts a custom snippet is allowed to load a script from. */
const DEFAULT_SCRIPT_HOSTS = [
  "www.googletagmanager.com",
  "www.google-analytics.com",
  "plausible.io",
  "cdn.usefathom.com",
  "cloud.umami.is",
  "analytics.umami.is",
  "static.cloudflareinsights.com",
  "connect.facebook.net",
  "analytics.tiktok.com",
  "snap.licdn.com",
  "js.intercomcdn.com",
  "widget.intercom.io",
  "client.crisp.chat",
  "embed.tawk.to",
  "cdn.jsdelivr.net",
];

/**
 * The allowlist, extended by `INTEGRATION_SCRIPT_HOSTS` (comma-separated) for
 * deployments that use a provider not covered above.
 */
export function allowedScriptHosts(extra?: string): string[] {
  const fromEnv = (extra ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...DEFAULT_SCRIPT_HOSTS, ...fromEnv])];
}

export interface SanitizeResult {
  /** The safe HTML, ready to inject. */
  html: string;
  /** Human-readable reasons for anything that was dropped. */
  blocked: string[];
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Neutralise anything that could close the tag we inject into. */
function escapeScriptBreakout(html: string): string {
  return html.replace(/<\s*\/\s*script/gi, "<\\/script");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = (m[1] ?? "").toLowerCase();
    if (!name || name.startsWith("on")) continue; // event handlers are never allowed
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function hostAllowed(host: string, allow: readonly string[]): boolean {
  return allow.some((a) => host === a || host.endsWith(`.${a}`));
}

/**
 * Reduce a snippet to the safe subset.
 *
 * Allowed and preserved: `<script src="https://allowed-host/…">` (external only),
 * `<img src="https://…">`, and `<noscript>` wrapping those. Everything else —
 * inline script bodies, event handlers, other tags, non-https and unlisted hosts
 * — is removed and reported in `blocked`.
 */
export function sanitizeIntegrationHtml(html: string, opts?: { allowedHosts?: readonly string[] }): SanitizeResult {
  const allow = opts?.allowedHosts ?? allowedScriptHosts(process.env.INTEGRATION_SCRIPT_HOSTS);
  const blocked: string[] = [];
  const out: string[] = [];

  const tagRe = /<\s*(script|noscript|img)\b([^>]*)>([\s\S]*?)<\s*\/\s*\1\s*>|<\s*(script|img)\b([^>]*?)\/?\s*>/gi;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(html)) !== null) {
    const tag = (m[1] ?? m[4] ?? "").toLowerCase();
    const rawAttrs = m[2] ?? m[5] ?? "";
    const inner = m[3] ?? "";
    const attrs = parseAttrs(rawAttrs);

    if (tag === "script") {
      const src = attrs.src ?? "";
      const host = hostOf(src);
      const hasInline = inner.trim().length > 0;

      // Order matters for the message an operator reads: a bare `<script>…</script>`
      // is inline code, and calling that "missing a src" would send them looking
      // for the wrong problem.
      if (hasInline && !src) {
        blocked.push("dropped inline JavaScript (a <script> with no external src)");
        continue;
      }
      if (!src || !host) {
        blocked.push("dropped a <script> without an https src");
        continue;
      }
      if (!hostAllowed(host, allow)) {
        blocked.push(`dropped a <script> from a host not on the allowlist (${host})`);
        continue;
      }
      if (hasInline) {
        blocked.push(`dropped inline JavaScript in the <script> from ${host}`);
      }
      const flags = [attrs.async !== undefined ? "async" : "", attrs.defer !== undefined ? "defer" : ""]
        .filter(Boolean)
        .join(" ");
      out.push(`<script src="${escapeAttr(src)}"${flags ? ` ${flags}` : ""}></script>`);
      continue;
    }

    if (tag === "img") {
      const src = attrs.src ?? "";
      const host = hostOf(src);
      if (!src || !host) {
        blocked.push("dropped an <img> without an https src");
        continue;
      }
      const size = [attrs.width ? ` width="${escapeAttr(attrs.width)}"` : "", attrs.height ? ` height="${escapeAttr(attrs.height)}"` : ""].join("");
      out.push(`<img src="${escapeAttr(src)}" alt=""${size} />`);
      continue;
    }

    if (tag === "noscript") {
      // A <noscript> is only useful for a tracking pixel; keep it if its inner
      // content is itself safe, otherwise drop the whole element.
      const innerResult = sanitizeIntegrationHtml(inner, { allowedHosts: allow });
      if (innerResult.html.trim()) {
        out.push(`<noscript>${innerResult.html}</noscript>`);
      }
      blocked.push(...innerResult.blocked);
    }
  }

  if (/<\s*(iframe|object|embed|style|base|form|meta)\b/i.test(html)) {
    blocked.push("dropped a disallowed element (iframe/object/embed/style/base/form/meta)");
  }
  if (/\son[a-z]+\s*=/i.test(html)) {
    blocked.push("dropped inline event-handler attributes");
  }

  return { html: escapeScriptBreakout(out.join("\n")), blocked };
}

/* ── Vetted provider templates ─────────────────────────────────────────────── */

const GA4_ID = /^(G|UA|AW|DC)-[A-Za-z0-9-]+$/;
const PLAUSIBLE_DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const FATHOM_KEY = /^[A-Za-z0-9_-]{4,64}$/;
const UMAMI_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Build the canonical snippet for a known analytics provider.
 *
 * This is how a legitimate analytics tag is added *without* anything injecting
 * arbitrary script — the code is ours, and only the id is configurable. Returns
 * "" for `none` or an id that does not match the provider's format.
 */
export function buildAnalyticsSnippet(provider: string | undefined, id: string | undefined): string {
  const value = (id ?? "").trim();
  switch ((provider ?? "none").toLowerCase()) {
    case "ga4":
      if (!GA4_ID.test(value)) return "";
      return [
        `<script async src="https://www.googletagmanager.com/gtag/js?id=${escapeAttr(value)}"></script>`,
        `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${value.replace(/'/g, "")}');</script>`,
      ].join("\n");
    case "plausible":
      if (!PLAUSIBLE_DOMAIN.test(value)) return "";
      return `<script defer data-domain="${escapeAttr(value)}" src="https://plausible.io/js/script.js"></script>`;
    case "fathom":
      if (!FATHOM_KEY.test(value)) return "";
      return `<script src="https://cdn.usefathom.com/script.js" data-site="${escapeAttr(value)}" defer></script>`;
    case "umami":
      if (!UMAMI_ID.test(value)) return "";
      return `<script defer src="https://cloud.umami.is/script.js" data-website-id="${escapeAttr(value)}"></script>`;
    default:
      return "";
  }
}

/** Validation detail for the settings console. */
export function analyticsIdProblem(provider: string | undefined, id: string | undefined): string | null {
  const value = (id ?? "").trim();
  if ((provider ?? "none") === "none") return null;
  if (!value) return "A measurement id is required for the selected provider.";
  return buildAnalyticsSnippet(provider, value) ? null : "The measurement id does not match this provider's format.";
}
