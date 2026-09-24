#!/usr/bin/env node
/**
 * Probe real station logos for the radio dial.
 *
 * The dial's `logoUrl` field is mostly a synthetic `data:` SVG tile — a gradient
 * with the call letters — because when the roster was written there was no real
 * logo to point at. That renders *something* on every card, and it is not the
 * station's logo. This script is how real ones get sourced and, more
 * importantly, **verified**: a URL that is merely plausible produces a broken
 * <img>, which is exactly the failure the tiles were hiding.
 *
 * Source: radio-browser.info, a community radio directory with per-station
 * `favicon` and `homepage` fields. Matches are made on name AND country, because
 * "Capital FM" is a Kenyan station here and also a Ugandan one, and the Ugandan
 * one's logo on a Nairobi card is worse than no logo.
 *
 * Every candidate is then fetched and kept only if it answers 200 with an
 * `image/*` content type. The output is a mapping to paste into
 * `src/lib/radio-stations.ts`, so the runtime never depends on this API.
 *
 *   node scripts/_probe-radio-logos.mjs            # report
 *   node scripts/_probe-radio-logos.mjs --json     # machine-readable
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "src", "lib", "radio-stations.ts");

const COUNTRY_CODE = {
  Kenya: "KE",
  Uganda: "UG",
  Rwanda: "RW",
  Tanzania: "TZ",
};

const UA = "connectplus-radio-probe/1.0 (+https://connectplusapp.vercel.app)";

/** id, name and country out of the roster, in declaration order. */
function readStations() {
  const text = readFileSync(SOURCE, "utf8");
  const blocks = text.split(/\n  \{\n/).slice(1);
  const out = [];
  for (const block of blocks) {
    const id = /\bid:\s*"([^"]+)"/.exec(block)?.[1];
    const name = /\bname:\s*"([^"]+)"/.exec(block)?.[1];
    const country = /\bcountry:\s*"([^"]+)"/.exec(block)?.[1];
    if (id && name && country) out.push({ id, name, country });
  }
  return out;
}

async function search(name, countryCode) {
  const url =
    `https://de1.api.radio-browser.info/json/stations/search?name=` +
    `${encodeURIComponent(name)}&limit=25&hidebroken=true`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return [];
  const all = await res.json();
  const rows = Array.isArray(all) ? all : [];
  // Same country first; a wrong-country match is not a match.
  const same = rows.filter((r) => (r.countrycode || "").toUpperCase() === countryCode);
  return same.length > 0 ? same : [];
}

async function isImage(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    return { type, bytes: buf.byteLength };
  } catch {
    return null;
  }
}

const stations = readStations();
const found = {};
const report = [];

for (const station of stations) {
  const code = COUNTRY_CODE[station.country];
  if (!code) continue;
  const rows = await search(station.name, code).catch(() => []);
  let chosen = null;
  for (const row of rows) {
    for (const candidate of [row.favicon, row.homepage ? `${row.homepage.replace(/\/+$/, "")}/favicon.ico` : ""]) {
      if (!candidate || !/^https?:/i.test(candidate)) continue;
      // A data: URI is a placeholder, not a logo — the directory carries those too.
      if (candidate.startsWith("data:")) continue;
      const check = await isImage(candidate);
      if (check) {
        chosen = { url: candidate, ...check, source: candidate === row.favicon ? "favicon" : "homepage" };
        break;
      }
    }
    if (chosen) break;
  }

  report.push({ id: station.id, name: station.name, country: station.country, matched: rows.length, chosen });
  if (chosen) found[station.id] = chosen.url;
  console.log(
    `${chosen ? "OK  " : "MISS"}  ${station.id.padEnd(24)} ${station.name.padEnd(26)} ${chosen ? `${chosen.type} ${chosen.bytes}B  ${chosen.url}` : `(${rows.length} country match${rows.length === 1 ? "" : "es"})`}`
  );
}

console.log(`\n${Object.keys(found).length} of ${stations.length} stations have a verified real logo.`);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(found, null, 2));
}
