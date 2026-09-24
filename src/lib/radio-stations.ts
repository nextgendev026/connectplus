import { AD_FREE_STATIONS } from "@/lib/radio-adfree";

export interface RadioStation {
  id: string;
  name: string;
  country: string;
  city: string;
  region: string;
  genre: string;
  language: string;
  frequency: string;
  streamUrl: string;
  /** Ordered backup channels — the player and the probe walk these when the
   *  primary channel fails. Upstream mounts rotate (notably Zeno.fm), so a
   *  station is only as reliable as its fallback chain. */
  fallbacks?: string[];
  color: string;
  icon: string;
  tagline: string;
  logoUrl?: string;
  programming: string[];
  favorite: boolean;
  verified: boolean;
  /**
   * The bitrate the PRIMARY mount is known to serve, in kbps.
   *
   * Declared rather than guessed, and verified: `npm run radio:check` probes
   * every channel and fails when a live mount drops below the number here. It is
   * what lets the dial say "192 kbps" instead of "HD", and it is the floor that
   * turns "the stream got worse" from an invisible regression into a red check.
   * Omitted where no measurement exists — an absent value is honest, a made-up
   * one is not.
   */
  bitrateKbps?: number;
  /**
   * True when the primary mount belongs to the broadcaster (its own host or its
   * own CDN), rather than to a third-party relay that monetises listener time.
   * It is what separates "ad-free because the station is ad-free" from "ad-free
   * until the relay feels like it".
   */
  official?: boolean;
  /**
   * True when the station carries no advertising at all — licence-funded public
   * broadcasters and listener-supported services. These are the stations that
   * cannot serve a German spot to a Kenyan listener no matter where the request
   * comes from, which is the whole reason the roster exists.
   */
  adFree?: boolean;
}

/**
 * Every playable channel for a station, primary first. The same-origin proxy
 * (`/api/radio/stream?stationId=&source=`) walks this list server-side, so
 * failover never touches mixed-content or CORS — the browser only ever talks
 * to our origin.
 */
export function stationSources(station: RadioStation): string[] {
  return [station.streamUrl, ...(station.fallbacks ?? [])];
}

/**
 * Hosts that monetise a *free* relay.
 *
 * Several no-cost relays (Zeno, Radiojar, RadioKin, some shoutcast resellers)
 * sell listener time: a new HTTP session can open with a pre-roll spot, and a
 * long session is cut by mid-rolls. A broadcaster's own CDN mount does not do
 * this. The player cannot block an upstream's own ad break, but it can stop
 * *manufacturing* them — every reconnect opens a new session, and a reconnect
 * loop therefore turns one ad into an endless one. This list is what the player
 * uses to (a) prefer a cleaner channel and (b) stop re-dialling a rail that is
 * almost certainly playing a spot rather than music.
 */
export const AD_PRONE_HOSTS = [
  "zeno.fm",
  "radiojar.com",
  "radioking.com",
  "myradiostream.com",
  "shoutcast.com",
  "streamingv2.shoutcast.com",
  "radioca.st",
  "nextradio.live",
  // StreamTheWorld (Targetspot) is the professional end of the market rather
  // than a free relay, and it is the clearest case of the problem this list
  // exists to catch: it sells geo-targeted audio spots, choosing the creative
  // from the connecting IP. Two stations on the dial are served from it (Cool FM
  // and METRO FM), so a listener in Nairobi was the wrong audience for the spot
  // it picked. It is ad risk 2 like the free relays — the ad is not a fault, it
  // is the business model — and the player says so on a long stall.
  "streamtheworld.com",
];

/** Higher risk = more likely to interrupt a listener with a paid spot. */
export function sourceAdRisk(station: RadioStation, index: number): number {
  const url = stationSources(station)[index];
  if (!url) return 3;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 3;
  }
  return AD_PRONE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? 2 : 0;
}

/**
 * Whether a channel can be played straight from the station's server.
 *
 * This is the switch that decides everything about the listening experience,
 * and it is not a preference — it is a browser rule. A page served over https
 * may not play an http media subresource, and a good number of Kenyan and
 * Rwandan mounts are http-only, which is the entire reason the same-origin
 * proxy exists. Everything else is better direct: the listener gets the
 * bitrate the station actually serves instead of what a serverless function can
 * forward in its execution window, and the station (and any ad-inserting relay
 * in front of it) geolocates the LISTENER rather than this app's function
 * region — which is what made an East African audience hear German spots.
 */
export function canPlayDirect(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Whether a channel is one the browser can be handed directly. */
export function sourceIsDirect(station: RadioStation, index: number): boolean {
  const url = stationSources(station)[index];
  return url ? canPlayDirect(url) : false;
}

/**
 * A station counts as HD from 128 kbps up.
 *
 * 128 is the line the dial already uses everywhere else: the proxy negotiates
 * 128k mounts comfortably, the published Kenyan CDN mounts cluster around it
 * (Capital 128, Milele 128, Kameme 128), and below it a station is on the AAC
 * ladder for bad connections rather than for listeners who asked for quality.
 */
export const HD_FLOOR_KBPS = 128;

export function isHdStation(station: RadioStation): boolean {
  return (station.bitrateKbps ?? 0) >= HD_FLOOR_KBPS;
}

/**
 * The channel to open first.
 *
 * Three things are ranked, in this order, and the order is the point:
 *
 *  1. **Ad risk.** A relay that sells listener time can open a session with a
 *     spot, so it loses to any mount that does not, however fast it is.
 *  2. **Direct playability.** An https mount can be handed to the browser
 *     (full bitrate, listener's own IP); an http one can only go through the
 *     proxy. Among equally clean channels the playable one wins.
 *  3. **The station's own order.** Only now does the curated sequence break
 *     ties, so a primary still beats a fallback when they are otherwise equal.
 */
export function preferredSourceIndex(station: RadioStation): number {
  const sources = stationSources(station);
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < sources.length; i++) {
    const score = sourceAdRisk(station, i) * 100 + (sourceIsDirect(station, i) ? 0 : 10) + i;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export const RADIO_GENRES = [
  "All",
  "Pop / Hits",
  "Urban / R&B",
  "Hip Hop",
  "News / Talk",
  "Vernacular",
  "Indie / Trending",
  "Gospel",
  "Bongo Flava",
  "Afrobeats",
  // Genres the ad-free roster brought with it. Kept beside the regional ones
  // rather than in a second filter row: a listener looking for jazz does not
  // care which curation a station came from.
  "Jazz",
  "Funk / Soul",
  "Reggae",
  "World",
  "Eclectic",
  "Ambient / Electronic",
  "Indie / Alternative",
] as const;

export const RADIO_COUNTRIES = [
  "All",
  "Kenya",
  "Uganda",
  "Tanzania",
  "Rwanda",
  "Nigeria",
  "South Africa",
  "Ghana",
  "United States",
  "France",
  "United Kingdom",
  "International",
] as const;

export const STATION_REGIONS = [
  "All",
  "Nairobi",
  "Coast",
  "Rift Valley",
  "Kampala",
  "Dar es Salaam",
  "Arusha",
  "Kigali",
  "Lagos",
  "Johannesburg",
  "Accra",
  "London",
  "Paris",
  "San Francisco",
  "California",
  "Seattle",
] as const;

/**
 * The regional core of the dial: East African stations, first-party mounts
 * wherever the broadcaster publishes one.
 *
 * A note on provenance, because the two curations are not the same thing. Where
 * a station is marked `official`, the URL is the broadcaster's own mount (its
 * own host, or the CDN account it runs — Royal Media's Atunwa/StreamGuys,
 * Nation's StreamGuys, RBA's own Icecast, Crown Media's own server). Where the
 * mark is absent, the station is reached through a third-party relay that
 * monetises listener time, and the player treats it accordingly.
 */
const REGIONAL_STATIONS: RadioStation[] = [
  /* ============================== KENYA ============================== */
  {
    id: "capital-fm",
    name: "Capital FM",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "Pop / Hits",
    language: "English",
    frequency: "98.4 FM",
    streamUrl: "https://atunwadigital.streamguys1.com/capitalfm",
    bitrateKbps: 128,
    official: true,
    color: "#ef4444",
    icon: "C",
    tagline: "Kenya's #1 hit music station",
    // The broadcaster's own mark, served from their domain. The Wikimedia link
    // that used to be here answers 400 with an HTML error page, which is worse
    // than no URL at all: an <img> pointed at HTML is blocked by the browser's
    // opaque-response check (net::ERR_BLOCKED_BY_ORB), so the one station with a
    // "real" logo rendered as a broken tile and nothing said why. Verified 200
    // image/x-icon.
    logoUrl: "https://www.capitalfm.co.ke/favicon.ico",
    programming: ["Morning Drive", "Hits", "News Bulletins", "Talk"],
    favorite: true,
    verified: true,
  },
  /* NRG Radio was removed here rather than repaired. Its Shoutcast mount now
   * answers 404, and its declared fallback serves a different station entirely
   * (`icy-name: KENYA1 FM KENYA`) — every route to it is wrong, and a card that
   * plays the wrong station is worse than an absent card. Re-add it when a mount
   * can be verified: `npm run radio:check` is what says so. */
  {
    id: "radio-47",
    name: "Radio 47",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "Pop / Hits",
    language: "English / Swahili",
    frequency: "47 FM",
    streamUrl: "https://streaming.shoutcast.com/radio-47?ver=690109",
    fallbacks: ["https://stream.zeno.fm/t65cszbgunhvv"],
    color: "#f59e0b",
    icon: "47",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23f59e0b'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3E47%3C/text%3E%3C/svg%3E",
    tagline: "Songs for every mood",
    programming: ["Classic Mix", "Workday Hits", "Weekend Party"],
    favorite: false,
    verified: true,
  },
  {
    id: "classic-105",
    name: "Classic 105",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "Pop / Hits",
    language: "English",
    frequency: "105.3 FM",
    streamUrl: "https://atunwadigital.streamguys1.com/classic105",
    // The highest-bitrate Kenyan mount on the dial: 192 kbps MP3.
    bitrateKbps: 192,
    official: true,
    color: "#dc2626",
    icon: "105",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23dc2626'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='16' fill='white' text-anchor='middle'%3E105%3C/text%3E%3C/svg%3E",
    tagline: "Timeless hits from the 80s to today",
    programming: ["Classic Drive", "Greatest Hits", "Workday Anthems"],
    favorite: false,
    verified: true,
  },
  {
    id: "kiss-100",
    name: "Kiss 100",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "Urban / R&B",
    language: "English / Sheng",
    frequency: "100.0 FM",
    // `kissfm` is Kiss 100's live mount; the `kiss100fm` mount this entry used
    // to lead with now answers 502 on every request, so it moved to the fallback
    // chain where it belongs. Same host, same broadcaster, and it serves the
    // 128 kbps AAC the live mount does (reported as 127, as these mounts are).
    streamUrl: "https://atunwadigital.streamguys1.com/kissfm",
    fallbacks: ["https://atunwadigital.streamguys1.com/kiss100fm"],
    bitrateKbps: 128,
    official: true,
    color: "#f43f5e",
    icon: "K",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23f43f5e'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='24' fill='white' text-anchor='middle'%3EK%3C/text%3E%3C/svg%3E",
    tagline: "Kenya's non-stop urban music",
    programming: ["Kiss Drive", "Urban Hits", "R&B Nights"],
    favorite: false,
    verified: true,
  },
  {
    id: "hot-96",
    name: "Hot 96",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "Hip Hop",
    language: "English / Sheng",
    frequency: "96.0 FM",
    streamUrl: "https://atunwadigital.streamguys1.com/hot96",
    bitrateKbps: 50,
    official: true,
    color: "#f97316",
    icon: "96",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23f97316'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3E96%3C/text%3E%3C/svg%3E",
    tagline: "Hip hop and urban hits all day",
    programming: ["Hot Breakfast", "Hip Hop Flow", "Night Beats"],
    favorite: false,
    verified: true,
  },
  {
    id: "milele-fm",
    name: "Milele FM",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "Vernacular",
    language: "Swahili",
    frequency: "95.1 FM",
    streamUrl: "https://atunwadigital.streamguys1.com/milelefm",
    bitrateKbps: 128,
    official: true,
    color: "#eab308",
    icon: "M",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23eab308'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='24' fill='white' text-anchor='middle'%3EM%3C/text%3E%3C/svg%3E",
    tagline: "Swahili hits, stories and talk",
    programming: ["Bongo Mix", "Swahili Talk", "Request Hour"],
    favorite: false,
    verified: true,
  },
  {
    id: "radio-maisha",
    name: "Radio Maisha",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "Vernacular",
    language: "Swahili",
    frequency: "97.1 FM",
    streamUrl: "https://atunwadigital.streamguys1.com/radiomaisha",
    bitrateKbps: 128,
    official: true,
    color: "#14b8a6",
    icon: "RM",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2314b8a6'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3ERM%3C/text%3E%3C/svg%3E",
    tagline: "Swahili music and news from the Nation family",
    programming: ["Maisha Drive", "Swahili News", "Bongo Flava"],
    favorite: false,
    verified: true,
  },
  {
    id: "inooro-fm",
    name: "Inooro FM",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "Vernacular",
    language: "Kikuyu",
    frequency: "98.5 FM",
    streamUrl: "https://atunwadigital.streamguys1.com/inoorofm",
    bitrateKbps: 66,
    official: true,
    color: "#16a34a",
    icon: "I",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2316a34a'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='24' fill='white' text-anchor='middle'%3EI%3C/text%3E%3C/svg%3E",
    tagline: "Kikuyu hits, news and talk",
    programming: ["Kikuyu Mix", "Morning Talk", "Farming Show"],
    favorite: false,
    verified: true,
  },
  {
    id: "nation-fm",
    name: "Nation FM",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "News / Talk",
    language: "English",
    frequency: "93.3 FM",
    streamUrl: "http://stream.radiojar.com/3by7s8eg65quv",
    color: "#3b82f6",
    icon: "NF",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%233b82f6'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3ENF%3C/text%3E%3C/svg%3E",
    tagline: "Kenya's current affairs voice",
    programming: ["Morning Briefing", "Politics Today", "Business Hour"],
    favorite: false,
    verified: true,
  },
  {
    id: "ghetto-radio",
    name: "Ghetto Radio",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "Hip Hop",
    language: "Sheng",
    frequency: "89.5 FM",
    streamUrl: "https://stream.zeno.fm/kvudezx1h2zuv",
    fallbacks: ["https://stream.zeno.fm/cs4q33arb2zuv"],
    color: "#ec4899",
    icon: "G",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23ec4899'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='24' fill='white' text-anchor='middle'%3EG%3C/text%3E%3C/svg%3E",
    tagline: "Sheng hip hop from the streets",
    programming: ["Sheng Flow", "Underground Cyphers", "Gengetone Mix"],
    favorite: false,
    verified: true,
  },
  {
    id: "kameme-fm",
    name: "Kameme FM",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "Vernacular",
    language: "Kikuyu",
    frequency: "101.1 FM",
    streamUrl: "https://kamemefm-atunwadigital.streamguys1.com/kamemefm",
    bitrateKbps: 128,
    official: true,
    color: "#22c55e",
    icon: "K",
    // Real logo, sourced and verified by `npm run radio:logos` (see
    // scripts/_probe-radio-logos.mjs). The branded tile is still the fallback:
    // `icon` and `color` below are what render if this ever stops answering.
    logoUrl: "https://cdn.radiosphere.io/images/f6b2a79d-b842-40f7-993a-d0ec902b156f_1720863384.webp.90?type=medium&blocking=false",
    tagline: "Kikuyu hits, news and talk",
    programming: ["Kikuyu Classics", "Community Talk"],
    favorite: false,
    verified: true,
  },

  /**
   * The two national stations the dial was advertising but never carried.
   *
   * The README has promised "Capital FM, Kiss FM, NRG, Radio Citizen, Clouds"
   * for as long as it has existed, and Radio Citizen was not in the list — the
   * two most-listened-to stations in the country were missing from a Kenyan
   * radio hub. Both arrive from the broadcaster's own CDN (Royal Media's Atunwa
   * / StreamGuys account, the same one that already serves Inooro, Maisha and
   * Kameme), so they are official mounts with no relay and no ad layer of ours
   * in the path.
   */
  {
    id: "radio-citizen",
    name: "Radio Citizen",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "News / Talk",
    language: "Swahili",
    frequency: "106.7 FM",
    streamUrl: "https://atunwadigital.streamguys1.com/radiocitizen",
    // Interchangeable with the 128 kbps mounts around it, and the highest of the
    // Royal Media services we carry.
    bitrateKbps: 130,
    official: true,
    color: "#1d4ed8",
    icon: "RC",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%231d4ed8'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3ERC%3C/text%3E%3C/svg%3E",
    tagline: "Kenya's number one national station",
    programming: ["Jambo Kenya", "Waks Tiki Taka", "Mambo Mseto"],
    favorite: true,
    verified: true,
  },
  {
    id: "radio-jambo",
    name: "Radio Jambo",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "Vernacular",
    language: "Swahili",
    frequency: "97.5 FM",
    streamUrl: "https://atunwadigital.streamguys1.com/radiojambo",
    // Official, and only 64 kbps — declared as such so the card does not claim HD
    // it cannot deliver.
    bitrateKbps: 64,
    official: true,
    color: "#0f766e",
    icon: "RJ",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230f766e'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3ERJ%3C/text%3E%3C/svg%3E",
    tagline: "Swahili talk, sport and jambo reggae",
    programming: ["Swahili Talk", "Sport", "Jambo Reggae"],
    favorite: false,
    verified: true,
  },

  /* ============================== UGANDA ============================== */
  {
    id: "galaxie-fm",
    name: "Galaxie FM",
    country: "Uganda",
    city: "Kampala",
    region: "Kampala",
    genre: "Pop / Hits",
    language: "English / Luganda",
    frequency: "95.3 FM",
    streamUrl: "https://listen.radioking.com/radio/15684/stream/29075",
    color: "#06b6d4",
    icon: "GX",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2306b6d4'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3EGX%3C/text%3E%3C/svg%3E",
    tagline: "Kampala's biggest hits",
    programming: ["Breakfast Drive", "Luganda Hits", "Sunday Mix"],
    favorite: true,
    verified: true,
  },
  {
    id: "nrg-uganda",
    name: "NRG Radio Uganda",
    country: "Uganda",
    city: "Kampala",
    region: "Kampala",
    genre: "Indie / Trending",
    language: "English",
    frequency: "91.3 FM",
    streamUrl: "https://dc4.serverse.com/proxy/nrgugstream/stream",
    bitrateKbps: 128,
    // No fallback: the Zeno mount this entry used to fall back to answers
    // `icy-name: Next Radio` — it is another station's stream entirely, and it is
    // already carried (correctly) by Next Radio's own entry below. `radio:check`
    // is what found it.
    color: "#8b5cf6",
    icon: "NU",
    logoUrl: "https://www.nrgug.radio/favicon.ico",
    tagline: "Uganda's trending sound",
    programming: ["NRG Drive", "Trending Now"],
    favorite: false,
    verified: true,
  },
  {
    id: "spice-fm",
    name: "Spice FM",
    country: "Uganda",
    city: "Kampala",
    region: "Kampala",
    genre: "Urban / R&B",
    language: "English / Luganda",
    frequency: "98.8 FM",
    streamUrl: "https://spice988fm.radioca.st/stream",
    // 320 kbps — the best-sounding mount on the regional dial, and still a relay.
    bitrateKbps: 320,
    color: "#f43f5e",
    icon: "SP",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23f43f5e'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3ESP%3C/text%3E%3C/svg%3E",
    tagline: "Kampala's urban pulse",
    programming: ["Urban Breakfast", "R&B Evenings", "Luganda Mix"],
    favorite: false,
    verified: true,
  },
  {
    id: "next-radio",
    name: "Next Radio",
    country: "Uganda",
    city: "Kampala",
    region: "Kampala",
    genre: "Pop / Hits",
    language: "English / Luganda",
    frequency: "106.1 FM",
    streamUrl: "https://stream.nextradio.live/listen/nextradio/NextHD",
    bitrateKbps: 192,
    fallbacks: [
      "https://stream-154.zeno.fm/lbca7zintcnuv?zs=P9UBEqoSSr69riqZniMYMw",
      "https://stream-154.zeno.fm/lbca7zintcnuv",
    ],
    color: "#eab308",
    icon: "NR",
    logoUrl: "https://nextradio.co.ug/wp-content/uploads/2018/09/cropped-logo-1-180x180.gif",
    tagline: "The next big thing",
    programming: ["New Music First", "Kampala Nights"],
    favorite: false,
    verified: true,
  },
  {
    id: "sanyu-fm",
    name: "Sanyu FM",
    country: "Uganda",
    city: "Kampala",
    region: "Kampala",
    genre: "Pop / Hits",
    language: "English / Luganda",
    frequency: "88.2 FM",
    streamUrl: "https://s44.myradiostream.com:8138/stream",
    bitrateKbps: 48,
    fallbacks: ["http://s44.myradiostream.com:8138/stream"],
    color: "#f97316",
    icon: "S",
    logoUrl: "https://sanyufm.com/favicon.ico",
    tagline: "Uganda's oldest private station",
    programming: ["Morning Breeze", "Luganda Hits", "Classic Show"],
    favorite: false,
    verified: true,
  },

  /* ============================= TANZANIA ============================= */
  {
    id: "ear-radio",
    name: "East Africa Radio",
    country: "Tanzania",
    city: "Dar es Salaam",
    region: "Dar es Salaam",
    genre: "Urban / R&B",
    language: "Swahili / English",
    frequency: "Digital",
    streamUrl: "https://eatv.radioca.st/stream",
    bitrateKbps: 64,
    color: "#10b981",
    icon: "EA",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2310b981'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3EEA%3C/text%3E%3C/svg%3E",
    tagline: "Bongo flava and East African vibes",
    programming: ["Bongo Flava Mix", "East African Hits", "Request Show"],
    favorite: true,
    verified: true,
  },
  {
    id: "capital-tz",
    name: "Capital Radio",
    country: "Tanzania",
    city: "Dar es Salaam",
    region: "Dar es Salaam",
    genre: "Pop / Hits",
    language: "Swahili / English",
    frequency: "94.1 FM",
    streamUrl: "https://capitalradio.radioca.st/stream",
    bitrateKbps: 64,
    color: "#0ea5e9",
    icon: "CT",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230ea5e9'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3ECT%3C/text%3E%3C/svg%3E",
    tagline: "Tanzania's hit station",
    programming: ["Capital Drive", "Bongo Hits", "Weekend Mix"],
    favorite: false,
    verified: true,
  },
  {
    id: "crown-fm",
    name: "Crown FM",
    country: "Tanzania",
    city: "Arusha",
    region: "Arusha",
    genre: "Vernacular",
    language: "Swahili",
    frequency: "103.4 FM",
    streamUrl: "https://radio.crownmedia.co.tz:8443/crown",
    bitrateKbps: 128,
    official: true,
    color: "#84cc16",
    icon: "CR",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2384cc16'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3ECR%3C/text%3E%3C/svg%3E",
    tagline: "Northern Tanzania's voice",
    programming: ["Arusha Morning", "Swahili Classics", "Maasai Stories"],
    favorite: false,
    verified: true,
  },
  {
    id: "clouds-fm",
    name: "Clouds FM",
    country: "Tanzania",
    city: "Dar es Salaam",
    region: "Dar es Salaam",
    genre: "Bongo Flava",
    language: "Swahili",
    frequency: "102.5 FM",
    streamUrl: "http://eu6.fastcast4u.com:5306/;",
    bitrateKbps: 128,
    color: "#8b5cf6",
    icon: "CF",
    logoUrl: "https://cloudsmedia.co.tz/build/assets/clouds_icon-4199f5a8.png",
    tagline: "Tanzania's #1 Bongo Flava station",
    programming: ["Clouds Breakfast", "Bongo Hot", "Mic Tamtam"],
    favorite: false,
    verified: true,
  },

  /* ============================== RWANDA ============================== */
  {
    id: "radio-rwanda",
    name: "Radio Rwanda",
    country: "Rwanda",
    city: "Kigali",
    region: "Kigali",
    genre: "News / Talk",
    language: "Kinyarwanda / French",
    frequency: "95.0 FM",
    streamUrl: "https://listen.rba.co.rw:8008/rwanda/",
    bitrateKbps: 128,
    official: true,
    // No fallback: the Zeno mount this used to fall back to serves
    // `icy-name: Heaven FM Radio`, i.e. a third station. A fallback that plays
    // something else is worse than no fallback — it turns an outage into a
    // silent substitution. `radio:check` is what caught it.
    color: "#2563eb",
    icon: "RR",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%232563eb'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3ERR%3C/text%3E%3C/svg%3E",
    tagline: "The national broadcaster",
    programming: ["Morning News", "Kinyarwanda Talk", "National Service"],
    favorite: false,
    verified: true,
  },
  {
    id: "magic-fm",
    name: "Magic FM 90.7",
    country: "Rwanda",
    city: "Kigali",
    region: "Kigali",
    genre: "Pop / Hits",
    language: "Kinyarwanda / English",
    frequency: "90.7 FM",
    // The trailing `;` is load-bearing. Without it this host answers 302 to its
    // own Shoutcast web player (`index.html?sid=1`) and serves HTML — a player
    // page, not audio — which is what the card used to get; with it, the same
    // server streams `icy-name: 90.7 Magic FM` at 160 kbps.
    streamUrl: "http://listen.rba.co.rw:8080/;",
    // 160 kbps from the national broadcaster, but http-only: a page served over
    // https cannot hand the browser an http media subresource, so this mount is
    // proxy-only and never takes the direct path.
    bitrateKbps: 160,
    official: true,
    color: "#db2777",
    icon: "M",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23db2777'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='24' fill='white' text-anchor='middle'%3EM%3C/text%3E%3C/svg%3E",
    tagline: "Kigali's Feel-Good hits — RBA",
    programming: ["Morning Magic", "Kinyarwanda Hits", "Weekend Party"],
    favorite: false,
    verified: true,
  },

  /* ============================== NIGERIA ============================== */
  {
    id: "beat-fm",
    name: "Afrobeats Gospel Radio",
    country: "Nigeria",
    city: "Lagos",
    region: "Lagos",
    genre: "Afrobeats",
    language: "English / Pidgin",
    frequency: "Digital",
    streamUrl: "https://stream.zeno.fm/zyd9stmdlnlvv",
    color: "#f59e0b",
    icon: "BF",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23f59e0b'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3EBF%3C/text%3E%3C/svg%3E",
    tagline: "Afrobeats hits with a soulful twist",
    programming: ["Afrobeats Mix", "Gospel Grooves", "Lagos Nights"],
    favorite: false,
    verified: true,
  },
  {
    id: "cool-fm",
    name: "Cool FM 96.9",
    country: "Nigeria",
    city: "Lagos",
    region: "Lagos",
    genre: "Pop / Hits",
    language: "English / Pidgin",
    frequency: "96.9 FM",
    streamUrl: "http://18063.live.streamtheworld.com:3690/CJMKFMAAC_SC",
    // StreamTheWorld: geo-targeted ad insertion, and only 32 kbps. The card is
    // marked with both facts rather than pretending either away.
    bitrateKbps: 32,
    color: "#06b6d4",
    icon: "CF",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2306b6d4'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3ECF%3C/text%3E%3C/svg%3E",
    tagline: "Lagos' hottest hits",
    programming: ["Cool Drive", "Hit Music", "Lagos Vibes"],
    favorite: false,
    verified: true,
  },
  {
    id: "wazobia-fm",
    name: "Wazobia FM 99.5",
    country: "Nigeria",
    city: "Lagos",
    region: "Lagos",
    genre: "Vernacular",
    language: "Yoruba / Pidgin",
    frequency: "99.5 FM",
    streamUrl: "https://wazobiafmlagos951-atunwadigital.streamguys1.com/wazobiafmlagos951",
    bitrateKbps: 128,
    official: true,
    color: "#16a34a",
    icon: "W",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2316a34a'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='24' fill='white' text-anchor='middle'%3EW%3C/text%3E%3C/svg%3E",
    tagline: "Lagos in your language",
    programming: ["Yoruba Morning", "Pidgin Show", "Local Hits"],
    favorite: false,
    verified: true,
  },

  /* ============================= SOUTH AFRICA ============================ */
  {
    id: "metro-fm",
    name: "METRO FM",
    country: "South Africa",
    city: "Johannesburg",
    region: "Johannesburg",
    genre: "Urban / R&B",
    language: "English / Zulu",
    frequency: "104.8 FM",
    streamUrl: "http://28503.live.streamtheworld.com:3690/METRO_FMAAC_SC",
    bitrateKbps: 64,
    color: "#dc2626",
    icon: "M",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23dc2626'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3EMF%3C/text%3E%3C/svg%3E",
    tagline: "South Africa's urban beat",
    programming: ["Metro Drive", "Urban Jazz", "House Music"],
    favorite: false,
    verified: true,
  },
  /* 5FM was removed here for the same reason, and it is the case that made the
   * check worth writing: the "5FM" card was streaming `icy-name: Darom 101.5`,
   * a different station, from a mount that answered 200 with plausible audio.
   * Status and content type both looked healthy — only the upstream name gave it
   * away, which is exactly what `npm run radio:check` compares. SABC's own CDN
   * refuses unsigned requests (403), so there is no verifiable replacement. */
  {
    id: "jacaranda-fm",
    name: "Jacaranda FM",
    country: "South Africa",
    city: "Johannesburg",
    region: "Johannesburg",
    genre: "Pop / Hits",
    language: "English / Afrikaans",
    frequency: "94.2 FM",
    streamUrl: "https://live.jacarandafm.com/jacarandahigh.mp3",
    bitrateKbps: 128,
    official: true,
    color: "#7c3aed",
    icon: "JF",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%237c3aed'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3EJF%3C/text%3E%3C/svg%3E",
    tagline: "Great music and more",
    programming: ["Martin Bester", "Top 40", "Weekend Breakfast"],
    favorite: false,
    verified: true,
  },

  /* ================================ GHANA ================================ */
  {
    id: "joy-fm",
    name: "Joy FM",
    country: "Ghana",
    city: "Accra",
    region: "Accra",
    genre: "News / Talk",
    language: "English / Twi",
    frequency: "99.7 FM",
    streamUrl: "https://gateway.cdnstream1.com/2808_96.aac",
    bitrateKbps: 64,
    color: "#2563eb",
    icon: "JF",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%232563eb'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3EJF%3C/text%3E%3C/svg%3E",
    tagline: "Ghana's most trusted news station",
    programming: ["Super Morning Show", "Newsfile", "Prime Take"],
    favorite: false,
    verified: true,
  },
  {
    id: "adom-fm",
    name: "Adom FM",
    country: "Ghana",
    city: "Accra",
    region: "Accra",
    genre: "Vernacular",
    language: "Twi",
    frequency: "106.3 FM",
    streamUrl: "https://mmg.streamguys1.com/AdomFM-mp3",
    bitrateKbps: 128,
    official: true,
    color: "#ef4444",
    icon: "AF",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23ef4444'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='18' fill='white' text-anchor='middle'%3EAF%3C/text%3E%3C/svg%3E",
    tagline: "Ghana's leading Twi station",
    programming: ["Adom Dwaso", "Badwam Tribunal", "Nkommo Womu"],
    favorite: false,
    verified: true,
  },

  /* ============================ INTERNATIONAL =========================== */
  {
    id: "bbc-world",
    name: "BBC World Service",
    country: "International",
    city: "London",
    region: "London",
    genre: "News / Talk",
    language: "English",
    frequency: "Digital",
    streamUrl: "https://stream.live.vc.bbcmedia.co.uk/bbc_world_service",
    bitrateKbps: 56,
    official: true,
    adFree: true,
    color: "#991b1b",
    icon: "BBC",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23991b1b'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='16' fill='white' text-anchor='middle'%3EBBC%3C/text%3E%3C/svg%3E",
    tagline: "The world's radio station",
    programming: ["World News", "Africa Daily", "Focus on Africa"],
    favorite: false,
    verified: true,
  },
  /* BBC World Service is carried once, above.
   *
   * There used to be a second card here promising "East Africa" — first pointing
   * at the East Asia mount, then at `bbc_world_service_africa`. Both were wrong:
   * the Africa URL is not a stream at all, it 302s to https://www.bbc.co.uk/ and
   * answers HTML, and the Asia mount is the same 56 kbps World Service feed the
   * card above already carries. One service, one card. */
  {
    id: "kbc-english",
    // Named for the mount it actually serves: the Zeno relay published to this
    // station answers `icy-name: KBC Radio Taifa`, KBC's national service — the
    // card said "English Service" and played Taifa, which is a small lie the
    // check would flag and a listener would hear.
    name: "KBC Radio Taifa",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "News / Talk",
    language: "Swahili / English",
    frequency: "Digital",
    streamUrl: "http://stream.zeno.fm/ud2u96xst5quv",
    fallbacks: ["https://stream.zeno.fm/ud2u96xst5quv"],
    color: "#06b6d4",
    icon: "NTV",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2306b6d4'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='16' fill='white' text-anchor='middle'%3ENTV%3C/text%3E%3C/svg%3E",
    tagline: "The national broadcaster, live",
    programming: ["National News", "Swahili Service", "English Service"],
    favorite: false,
    verified: true,
  },
  {
    id: "qfm",
    name: "Q FM",
    country: "Kenya",
    city: "Nairobi",
    region: "Nairobi",
    genre: "Urban / R&B",
    language: "English / Sheng",
    frequency: "96.3 FM",
    streamUrl: "https://edge.mixlr.com/channel/rumps",
    fallbacks: ["http://edge.mixlr.com/channel/rumps"],
    color: "#e879f9",
    icon: "Q",
    logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23e879f9'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='bold' font-size='24' fill='white' text-anchor='middle'%3EQ%3C/text%3E%3C/svg%3E",
    tagline: "Nairobi's R&B groove",
    programming: ["R&B Evenings", "Sheng Hour", "Weekend Mix"],
    favorite: false,
    verified: true,
  },
];

/**
 * Every station on the dial.
 *
 * The regional core leads, so `STATIONS[0]` and the featured card stay East
 * African — this is an East African radio hub — and the ad-free HD roster
 * follows it as a distinct curation. `radio:check` walks the combined list.
 */
export const STATIONS: RadioStation[] = [...REGIONAL_STATIONS, ...AD_FREE_STATIONS];

export function getStationById(id: string | null): RadioStation | null {
  if (!id) return null;
  return STATIONS.find((s) => s.id === id) ?? null;
}

export function getStationsByCountry(country: string): RadioStation[] {
  return STATIONS.filter((s) => s.country === country);
}
