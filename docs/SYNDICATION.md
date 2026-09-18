# Syndicating connectPlus

Everything a third-party network needs to carry connectPlus content. The feeds
are open — no API key, no sign-up — and are the same shape this platform
consumes from other publishers.

There is also a public, human-readable version of this document at **`/feeds`**,
which is linked from the footer and indexed for search.

---

## Endpoints

| Endpoint | Format | Notes |
| --- | --- | --- |
| `GET /feed.xml` | RSS 2.0 | Newest 50 published stories. |
| `GET /feed.xml?format=json` | JSON Feed 1.1 | Same items, JSON. |
| `GET /feed/<category-slug>` | RSS 2.0 | One category. |
| `GET /feed/<category-slug>?format=json` | JSON Feed 1.1 | One category, JSON. |
| `GET /feed.xml?category=<slug>` | RSS 2.0 | Equivalent to the path form. |
| `GET /feed.xml?limit=<n>` | RSS 2.0 / JSON | `1`–`100`; defaults to `50`. |

`Content-Type` is `application/rss+xml; charset=utf-8` or
`application/feed+json; charset=utf-8`. A category slug that does not exist is a
**404**, never the unfiltered feed under a filtered URL.

Response headers:

```
Cache-Control: public, s-maxage=600, stale-while-revalidate=3600
```

Both feed types advertise a `<ttl>` of 15 minutes. The cache is what makes a
15-minute poll interval correct; polling more often returns identical bytes.

---

## Discovery

- The root layout declares `<link rel="alternate" type="application/rss+xml">`
  and `type="application/feed+json"` for the all-stories feeds.
- `/categories` declares `rel="alternate"` for the main feed, the JSON feed, and
  **every category feed** that has published stories.
- `/feeds` documents the endpoints for humans and search engines.

---

## Item fields

### RSS 2.0

Namespaces declared: `atom`, `dc`, `content`, `media`.

| Field | Meaning |
| --- | --- |
| `<title>` | Article headline. |
| `<link>` | Canonical article URL on this site. |
| `<guid isPermaLink="true">` | Same URL; stable identity. |
| `<pubDate>` | RFC 822 publication time. |
| `<dc:creator>` | Human byline. |
| `<category>` | Section, followed by each tag. |
| `<description>` | Plain-text summary, publisher promo trailer stripped. |
| `<content:encoded>` | Plain-text body, present only when it adds more than the summary. |
| `<enclosure url type length>` | Cover image with its real MIME type. `length` is `0` (unknown until fetched). |
| `<media:content medium="image">`, `<media:thumbnail>` | Same cover, for image-aware readers. |
| `<source url>` | Present only on syndicated items; names the original publisher. |

> **Read `<dc:creator>`, not `<author>`.** RSS 2.0 defines `<author>` as an email
> address, so we do not emit it. A display name in `<author>` is the most common
> feed error there is, and some aggregators drop the field over it.

### JSON Feed 1.1

`title`, `home_page_url`, `feed_url`, `description`, `language`, `authors[]`, and
`items[]` with `id`, `url`, `title`, `summary`, optional `content_html`,
`date_published` (ISO 8601), `authors[]`, `tags[]`, `image` and `attachments[]`.

---

## Attribution we ask for

1. **Keep the link back.** `<link>`/`<guid>` (RSS) and `url` (JSON Feed) are the
   canonical article URL. Republishing means linking to it, not republishing it
   as your own.
2. **Credit the author** from `<dc:creator>` / `authors[]`.
3. **Honour the syndicated source.** Items carrying `<source>` came from another
   publisher. Their copyright stays theirs — credit them as well.
4. **Respect the cadence.** Poll no more often than every 15 minutes.
5. **Images.** Covers are absolute URLs. Route them through your own cache
   rather than hotlinking at volume.

---

## Imagery

Cover images are advertised with their true MIME type (often `image/webp` or
`image/png`) and absolute URLs. This platform's own surfaces render them through
an on-demand optimizer (`/api/optimize`), which typically cuts a
publisher-sourced cover by more than 90% (a 1 MB PNG becomes a ~13 KB WebP).
Consumers are welcome to do the same; nothing about the feed depends on the
original bytes.

---

## Removing an item

If you are a publisher and a syndicated item should come down, email a link to
the item to **support@connectplus.io**. There is no formal process and no
paperwork — we take it down.
