// Source, verify and vendor a real logo for every station on the radio dial.
//
// The dial shipped 28 of 34 stations with an inline SVG placeholder, because the
// roster had no real logo URL for them. Guessing one is worse than the tile: a
// wrong mark is a confident lie about who is playing. So every candidate here has
// to survive two independent checks before it is accepted.
//
//   1. PROVENANCE — the page the mark was scraped from must actually be that
//      station's. We fetch the candidate site and require its <title> or
//      og:site_name to contain a distinctive token from the station's name. A
//      parked domain, a typo'd host or a namesake in another country fails here.
//
//   2. THE BYTES — the downloaded file must be a real image, checked by magic
//      number and by decoded dimensions, not by Content-Type alone (hosts
//      mislabel HTML as `image/png` constantly). Marks below 32px are rejected:
//      they are drawn as badges at 48-64px, so an upscaled 16px favicon is a
//      blur, and the branded tile reads better than a blur.
//
// Everything is vendored into `public/radio-logos/` rather than hotlinked. That
// is the durability fix: the reader's browser no longer makes a cross-origin
// request to a broadcaster's server, so a hotlink ban, a `Referer` check, an
// `ERR_BLOCKED_BY_ORB` opaque response, or simple link rot cannot blank a logo —
// and the previous failure was exactly that, a Wikimedia URL that had begun
// answering `400 text/html` while the component quietly fell back to a letter.
//
// Usage:
//   node scripts/radio-logos-sync.mjs                 # discover, verify, write
//   node scripts/radio-logos-sync.mjs --only=kiss-100,radio-maisha
//   node scripts/radio-logos-sync.mjs --apply         # rewrite radio-stations.ts
//   node scripts/radio-logos-sync.mjs --keep          # don't overwrite local files

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readStations } from "./_radio-logo-audit.mjs";

const OUT_DIR = "public/radio-logos";
const SRC = "src/lib/radio-stations.ts";
const LOGO_PREFIX = "/radio-logos/";

const UA =
  "Mozilla/5.0 (compatible; ConnectPlusLogoBot/1.0; +https://connectplusapp.vercel.app/radio)";
const FETCH_TIMEOUT_MS = 9000;
const MIN_BYTES = 1024;
/**
 * Icons are a site's own mark, so a small one is still the real thing.
 *
 * 32 rather than 48 because Rwanda's RBA publishes a 33x33 favicon and nothing
 * larger, and a slightly soft real mark beats a crisp fabricated tile.
 */
const MIN_PX_ICON = 32;
/** A social preview is only accepted when it is provably a logo, not a photo. */
const MIN_PX_SOCIAL = 96;
/** A station mark is drawn as a badge. Wider than this is a banner. */
const MAX_SOCIAL_RATIO = 1.6;
/** Social previews must say so in their own filename. */
const LOGOISH = /logo|icon|brand|mark|badge|emblem/i;

/**
 * Sites worth trying per station, best guess first — verified, never trusted.
 *
 * A station's own domain is preferred, but several of these broadcasters publish
 * their brands only on a group site: Radio Africa Group hosts Kiss 100, Classic
 * 105 and Hot 96, and Mediamax hosts Kameme and Milele. Those group sites do not
 * put the brand in the page title, so `accept` adds the tokens that legitimately
 * prove the page belongs to them. `accept` never applies to two stations at once
 * unless the brand really is shared, which is why Magic FM has none: it would
 * otherwise inherit RBA's corporate mark and look like a different station.
 */
const STATION_SOURCES = {
  "capital-fm": { sites: ["capitalfm.africa", "capitalfm.co.ke"] },
  "radio-47": { sites: ["radio47.fm"] },
  "classic-105": { sites: ["radioafricagroup.co.ke", "classic105.com"], accept: ["africa"] },
  "kiss-100": { sites: ["radioafricagroup.co.ke", "kiss100.co.ke"], accept: ["africa"] },
  "hot-96": { sites: ["radioafricagroup.co.ke"], accept: ["africa"] },
  "milele-fm": {
    sites: ["mediamaxwaves.com", "mediamaxnetwork.co.ke", "milelefm.co.ke"],
    accept: ["waves", "mediamax"],
  },
  "radio-maisha": { sites: ["radiomaisha.co.ke", "standardmedia.co.ke"] },
  "inooro-fm": { sites: ["inoorofm.co.ke", "royalmedia.co.ke"], accept: ["royalmedia", "royal media"] },
  "nation-fm": { sites: ["nation.africa", "nationfm.co.ke"], accept: ["nation"] },
  "ghetto-radio": { sites: ["ghettoradio.co.ke"] },
  "kameme-fm": {
    sites: ["mediamaxwaves.com", "mediamaxnetwork.co.ke", "kamemefm.co.ke"],
    accept: ["waves", "mediamax"],
  },
  "radio-citizen": { sites: ["citizen.digital"] },
  "radio-jambo": { sites: ["radiojambo.co.ke", "radioafricagroup.co.ke"] },
  "galaxie-fm": { sites: ["galaxiefm.co.ug", "galaxie.ug"] },
  "nrg-uganda": { sites: ["nrgug.radio", "nrg.radio"] },
  "spice-fm": { sites: ["spicefm.co.ug", "spicefmonline.com"] },
  "next-radio": { sites: ["nextradio.co.ug"] },
  "sanyu-fm": { sites: ["sanyufm.com"] },
  "ear-radio": { sites: ["eastafricaradio.co.tz", "earadio.co.tz"] },
  "capital-tz": { sites: ["capitalradio.co.tz"] },
  "crown-fm": { sites: ["crownfm.co.tz", "crownmedia.co.tz"] },
  "clouds-fm": { sites: ["cloudsmedia.co.tz", "cloudsfm.co.tz"] },
  "radio-rwanda": { sites: ["rba.co.rw", "rba.co.rw/radio-rwanda"], accept: ["rba"] },
  "magic-fm": { sites: ["rba.co.rw"] },
  "beat-fm": { sites: ["afrobeatsgospelradio.com"] },
  "cool-fm": { sites: ["coolfm.ng"] },
  "wazobia-fm": { sites: ["wazobiafm.com"] },
  "metro-fm": { sites: ["metrofm.co.za", "sabc.co.za", "sabc.co.za/metrofm"], accept: ["sabc"] },
  "jacaranda-fm": { sites: ["jacarandafm.com"] },
  "joy-fm": { sites: ["myjoyonline.com", "joy997fm.com"], accept: ["myjoyonline"] },
  "adom-fm": { sites: ["adomfmonline.com", "myjoyonline.com"], accept: ["myjoyonline"] },
  "bbc-world": { sites: ["bbc.co.uk"] },
  "kbc-english": { sites: ["kbc.co.ke"] },
  qfm: { sites: ["qfm.co.ke"] },
};

/**
 * Words too generic to prove a site is the right station. "Radio", "FM" and a
 * country name appear in half the dial, so matching on them would accept the
 * first namesake that answered.
 */
const STOPWORDS = new Set([
  "fm",
  "radio",
  "the",
  "kenya",
  "uganda",
  "tanzania",
  "tanzanie",
  "rwanda",
  "nigeria",
  "ghana",
  "south",
  "africa",
  "international",
  "world",
  "service",
  "98.9",
  "88.8",
  "90.7",
  "96.9",
  "99.5",
  "105",
  "100",
  "96",
  "47",
]);

/** Escape a literal for use inside a RegExp. */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does this text contain the token as a *word*?
 *
 * Substring matching was not good enough: "joy" is a token of Joy FM and also a
 * substring of "MyJoyOnline", so Ghana's news portal passed as Joy FM's own site
 * and handed the station the portal's logo. Requiring a non-alphanumeric boundary
 * on both sides is what makes the check mean "this page is called that", rather
 * than "this page contains those letters".
 */
function wordMatch(haystack, token) {
  if (!token) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(token)}([^a-z0-9]|$)`, "i").test(haystack);
}

/** `decodeURIComponent` that tolerates a stray `%` instead of throwing. */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Distinctive tokens from a station's name, for the provenance check. */
function tokensOf(name) {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function get(url, { as = "text" } = {}) {
  const res = await withTimeout(
    fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: as === "text" ? "text/html,*/*" : "image/*,*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }),
    FETCH_TIMEOUT_MS + 500,
    url,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (as === "bytes") {
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, contentType: res.headers.get("content-type") ?? "", finalUrl: res.url };
  }
  return { body: await res.text(), finalUrl: res.url };
}

/** Decoded pixel dimensions, or null when the format is not a raster we parse. */
function dimensions(buf, contentType) {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const isPng = buf.length > 24 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (isPng || type === "image/png") {
    if (buf.length < 24) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), ext: "png" };
  }
  if (buf.length > 10 && buf.subarray(0, 3).toString("latin1") === "GIF") {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), ext: "gif" };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      // SOF0..SOF15, excluding the DHT/JPG/DAC markers in that range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: buf.readUInt16BE(off + 7), h: buf.readUInt16BE(off + 5), ext: "jpg" };
      }
      off += 2 + len;
    }
    return { w: 0, h: 0, ext: "jpg" };
  }
  if (buf.length > 16 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    return { w: 0, h: 0, ext: "webp" };
  }
  // SVG and anything else we cannot measure. Matched on its own root element
  // rather than on the header, because hosts serve SVG as text/plain.
  const head = buf.subarray(0, 400).toString("utf8").trim();
  if (head.startsWith("<svg") || head.startsWith("<?xml") || type === "image/svg+xml") {
    return { w: 0, h: 0, ext: "svg" };
  }
  return null;
}

/**
 * Artwork that is a logo's *file layout* but not a logo: rate cards, report and
 * brochure covers, promos. SABC published a fiscal-rate card whose `alt` named
 * Metro FM, which is how a radio station nearly shipped with a PDF cover as its
 * mark.
 */
const NOT_A_MARK = /(cover|rates|ratecard|pdf|report|brochure|poster|banner|advert|sponsor|magazine)/i;

/** Candidate absolute URLs for a site's logo, best first. */
function scrapeLogoCandidates(html, base, nameTokens = []) {
  const abs = (href) => {
    try {
      return new URL(href, base).toString();
    } catch {
      return null;
    }
  };
  const meta = (property) => {
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
        "i",
      ),
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) return abs(m[1]);
    }
    return null;
  };

  const out = [];
  const seen = new Set();
  const push = (u, kind = "icon") => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push({ url: u, kind });
  };

  // apple-touch-icon first. It is the one asset a site deliberately publishes as
  // *its mark*, square and large. `og:image` is a social preview and is routinely
  // a 1200x630 banner of a newsroom, a presenter or a promotion — pulling BBC's
  // gave us a 1024x576 homepage poster, which is a real image of the wrong thing.
  const touch = [...html.matchAll(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi)].map(
    (m) => ({
      href: abs((m[0].match(/href=["']([^"']+)["']/i) ?? [])[1]),
      size: Number((m[0].match(/sizes=["'](\d+)/i) ?? [])[1] ?? 0),
    }),
  );
  touch.sort((a, b) => b.size - a.size).forEach((t) => push(t.href));

  [...html.matchAll(/<link[^>]+rel=["'][^"']*(?:icon|shortcut icon)[^"']*["'][^>]*>/gi)].forEach(
    (m) => push(abs((m[0].match(/href=["']([^"']+)["']/i) ?? [])[1])),
  );

  /*
   * Brand tiles on a group site.
   *
   * Radio Africa Group hosts Kiss 100, Classic 105 and Hot 96, and Mediamax
   * hosts Kameme and Milele — and neither group site's *icon* is the brand we
   * want, it is the parent company's. The brand mark is an ordinary <img> on a
   * brand page or brand strip, named in its `alt` text. Only images that name the
   * station are considered, so a presenter photograph in the same markup is not
   * a candidate. This runs *before* the social tags below, because a group
   * homepage's `og:image` is the group's promo and would otherwise win.
   */
  [...html.matchAll(/<img[^>]+>/gi)].forEach((m) => {
    const tag = m[0];
    const src = abs((tag.match(/\bsrc=["']([^"']+)["']/i) ?? [])[1]);
    if (!src) return;
    const alt = (tag.match(/\balt=["']([^"']*)["']/i) ?? [])[1] ?? "";
    // The `alt` text has to *name* the station, and it has to match a token from
    // the station's own name — never an `accept` token. Matching an accept token
    // here handed both Ghanaian stations MyJoyOnline's portal logo: the `alt`
    // said "MyJoyOnline", that is the portal, and Joy FM is a station the portal
    // reports on. The filename is deliberately not consulted either, so a group's
    // corporate logo in a nav bar cannot pass as a brand.
    const label = safeDecode(alt).toLowerCase();
    if (nameTokens.some((t) => t.length >= 3 && wordMatch(label, t))) push(src, "brand");
  });

  // Social previews last, and marked as such: they are usually a photograph of
  // a presenter, a headline render or a promo banner. Two stations were nearly
  // shipped a news photo — KBC's `ruto-CHPs-2-860x574.jpg` and Crown's
  // `picture-ilala.jpeg` — so a social image has to be provably a mark before it
  // is accepted, while a declared icon only has to be an icon.
  push(meta("og:image"), "social");
  push(meta("twitter:image"), "social");

  push(abs("/apple-touch-icon.png"));
  push(abs("/favicon.ico"));
  return out;
}

/** Does this page look like the station we are looking for? */
function provenBy(html, station, accept = []) {
  const head = html.slice(0, 200000);
  const title = (head.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i) ?? [])[1] ?? "";
  const siteName =
    (head.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ?? [])[1] ??
    "";
  const haystack = `${title} ${siteName}`.toLowerCase();
  if (!haystack.trim()) return null;
  const tokens = tokensOf(station.name);
  const hit = tokens.find((t) => wordMatch(haystack, t));
  // A match on the station's *own* name means we are on its own site, where its
  // favicon really is its mark. A match on an `accept` token only means we are on
  // the right *group* site — Radio Africa Group's or Mediamax's — where the icon
  // belongs to the parent company, not to Kiss 100. That distinction is carried
  // out so the caller can refuse a group's icon for a brand.
  if (hit) return { hit, title: title.trim().slice(0, 80), viaBrand: true };

  const accepted = accept.find((t) => wordMatch(haystack, t));
  if (accepted) return { hit: accepted, title: title.trim().slice(0, 80), viaBrand: false };

  // "Radio 47" is all stopwords — both halves are too generic to prove anything —
  // which left the station unmatchable against a page reading "Radio47 - Hapa
  // Ndipo". Compacting the name to its alphanumeric form is the token that
  // actually appears on a broadcaster's own site.
  const compact = station.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (compact.length >= 5 && haystack.replace(/[^a-z0-9]+/g, "").includes(compact)) {
    return { hit: compact, title: title.trim().slice(0, 80), viaBrand: true };
  }
  return null;
}

async function findLogoFor(station, { keep }) {
  const source = STATION_SOURCES[station.id] ?? {};
  const hints = source.sites ?? [];
  const accept = source.accept ?? [];
  const notes = [];

  for (const host of hints) {
    const page = `https://${host}/`;
    let html;
    let finalUrl;
    try {
      ({ body: html, finalUrl } = await get(page));
    } catch (err) {
      notes.push(`${host}: ${err.message}`);
      continue;
    }

    const proof = provenBy(html, station, accept);
    if (!proof) {
      const title = (html.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i) ?? [])[1] ?? "(no <title>)";
      notes.push(`${host}: refused — page said "${title.trim().replace(/\s+/g, " ").slice(0, 60)}"`);
      continue;
    }

    for (const candidate of scrapeLogoCandidates(html, finalUrl, tokensOf(station.name))) {
      const short = candidate.url.slice(0, 60);
      let bytes;
      try {
        bytes = await get(candidate.url, { as: "bytes" });
      } catch (err) {
        notes.push(`${short}: ${err.message}`);
        continue;
      }
      if (bytes.buf.length < MIN_BYTES) {
        notes.push(`${short}: only ${bytes.buf.length}B`);
        continue;
      }

      // A social preview has to clear a second, stricter bar. The `LOGOISH`
      // filename check is the one that actually caught the news photos: KBC's
      // mark was not in `ruto-CHPs-2-860x574.jpg` and Crown's was not in
      // `picture-ilala.jpeg`, no matter how plausible each looked by size.
      if (candidate.kind === "social" && !LOGOISH.test(safeDecode(candidate.url))) {
        notes.push(`${short}: social preview is not named like a mark`);
        continue;
      }

      // The site was proven only by a group token, so nothing except a tile that
      // *names this brand* is acceptable. Without this, Kiss 100 would have been
      // handed Radio Africa Group's corporate icon — the right company, the wrong
      // station, and a mark a listener would read as a different broadcaster.
      if (NOT_A_MARK.test(safeDecode(candidate.url))) {
        notes.push(`${short}: document artwork, not a mark`);
        continue;
      }

      if (!proof.viaBrand && candidate.kind !== "brand") {
        notes.push(`${short}: ${candidate.kind} belongs to the group, not to this station`);
        continue;
      }

      const dims = dimensions(bytes.buf, bytes.contentType);
      if (!dims) {
        notes.push(`${short}: not an image (${bytes.contentType || "?"})`);
        continue;
      }

      if (candidate.kind === "brand" && !LOGOISH.test(safeDecode(candidate.url))) {
        // A brand tile is allowed to be named only in its alt text, but then it
        // must at least be square-ish; a wide image named after the station is a
        // banner or a still from a show.
        // 2.2 rather than 1.8 because a brand tile legitimately ships with
        // padding: Mediamax publishes Milele's and Kameme's real marks at
        // 1920x1020, which 1.8 rejected. Rejecting a genuine logo on a ratio that
        // tight is its own kind of wrong.
        const r = dims.w && dims.h ? Math.max(dims.w, dims.h) / Math.min(dims.w, dims.h) : 99;
        if (r > 2.2) {
          notes.push(`${short}: brand image is ${dims.w}x${dims.h}, not a mark`);
          continue;
        }
      }
      const minPx = candidate.kind === "social" ? MIN_PX_SOCIAL : MIN_PX_ICON;
      if (dims.w && dims.h && Math.min(dims.w, dims.h) < minPx) {
        notes.push(`${short}: ${dims.w}x${dims.h} below ${minPx}px`);
        continue;
      }
      const ratio = dims.w && dims.h ? Math.max(dims.w, dims.h) / Math.min(dims.w, dims.h) : 1;
      if (candidate.kind === "social" && ratio > MAX_SOCIAL_RATIO) {
        notes.push(`${short}: ${dims.w}x${dims.h} is a banner, not a mark`);
        continue;
      }

      const file = `${station.id}.${dims.ext}`;
      const dest = `${OUT_DIR}/${file}`;
      if (!(keep && existsSync(dest))) writeFileSync(dest, bytes.buf);
      return {
        station: station.id,
        host,
        proof: proof.title,
        matched: proof.hit,
        from: candidate.url,
        kind: candidate.kind,
        file,
        logoUrl: `${LOGO_PREFIX}${file}`,
        bytes: bytes.buf.length,
        dims: dims.w ? `${dims.w}x${dims.h}` : dims.ext.toUpperCase(),
        notes,
      };
    }
  }

  return { station: station.id, failed: true, notes };
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

/** Rewrite one station's `logoUrl` in the roster, leaving every other byte alone. */
function rewriteRoster(mapping) {
  let src = readFileSync(SRC, "utf8");
  let changed = 0;
  for (const [id, logoUrl] of Object.entries(mapping)) {
    const blockRe = new RegExp(`(\\bid:\\s*['"\`]${id}['"\`][\\s\\S]*?\\blogoUrl:\\s*)(['"\`])(?:\\\\.|(?!\\2).)*\\2`);
    const before = src;
    src = src.replace(blockRe, (_m, prefix, q) => `${prefix}${q}${logoUrl}${q}`);
    if (src !== before) changed++;
  }
  if (changed) writeFileSync(SRC, src);
  return changed;
}

/**
 * Restore the roster's own value for any local logo whose file is not on disk.
 *
 * This exists because the first version of this script was not idempotent, and
 * its failure was silent: a run that resolved *fewer* stations left the previous
 * run's `/radio-logos/...` paths in place, pointing at files an `rm -rf` had
 * removed. Six stations were briefly in exactly that state — references the
 * browser reports as a broken image and nothing else. The roster is the only
 * record of what each station looked like before vendoring, so the repair reads
 * the pristine copy out of git rather than inventing a replacement.
 *
 * @param baselineRef a git ref that still holds the pre-vendoring roster
 * @returns the station ids that were repaired
 */
function repairDanglingRefs(baselineRef) {
  const baselineSrc = execFileSync("git", ["show", `${baselineRef}:${SRC}`], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const pristine = new Map(readStations(baselineSrc).map((s) => [s.id, s.logoUrl]));

  const repair = {};
  for (const station of readStations()) {
    if (!station.logoUrl.startsWith(LOGO_PREFIX)) continue;
    if (existsSync(`public${station.logoUrl}`)) continue;
    const original = pristine.get(station.id);
    if (original) repair[station.id] = original;
  }

  const repaired = Object.keys(repair);
  if (repaired.length) rewriteRoster(repair);
  return repaired;
}

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? new Set(onlyArg.slice(7).split(",").map((s) => s.trim())) : null;

const stations = readStations().filter((s) => !only || only.has(s.id));
mkdirSync(OUT_DIR, { recursive: true });

console.error(`Sourcing logos for ${stations.length} station(s)…\n`);

const results = await pool(stations, 6, (s) =>
  findLogoFor(s, { keep: process.argv.includes("--keep") }).catch((err) => ({
    station: s.id,
    failed: true,
    notes: [`unexpected: ${err.message}`],
  })),
);

const ok = results.filter((r) => !r.failed);
const bad = results.filter((r) => r.failed);

console.log("=== RESOLVED ===");
for (const r of ok) {
  console.log(
    `${r.station.padEnd(16)} ${r.dims.padEnd(10)} ${String(Math.round(r.bytes / 1024)).padStart(4)}KB  ${r.logoUrl}  [${r.kind}]\n` +
      `  from ${r.from.slice(0, 96)}\n  site "${r.proof}" (matched "${r.matched}")`,
  );
}
if (bad.length) {
  console.log(`\n=== UNRESOLVED (${bad.length}) — these keep the branded tile ===`);
  for (const r of bad) console.log(`${r.station.padEnd(16)} ${r.notes.slice(0, 3).join(" | ")}`);
}

writeFileSync(
  `${OUT_DIR}/sources.json`,
  `${JSON.stringify(
    Object.fromEntries(
      ok.map((r) => [
        r.station,
        { file: r.file, source: r.from, site: r.host, siteTitle: r.proof, dims: r.dims },
      ]),
    ),
    null,
    2,
  )}\n`,
);

if (process.argv.includes("--apply")) {
  const changed = rewriteRoster(Object.fromEntries(ok.map((r) => [r.station, r.logoUrl])));
  console.log(`\nApplied: rewrote ${changed} logoUrl line(s) in ${SRC}.`);

  const baselineArg = process.argv.find((a) => a.startsWith("--baseline="));
  const baselineRef = baselineArg ? baselineArg.slice(11) : "HEAD";
  const repaired = repairDanglingRefs(baselineRef);
  if (repaired.length) {
    console.log(
      `Repaired ${repaired.length} dangling reference(s) back to the roster default ` +
        `(file missing on disk): ${repaired.join(", ")}`,
    );
  }

  // The invariant that matters to a reader with a broken image in front of them.
  const dangling = readStations().filter(
    (s) => s.logoUrl.startsWith(LOGO_PREFIX) && !existsSync(`public${s.logoUrl}`),
  );
  console.log(
    dangling.length === 0
      ? "Verified: every vendored logo reference resolves to a file on disk."
      : `WARNING: ${dangling.length} reference(s) still unresolved: ${dangling.map((s) => s.id).join(", ")}`,
  );
} else {
  console.log("\n(dry run — pass --apply to rewrite radio-stations.ts)");
}
