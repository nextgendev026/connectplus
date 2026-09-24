// Read-only inventory of the radio roster and its logo state.
//
// The dial's `logoUrl` is either a real remote asset, a downloaded local asset,
// or an inline `data:image/svg+xml` placeholder. Only the first two are "real
// logos"; this script exists to count the third precisely, so "all stations have
// a logo" is a measured claim rather than a hopeful one.
//
// Run: node scripts/_radio-logo-audit.mjs [--json]

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/radio-stations.ts";

/** Parse the STATIONS array by brace-block, which survives nesting and comments. */
export function readStations(src = readFileSync(SRC, "utf8")) {
  const lines = src.split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    if (/^\s*\{\s*$/.test(line)) {
      if (cur) blocks.push(cur);
      cur = "";
      continue;
    }
    if (cur !== null) cur += line + "\n";
  }
  if (cur) blocks.push(cur);

  const field = (block, key) => {
    const m = block.match(new RegExp(`\\b${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`));
    return m ? m[2] : "";
  };

  return blocks
    .map((block) => {
      const id = field(block, "id");
      if (!id || !/^[a-z0-9-]+$/i.test(id)) return null;
      const logo = field(block, "logoUrl");
      return {
        id,
        name: field(block, "name"),
        country: field(block, "country"),
        city: field(block, "city"),
        streamUrl: field(block, "streamUrl"),
        logoUrl: logo,
        logoKind: logo.startsWith("data:")
          ? "placeholder"
          : logo.startsWith("/radio-logos/")
            ? "local"
            : logo
              ? "remote"
              : "missing",
      };
    })
    .filter(Boolean);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}

// Importing this module (the logo sync does, to reuse the parser) must not print
// a table as a side effect of the import.
const isEntryPoint = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

const stations = isEntryPoint ? readStations() : [];

if (!isEntryPoint) {
  // imported: expose readStations only
} else if (process.argv.includes("--json")) {
  console.log(JSON.stringify(stations, null, 2));
} else {
  const pad = (s, n) => String(s).slice(0, n).padEnd(n);
  console.log(
    pad("#", 3) + pad("id", 24) + pad("name", 22) + pad("country", 7) + pad("stream host", 30) + "logo",
  );
  stations.forEach((s, i) => {
    const shown =
      s.logoKind === "placeholder" ? "[svg placeholder]" : s.logoUrl.slice(0, 46) || "[none]";
    console.log(
      pad(i + 1, 3) +
        pad(s.id, 24) +
        pad(s.name, 22) +
        pad(s.country, 7) +
        pad(hostOf(s.streamUrl), 30) +
        shown,
    );
  });
  const by = (k) => stations.filter((s) => s.logoKind === k).length;
  console.log(
    `\ntotal=${stations.length} local=${by("local")} remote=${by("remote")} placeholder=${by("placeholder")} missing=${by("missing")}`,
  );
}
