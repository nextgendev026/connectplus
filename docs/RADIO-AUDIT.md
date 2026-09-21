# ConnectPlus Radio — Audit and Plan

Branch `phase-a/baseline-audit-and-docs` · base `main` · 2026-09-21

The pre-implementation audit the radio brief requires. Every claim below is grounded in a file and
line inspected during this session.

Companion documents: `docs/MODERNIZATION-AUDIT.md` (platform findings `F-nn`),
`docs/CONNECTPLUS-AI-IMPLEMENTATION-AUDIT.md`, `docs/ADMIN-INTEGRATIONS-AUDIT.md`,
`docs/phase-reports/PHASE-F-G-S-I.md`.

Baseline at audit time: `npm run typecheck` exit 0 · `npm run lint` 0 errors · `npm test` **102 files,
1666 passed, 1 skipped** · `npm run build` blocked by F-01 (needs a live database on the prerender
path) · `npm run test:e2e` runs against the machine's Chrome via `PLAYWRIGHT_CHANNEL=chrome`
(the bundled chromium cannot be downloaded here).

---

## 0. The headline, before the findings

**The radio system is considerably more mature than the brief assumes, and the brief's plan is
partly aimed at problems that do not exist here.** Writing down the things that are already right
is not padding — a plan that rebuilds a working reconnect policy or re-implements Media Session
spends its effort on the part of this subsystem that needs it least.

Already implemented, verified in the source, and **not** proposed for rework:

| The brief asks for | Reality |
| --- | --- |
| Exponential backoff with jitter | `RECONNECT_FLOOR_MS = 8000`, `delay = min(8000 * 2^n, 60_000)` (`RadioPlayerContext.tsx:245–247`) |
| Only one audio stream at a time | A single `audioRef` reused across stations (`:132`) — no second `Audio` element is ever constructed |
| Respect autoplay policy | Source is preloaded *without* playing; playback needs a gesture (`:312`) |
| Release resources on stop | `pause()` + `removeAttribute("src")` + `load()` on stop and unmount (`:275–280`, `:377–380`) |
| Distinguish ad break from outage | Explicit: a break wants patience, an outage wants a reconnect (`:75`, `:195–205`) |
| Detect stalled audio | A dedicated `stallTimer` reschedules rather than assuming health (`:189`, `:224`) |
| Direct/proxy awareness | Direct is attempted once per session, then settles; failed direct channels are remembered (`:151–157`) |
| Media Session | Implemented — `metadata`, `play`, `pause`, `previoustrack`, `nexttrack` (`:652–662`) |
| Broken-logo fallback | `StationThumb` falls back to a branded gradient tile on image error (`StationThumb.tsx:14–25`) |
| One call for the whole dial | `/api/radio/stations` returns every station's signal in one round-trip instead of N polls |
| ICY metadata must not corrupt audio | The proxy strips interleaved ICY blocks with a cross-chunk state machine (`stream/route.ts:112–146`) |
| Don't hand the browser a cross-origin URL | Same-origin proxy exists precisely to avoid CORS/UA-filter/hostname blocking |

The genuine gaps are narrower, and three of them are not in the brief's plan at all.

---

## 1. Current architecture

```
src/app/(public)/radio/page.tsx          728  the dial: search, filters, grid, hero, insights
src/app/(public)/radio/layout.tsx         48
src/components/radio/
  RadioPlayerContext.tsx                  767  the player: state, reconnect, Media Session, direct/proxy
  RadioHeroInsights.tsx                   306
  RadioPlayerBar.tsx                      241  the persistent bar
  MiniRadioPlayer.tsx                     126
  StationThumb.tsx                         63
src/lib/
  radio-stations.ts                      1003  ← the entire station catalog, as source literals
  radio-adfree.ts                         396
  radio-status-fetch.ts                   157
  radio-status.ts                          49  Icecast/Shoutcast parsers (network-free, well tested)
src/app/api/radio/
  stream/route.ts                         150  same-origin live-audio proxy
  probe/route.ts                          134  walks the failover chain, reports which channels answer
  stations/route.ts                        77  the whole dial's signal in one response
  status/route.ts                          60  one station's now-playing
```

Four API routes, nine modules, ~4,300 lines. Two test files: `radio-dial.test.ts`,
`radio-status.test.ts`.

### The finding that shapes everything else

**There is no radio data model.** `grep -niE "^model .*(radio|station|stream)" prisma/schema.prisma`
returns nothing. The catalog is `export const STATIONS: RadioStation[] = [...REGIONAL_STATIONS,
...AD_FREE_STATIONS]` — **994 lines of station object literals in TypeScript** (`radio-stations.ts:994`).

Everything downstream follows from that one fact:

- An admin cannot disable a broken station without a code change and a deploy. The brief's Phase 13
  admin actions (test / retry / disable / enable / priority) have **nothing to act on**.
- There is nowhere to record a health check, so the brief's `RadioHealthCheck`, `RadioStationEvent`
  and `RadioSweepRun` (Phase 16) do not exist and cannot be added additively — they need a station
  row to hang off.
- "Who disabled this station and when" is unanswerable.
- Phase 16's instruction "do not destroy existing station data / backfill safely" has no subject:
  there is no station data, only source code.

This inverts the brief's phasing. The brief puts the data model at Phase 16; it is a Phase B
prerequisite for Phases 13 and 14, because there is nothing to administer until the catalog has a
home that is not a source file.

---

## 2. Stream and provider sources

`RadioStation` (`radio-stations.ts:3`) carries `streamUrl` plus an optional `fallbacks: string[]`.
`stationSources(station)` (`:57`) flattens them into the failover chain the player and proxy index
into with `?source=N`.

Two behaviours worth crediting, because they are the hard part done right:

- `AD_PRONE_HOSTS` (`:73`) with `sourceAdRisk()` lets the ranking prefer a broadcaster's own mount over
  an ad-injecting relay — the difference between a station that plays and a station that plays an
  advert at every tune-in.
- `preferredSourceIndex()` (`:159`) is the single ranking used by both the player and the probe's
  `bestIndex`, so the page and the audio path cannot disagree about which channel is best.

**No station URL carries a credential.** A scan for `token|key=|secret|auth|sig=|password` across
every URL in `radio-stations.ts` returns nothing; they are public broadcast mounts (StreamGuys,
Shoutcast, Zeno). This matters for R-03 below: the leak is real but is not a credential leak *today*.

---

## 3. Direct versus proxy playback

Both modes exist and the choice is deliberate, not accidental:

- **Direct** — the browser fetches the upstream. Cheaper, but subject to CORS, mixed-content blocking
  on http-only mounts, and hostname-level blocking. `canPlayDirect()` (`:118`) gates it.
- **Proxy** — `/api/radio/stream?stationId=X&source=N` re-serves the mount from our origin. Required
  for http-only and UA-filtered hosts.

The proxy's header contract (`stream/route.ts:1–30`) documents three rules learned from real
breakage: never send `Icy-MetaData: 1`, pass bytes through raw with no re-encoding, and send per-host
`Referer`/`Origin` because some CDNs gate on them. The ICY strip transform (`:112–146`) is
cross-chunk-safe — metadata blocks spanning chunk boundaries are handled exactly. This is careful
work and the brief's Phase 6 mostly describes what already exists.

**What is missing from this layer is not capability but control** — see R-01 and R-02.

---

## 4. Health and status

`radio-status.ts` (49 lines) holds three parsers — `parseIcecast`, `parseShoutcast7`,
`parseShoutcastStats` — and they are pure functions over a response body. That is the right seam and
it is already tested.

`radio-status-fetch.ts` (157) reads cached status; `/api/radio/stations` fans out across every station
with `Promise.allSettled` and degrades a failed row to `source: "none"`, `live: false`.

**The gap is that "no metadata" and "stream is dead" are the same value.** Both arrive as
`source: "none"`. The brief's §14 requirement — *"Every provider failure must be observable and
distinguishable from an empty station list"* — is not met: a station whose Icecast stats endpoint is
404 but whose audio plays perfectly is reported identically to one that is off the air. That is the
single most consequential honesty defect in the radio stack, because it is the number a listener and
an operator both act on.

There is no `RadioStationStatus` (`healthy` / `degraded` / `offline` / `unknown` / `maintenance`), no
consecutive-failure threshold, no hysteresis, and no record of a transition. `lastCheckedAt` /
`lastHealthyAt` / `lastFailureAt` exist only as cached strings, not as history.

---

## 5. Reconnect policy — the one clear bug

`RadioPlayerContext.tsx:245–255`:

```ts
const RECONNECT_FLOOR_MS = 8000;
const delay = Math.min(RECONNECT_FLOOR_MS * 2 ** retryCount.current, 60_000);
retryCount.current += 1;
```

`retryCount` is incremented and **never compared to a maximum**. There is no cap, no give-up state,
and no `"failed"` terminal. A station that is permanently off the air is retried every 60 seconds for
as long as the tab is open.

This directly contradicts the brief's §8 — *"stop retries after a maximum count"*, *"Do not keep
reconnecting forever"*, *"Do not create reconnect loops"* — and it is worst exactly where the brief
says it matters: an ad-supported stream re-opens a session on every reconnect, so an indefinite 60s
loop against an ad-prone host replays a pre-roll every minute, forever, to a listener who is not
listening to anything.

The backoff curve itself is right. Only the terminus is missing.

---

## 6. Caching and edge

| Surface | Policy | Assessment |
| --- | --- | --- |
| `/api/radio/stations` | `public, s-maxage=60, stale-while-revalidate=180` | Correct — public catalog data, no user scope |
| `/api/radio/probe` | `public, s-maxage=120, swr=300` | Correct intent; leaks URLs (R-03) |
| `/api/radio/stream` | `no-store, no-transform` + `X-Accel-Buffering: no` | Correct — and the edge-buffering header is a real insight, buffering a live stream adds latency |
| `probeCache` | in-process `Map`, 5-minute TTL, **unbounded** | Ineffective: on serverless every instance has a cold map, so it protects upstreams far less than it appears to (R-04) |

No user-specific radio response is publicly cached — the phase F cache policy registry
(`lib/cache-policy.ts`) confirms this and the radio endpoints respect it. The brief's §9 "never
cache" list is currently satisfied.

---

## 7. Service worker, PWA and edge

`public/sw.js` ships with the PWA. The Playwright suite blocks service workers deliberately, because
a worker installed by an earlier spec serves a stale shell into the next one
(`studio-pilot-review.spec.ts:8–10`) — a real hazard to be aware of when writing radio browser tests.

**Not verified in this audit:** whether the service worker interferes with live audio ranges or
`206` responses, and whether a stream survives an installed-PWA background/foreground cycle. Both
need the browser harness (which now runs) and neither can be established by reading.

---

## 8. Admin monitoring

There is no admin radio console. `/admin/integrations` probes a `radio` integration entry
(`lib/integrations.ts`) but that is a reachability check against a configured host, not a station
console: it cannot list stations, cannot show per-station health, and cannot disable one.

Given §1, this is not a UI gap — there is no data source for such a console to render.

---

## 9. Notifications

`lib/notification-sounds.ts` and the existing notification type system are present. No radio event
types exist (station recovered / favourite offline / provider outage resolved). The brief's §15 is
unimplemented, but it is genuinely additive: it can be built on the existing notification system
without touching playback.

---

## 10. Risks

Severity is against the platform, not against the brief.

### R-01 · P1 · The stream proxy and probe are unauthenticated and unlimited

`src/proxy.ts` rate-limits a named list of paths (`RATE_LIMIT_NAMES`, `:106–144`). **No
`/api/radio/*` path is on it.**

`/api/radio/stream` is therefore an open bandwidth amplifier: anyone can request
`?stationId=<id>&source=N` and the platform pays upstream bandwidth for a live audio stream, with
`maxDuration = 300`. It needs no account. `/api/radio/probe` triggers an outbound request per channel
in the failover chain on demand — serial, up to 7s each — so it is also a cheap way to generate
outbound traffic from the platform's egress.

Risk: cost and availability. This is the highest-severity radio finding because it is reachable by
anyone on the internet and requires no misconfiguration.

Mitigation: add radio entries to the middleware table with a per-IP ceiling for the unauthenticated
case, and a per-IP concurrent-connection cap for `stream` (a rate limit alone does not bound
concurrent long-lived streams).

### R-02 · P1 · `redirect: "follow"` with no destination validation

Both `stream/route.ts` and `probe/route.ts` fetch upstream with `redirect: "follow"`, and neither
validates the final URL.

What contains this today is that every URL comes from the hardcoded `STATIONS` array — so it is **not
attacker-controlled**, and calling it a critical SSRF would overstate it. But the platform makes the
request from inside its own network, so a broadcast host whose DNS is hijacked or whose server issues
a redirect to `169.254.169.254`, `localhost`, or a private range would have the platform follow it and
stream the response back. The trust assumption is "the broadcast network is honest", which is weaker
than it looks for a catalog of third-party community stations.

`lib/safe-fetch.ts` was written in Phase D for exactly this and is **not used here**. Wiring radio
through it is the smallest high-value change in this audit.

### R-03 · P2 · The probe republishes upstream stream URLs

`ProbeResult` includes the raw `url` (`probe/route.ts:19`) and the route returns every channel's URL
in a response marked `public, s-maxage=120`. The URLs are public mounts today, so nothing secret
leaks — but the endpoint is a disclosure mechanism by construction, and the moment an operator
configures a mount URL containing a signed token or an internal hostname, it will be published to
anonymous callers and cached at the edge.

Mitigation: drop `url` from the public response (return `index`, health, bitrate, station name) or
redact to origin only. The admin console can have the full value; the public dial cannot use it.

### R-04 · P3 · `probeCache` is unbounded and ineffective

An in-process `Map` with no size cap and no eviction, keyed by station id. The key space is bounded by
the catalog, so memory growth is bounded — but on serverless each instance holds its own cold map, so
it does not meaningfully protect upstreams, and it will not exist at all in a multi-instance
deployment. A Redis-backed cache would do what this appears to do.

### R-05 · P3 · Not verified: service-worker interaction with live audio

See §7. Stated as unknown rather than assumed safe.

### R-06 · P2 · No tests for anything on the audio path

`radio-dial.test.ts` and `radio-status.test.ts` cover station filtering and the parsers. There is **no
test** for: the proxy (including the ICY strip state machine, which is non-trivial byte-level logic),
the probe, the SSRF/redirect surface, the reconnect curve or its absent cap, player state
transitions, direct↔proxy fallback, or the URL disclosure. The ICY transform in particular is exactly
the kind of code that must be tested across chunk boundaries and currently is not.

### R-07 · P3 · Privacy: listening analytics

No listening-history collection was found in the radio path, which is the privacy-preserving default.
The brief's §22 asks for a written policy; there is currently no collection to document, which is
worth stating so a later feature does not add it silently.

---

## 11. Implementation phases

Ordered by risk, with the brief's ordering adjusted where the audit contradicts it — the data model
moves earlier because everything administrative depends on it, and the brief's Phase 4/6/11 work is
dropped because it already exists.

**Phase A — this document.** Done.

**Phase B — control the audio path (R-01, R-02, R-03). IMPLEMENTED.** See §16. Two corrections the
work forced, both recorded there: `safeFetch` cannot be used for the proxy at all, and closing R-02
uncovered a separate, live SSRF bypass (R-08) in `safe-fetch.ts` itself.

**Phase C — the reconnect terminus (R-05/§5).** One bounded change to a file that is otherwise in
good shape: a maximum attempt count, a terminal `"failed"` state, a manual retry affordance, and
reset on successful playback. Tests for the curve, the cap, and ad-prone hosts not being re-opened.

**Phase D — station catalog as data (R-05/§1).** Additive migration: `RadioStation` +
`RadioSource` rows, seeded from the existing literals so behaviour is unchanged on day one, with the
source array remaining the fallback when the table is empty. This is the prerequisite for Phase E and
F. Highest care needed: the seed must be idempotent and the read path must not regress if the table is
unreachable (serve the literals).

**Phase E — health model and honest status (R-03/§4).** `RadioHealthCheck` + `RadioStationEvent`
tables, `RadioStationStatus` with consecutive-failure thresholds and hysteresis, and — most
importantly — **separating "no metadata" from "no audio"** so the dial stops conflating them. Extend
the parsers, don't replace them.

**Phase F — ICY/proxy tests (R-06).** Before touching the transform further, characterize it: metadata
blocks on chunk boundaries, `metaint` changing mid-stream, a zero length byte, a truncated metadata
block.

**Phase G — admin console (§8).** Per-station health, test/disable/enable, source priority, recent
failures, audit of who changed what. Depends on D and E.

**Phase H — UX, PWA, performance (§10, §15).** Station cards, filters, safe-area, bottom-sheet
expanded player, reduced-motion, keyboard/screen-reader. Largely additive to a page that already
works.

**Phase I — notifications (§15).** Additive on the existing notification system.

**Phase J — rollout.** Migration + rollback + the full validation suite.

Explicitly **not** planned: reimplementing exponential backoff, Media Session, autoplay handling,
resource cleanup, the branded-logo fallback, or the N+1-free dial endpoint. They exist.

---

## 12. Migration plan

The only schema change is Phase D's `RadioStation` / `RadioSource`, and it is additive:

1. `CREATE TABLE` with nullable/FK-free columns; no existing table is altered.
2. Seed from `radio-stations.ts` with an idempotent upsert keyed on `slug`.
3. The read path prefers the table and **falls back to the literals** whenever the table is empty or
   unreachable — so a failed migration degrades to today's behaviour rather than an empty dial.
4. Existing stream URLs are preserved verbatim by the seed; `fallbacks` becomes ordered
   `RadioSource` rows with `priority` from the array index.
5. Phases E's tables are additive too, and are written only by the sweep, so they can be dropped
   without affecting playback.

Rollback for each: `DROP TABLE`. Because the literals remain in the source and the read path falls
back, dropping the tables returns the platform to exactly today's behaviour.

**Never run this against the legacy read-only project.** The guard from phase E
(`lib/db-target.ts`, `scripts/assert-db-target.ts`) refuses a migration against the legacy
`DATABASE_URL`; the radio migration ships behind it like every other migration.

---

## 13. Rollback plan

- **Phase B** — revert the commit. Rate-limit entries and the `safeFetch` swap are independently
  revertable; removing the entries restores the current open behaviour.
- **Phase C** — revert. The cap is one comparison and a terminal state; the current unbounded loop
  returns.
- **Phase D/E** — `DROP TABLE`. The read path's literal fallback means playback does not change.
- **Phase F** — tests only; no runtime change to revert.
- **Phase G/H/I** — UI and additive endpoints; revert the commit.

---

## 14. Definition of done — the honest version

Met today, and this list is the point of the audit: station catalog served in one call, ICY metadata
cannot corrupt audio, one audio stream at a time, autoplay respected, resources released,
ad-break distinguished from outage, Media Session, logo fallback, no user data in public caches, no
arbitrary URL proxy (`stream` only accepts a station id, never a URL), no credentials in the catalog,
typecheck/lint/tests green.

Also met as of Phase B: the audio path is behind the middleware ceiling (R-01, attempts bounded —
concurrency is not); upstream redirect destinations are validated rather than followed (R-02); the
probe no longer publishes upstream URLs (R-03); and `safe-fetch`'s bracketed-IPv6 bypass is closed
(R-08).

Not met, in priority order: reconnect never terminates (§5) — now the highest-severity open item;
"no metadata" and "offline" are indistinguishable (§4); there is no station data model, so no admin
console can exist (§1, §8); concurrent stream connections are unbounded; the guard does not resolve
hostnames, so a public name pointing at a private address is not caught; `probeCache` does not work on
serverless (R-04); the service-worker/audio interaction is unverified (R-05); and the audio path still
has no test for the ICY strip state machine (R-06).

---

## 15. Phase B — as implemented (and what it changed in this audit)

Status: **done**. `npm run typecheck` exit 0 · `npm run lint` 0 errors · `npm test` **103 files, 1700
passed, 1 skipped** (+34 over the audit baseline).

### R-01 — rate limits

Added `RADIO_PROBE` (30/min) and `RADIO_STREAM` (60/min) to `RATE_LIMIT_NAMES` and `DEFAULTS` in
`src/proxy.ts`, so both endpoints are now behind the middleware ceiling instead of being unlimited.

**Stated honestly: this caps attempts, not concurrent connections.** A caller inside 60/min can still
hold many long-lived streams open, because bounding concurrency needs shared state (a Redis semaphore
with a decrement on abort) and a half-built semaphore that leaks its counter is worse than none. Left
as open work rather than claimed.

### R-02 — redirect validation, and a correction to this audit

**This audit's recommendation was wrong and is withdrawn.** It said to route the radio fetches through
`lib/safe-fetch.ts`. `safeFetch` **buffers the entire body into a string** under a byte cap — correct
for a page, fatal for a stream that must stay open for minutes and be handed to the browser 1:1. The
primitive it could not provide was the whole point.

What was implemented instead is `src/lib/radio-stream-guard.ts`, which takes the *validation* half of
`safe-fetch` (`assessUrl`) and drops the buffering half:

- `guardStreamUrl(raw)` — refuses a URL before any connection is attempted.
- `openValidatedStream(raw, opts)` — fetches with `redirect: "manual"` and inspects **every** hop
  against the same rules, up to 3, resolving relative `Location` headers against the hop they came from
  first (a relative `Location` is legal, and is also the shape that slips a naive string check).
  Returns the `Response` with its body stream **untouched**.

Both routes now use it. A refused destination answers `502`, which is deliberate: the player's failover
behaves identically to a host being down, so it tunes the next channel either way.

### R-03 — the probe no longer publishes upstream URLs

`url` is gone from `ProbeResult` and from the response. This cost nothing: the only consumer
(`RadioPlayerContext.tsx:395`) already declared its channel type as
`{ index, ok, bitrateKbps, stationName }` and never read `url`.

### R-08 · P1 · New finding — bracketed IPv6 literals bypassed `safe-fetch` entirely

Found by the first `guardStreamUrl` test, which failed on `http://[::1]/stream`.

WHATWG `hostname` returns an IPv6 literal **with its brackets**, and all three checks in `assessUrl`
are written for a bare address, so `[::1]` satisfied none of them — and each check deferred to another:

- `isBlockedHostname` refuses a *bare single-label* name; `[::1]` contains a colon, so it stood down.
- `isAmbiguousIpv4Literal` only knows IPv4.
- `isBlockedV6` returned `false` on input it could not parse, **with a comment asserting the literal
  check would have caught it** — and that check never covered IPv6.

So `http://[::1]/`, `http://[fd00::1]/`, `http://[fe80::1]/` and, worst,
`http://[::ffff:169.254.169.254]/` all passed `assessUrl` as public URLs. Unlike R-02 this is not
contained by the catalog being hardcoded: `web-research.ts` and `neural-mind.ts:learnFromUrl` take URLs
from **user and model input** and call `safeFetch`, so this was a reachable SSRF bypass.

Fixed once, at the root: `assessUrl` strips the brackets before the checks. That repairs every caller
rather than only the radio path. Fourteen tests added — eight refusal cases including the
IPv4-mapped-metadata form, and a positive case asserting a public IPv6 literal is still allowed, so the
fix strips brackets rather than blanket-refusing the family.

Severity note: this is the most serious finding of the radio work, and it was found next to the radio
work rather than in it.

### Tests added this phase

| File | Added | Covers |
| --- | --- | --- |
| `tests/unit/radio-stream-guard.test.ts` | 25 | Scheme/host/address refusals, redirect refusal and hop counting, relative `Location`, the redirect ceiling, no-`Location`, transport failure, a 401 passing through, **and that the body is returned as an unread `ReadableStream`** |
| `tests/unit/safe-fetch.test.ts` | +9 | The R-08 regression: eight bracketed-IPv6 refusals plus one public-IPv6 positive |

### Not done in Phase B

- Concurrent-connection capping for `/stream` (needs shared state).
- DNS resolution per hop in the guard: `guardStreamUrl` is string-level, so a public name that resolves
to a private address is **not** caught. A public DNS name pointed at an internal address remains a
reachable gap, and it is the next step for this module. Stated because the alternative — implying the
guard is complete — is the kind of claim that gets acted on.
- The `probeCache` ineffectiveness (R-04) and the service-worker question (R-05) are untouched.

### Rollback

Independently revertable in three pieces: remove the two `RATE_LIMIT_NAMES` entries; revert the two
routes to `fetch(..., { redirect: "follow" })` and delete `radio-stream-guard.ts`; restore `url` to
`ProbeResult`. The `safe-fetch.ts` bracket strip should **not** be reverted — it is a security fix
independent of radio.

---

## 16. Recommended next step

**Phase C — the reconnect terminus.** One bounded change: a maximum attempt count, a terminal
`"failed"` state, a manual retry, and a reset on successful playback. It is now the highest-severity
open item because R-01, R-02 and R-03 are closed, and because it is the one finding where the current
behaviour actively harms a listener rather than merely exposing the platform — an indefinitely
reconnecting ad-supported stream replays a pre-roll every sixty seconds for as long as the tab is open.

The natural second item is the per-hop DNS check in `radio-stream-guard`, which is the stated limit of
what Phase B actually closed.

Both are preferred over Phase D (the station table). D is the largest change in this plan and the
prerequisite for the admin console, but it makes the catalog editable — so the second-order question
("what stops a stored source from being internal?") is better answered before the table exists than
after.
