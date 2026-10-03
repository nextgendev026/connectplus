import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext → Cloudflare Workers.
 *
 * This is the front end AND the back end of the publishing pipeline now: every
 * page, every route handler and the Inngest endpoint are served by the
 * `connectplus-app` Worker, with the `connectplus-edge` Worker staying in front
 * of it as the cache and media plane. Vercel is no longer in the request path.
 *
 * The defaults are kept on purpose. Incremental cache and tag revalidation can
 * be backed by R2 or D1, but this deployment has neither enabled yet (R2 needs a
 * dashboard opt-in — see DEPLOYING.md), and the worker's own Cache API layer
 * already answers the hot reads. Adding a cache backend here before the storage
 * exists would fail the deploy rather than speed it up.
 */
export default defineCloudflareConfig({});
