import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Service worker privacy contract.
 *
 * The worker is a plain script served from /public, so these tests load it with
 * a stubbed `self` and then drive its own `fetch` listener. What they pin is the
 * part a unit test can never catch by inspection: that a signed-in page can
 * never end up in the cache, on a shared or handed-down phone.
 */

type Listener = (event: unknown) => void;

const listeners = new Map<string, Listener>();
const stores = new Map<string, Map<string, Response>>();

const normalise = (target: unknown): string => {
  const raw =
    typeof target === "string"
      ? target
      : target && typeof target === "object" && "url" in target
        ? String((target as { url: unknown }).url)
        : String(target);
  try {
    const url = new URL(raw, "https://app.test");
    return `${url.pathname}${url.search}`;
  } catch {
    return raw;
  }
};

const openCache = (name: string) => {
  if (!stores.has(name)) stores.set(name, new Map());
  const store = stores.get(name)!;
  return {
    put: async (req: unknown, res: Response) => {
      store.set(normalise(req), res);
    },
    match: async (req: unknown) => store.get(normalise(req)),
    add: async () => undefined,
    addAll: async () => undefined,
    keys: async () => [...store.keys()].map((k) => new Request(`https://app.test${k}`)),
    delete: async (req: unknown) => store.delete(normalise(req)),
  };
};

// `self` must exist before the worker script runs its top-level addEventListener
// calls, so the stub and the import both happen up here.
(globalThis as unknown as { self: unknown }).self = {
  addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
  location: { origin: "https://app.test", hostname: "app.test" },
  skipWaiting: async () => undefined,
  clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async () => null },
  registration: { showNotification: async () => undefined },
};

(globalThis as unknown as { caches: unknown }).caches = {
  open: async (name: string) => openCache(name),
  match: async (req: unknown) => {
    for (const store of stores.values()) {
      const hit = store.get(normalise(req));
      if (hit) return hit;
    }
    return undefined;
  },
  keys: async () => [...stores.keys()],
  delete: async (name: string) => stores.delete(name),
};

// Plain worker script with no exports — loaded for its side effects (it
// registers the listeners above).
// @ts-expect-error TS2306: intentionally importing a non-module script.
await import("../../public/sw.js");

const registered = listeners.get("fetch");
if (!registered) throw new Error("service worker registered no fetch listener");
const handleFetch: Listener = registered;

async function dispatch(request: Request): Promise<Response | undefined> {
  let captured: Response | Promise<Response> | undefined;
  let responded = false;
  handleFetch({
    request,
    respondWith: (response: Response | Promise<Response>) => {
      responded = true;
      captured = response;
    },
  });
  if (!responded) return undefined;
  return await captured;
}

/** A navigation-mode Request — Node forbids constructing `mode: "navigate"`. */
function navigation(path: string, headers: HeadersInit = {}): Request {
  const request = new Request(`https://app.test${path}`, { headers });
  Object.defineProperty(request, "mode", { value: "navigate", configurable: true });
  return request;
}

const shellStore = () => {
  const name = [...stores.keys()].find((k) => k.endsWith("-shell"));
  return name ? stores.get(name)! : undefined;
};

beforeEach(() => {
  stores.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("service worker privacy", () => {
  it.each(["/admin", "/admin/integrations", "/settings", "/studio", "/login"])(
    "never intercepts %s",
    async (path) => {
      const response = await dispatch(navigation(path));
      expect(response).toBeUndefined();
      expect(stores.size).toBe(0);
    }
  );

  it("leaves authenticated API traffic alone", async () => {
    const response = await dispatch(new Request("https://app.test/api/admin/integrations"));
    expect(response).toBeUndefined();
  });

  it("does not store a navigation response that sets a cookie", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<html>signed in</html>", {
          headers: { "Content-Type": "text/html", "Set-Cookie": "cp_session=abc" },
        })
    );

    const response = await dispatch(navigation("/"));
    expect(await response?.text()).toContain("signed in");
    expect(shellStore()?.size ?? 0).toBe(0);
  });

  it("does not store a navigation response marked no-store", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<html>private</html>", {
          headers: { "Content-Type": "text/html", "Cache-Control": "private, no-store" },
        })
    );

    await dispatch(navigation("/trending"));
    expect(shellStore()?.size ?? 0).toBe(0);
  });

  it("stores an anonymous navigation and serves it when the network drops", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<html>public feed</html>", {
          headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=60" },
        })
    );

    await dispatch(navigation("/"));
    expect(shellStore()?.size ?? 0).toBe(1);

    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const cached = await dispatch(navigation("/"));
    expect(await cached?.text()).toContain("public feed");
  });

  it("falls back to the precached /offline shell when nothing else is saved", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });

    // Any store name works — `caches.match` searches them all — and pinning the
    // worker's own cache version here would make a version bump look like a
    // privacy regression.
    await (await caches.open("shell-offline-fixture" as never)).put(
      new Request("https://app.test/offline"),
      new Response("<html>offline shell</html>", { headers: { "Content-Type": "text/html" } })
    );

    const response = await dispatch(navigation("/never-visited"));
    expect(await response?.text()).toContain("offline shell");
  });

  it("never caches a non-GET request", async () => {
    const response = await dispatch(new Request("https://app.test/posts", { method: "POST" }));
    expect(response).toBeUndefined();
  });
});

/**
 * Push subscription rotation.
 *
 * The browser retires a push endpoint on its own schedule and fires
 * `pushsubscriptionchange`. Unhandled, that was invisible: alerts stopped
 * arriving, nothing failed, and the server kept a row pointing at an endpoint the
 * push service no longer serves. These tests pin the recovery AND its order —
 * register the replacement before releasing the retired endpoint, so a failure
 * halfway through never leaves the reader with no way to be reached.
 */
describe("service worker push subscription rotation", () => {
  // Re-bound after the check: a `const` narrowed by a `throw` is not seen as
  // narrowed inside the closure below (`noUncheckedIndexedAccess` keeps the
  // optional in the declared type).
  const registered = listeners.get("pushsubscriptionchange");
  if (!registered) throw new Error("service worker registered no pushsubscriptionchange listener");
  const rotation: Listener = registered;

  interface Call {
    url: string;
    method: string;
  }

  /** Run the handler and wait for the promise it handed to `waitUntil`. */
  async function rotate(event: Record<string, unknown>): Promise<void> {
    let pending: Promise<unknown> | undefined;
    rotation({
      ...event,
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    await pending;
  }

  const subscription = (endpoint: string) => ({
    endpoint,
    toJSON: () => ({ keys: { p256dh: "p256dh-key", auth: "auth-key" } }),
  });

  function recordFetch(status = 200) {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init: { method?: string } = {}) => {
      calls.push({ url: String(input), method: init.method ?? "GET" });
      return new Response("{\"ok\":true}", {
        status,
        headers: { "Content-Type": "application/json" },
      });
    });
    return calls;
  }

  it("registers the replacement before releasing the retired endpoint", async () => {
    const calls = recordFetch();

    await rotate({
      oldSubscription: {
        endpoint: "https://push.test/retired",
        options: { applicationServerKey: "server-key" },
      },
      newSubscription: subscription("https://push.test/fresh"),
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ url: "/api/notifications/push", method: "POST" });
    expect(calls[1]!.method).toBe("DELETE");
    expect(calls[1]!.url).toContain(encodeURIComponent("https://push.test/retired"));
  });

  it("sends the new keys, not just the endpoint", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_input: unknown, init: { body?: string } = {}) => {
      if (init.body) bodies.push(init.body);
      return new Response("{}", { status: 200 });
    });

    await rotate({
      oldSubscription: { endpoint: "https://push.test/retired", options: {} },
      newSubscription: subscription("https://push.test/fresh"),
    });

    // A registration without p256dh/auth is rejected by the API, which would
    // leave the device believing it had re-subscribed.
    const body = JSON.parse(bodies[0]!);
    expect(body.endpoint).toBe("https://push.test/fresh");
    expect(body.keys).toEqual({ p256dh: "p256dh-key", auth: "auth-key" });
  });

  it("keeps the old subscription when the new one cannot be registered", async () => {
    const calls = recordFetch(401);

    await rotate({
      oldSubscription: { endpoint: "https://push.test/retired", options: {} },
      newSubscription: subscription("https://push.test/fresh"),
    });

    // Nothing released: the reader is still reachable on the only row we know of.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
  });

  it("subscribes afresh when the browser reports no replacement", async () => {
    const calls = recordFetch();
    const subscribedWith: Record<string, unknown>[] = [];
    const self = (globalThis as unknown as { self: { registration: Record<string, unknown> } }).self;
    self.registration.pushManager = {
      subscribe: async (options: Record<string, unknown>) => {
        subscribedWith.push(options);
        return subscription("https://push.test/resubscribed");
      },
    };

    try {
      await rotate({
        oldSubscription: {
          endpoint: "https://push.test/retired",
          options: { applicationServerKey: "server-key" },
        },
      });
    } finally {
      delete self.registration.pushManager;
    }

    // The old subscription's key is what a re-subscribe has to present; without
    // it the browser grants nothing.
    expect(subscribedWith[0]).toEqual({
      userVisibleOnly: true,
      applicationServerKey: "server-key",
    });
    expect(JSON.parse(JSON.stringify(calls))).toHaveLength(2);
  });

  it("does not release an endpoint it just re-registered", async () => {
    const calls = recordFetch();
    await rotate({
      oldSubscription: { endpoint: "https://push.test/same", options: {} },
      newSubscription: subscription("https://push.test/same"),
    });
    expect(calls).toHaveLength(1);
  });
});

/**
 * Reader-scoped API contract.
 *
 * `/api/posts` is on the stale-while-revalidate list because its anonymous form
 * is identical for every visitor — but the same path carries the two most
 * personal reads in the app: `?personalized=true` (ranked for this reader) and
 * `?mine=true` (written by this reader). The cache is keyed by URL alone, and a
 * URL full of query parameters is not a name. Matching on the pathname put both
 * on disk, where the next person on a shared or handed-down phone was served the
 * previous reader's feed.
 */
describe("service worker reader-scoped API cache", () => {
  const apiStore = () => {
    const name = [...stores.keys()].find((k) => k.endsWith("-api"));
    return name ? stores.get(name)! : undefined;
  };

  const settle = async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it.each([
    "/api/posts?page=2&personalized=true",
    "/api/posts?mine=true",
  ])("never intercepts %s", async (path) => {
    vi.stubGlobal("fetch", async () => Response.json({ posts: [] }));
    const response = await dispatch(new Request(`https://app.test${path}`));
    // Not intercepted at all: the request goes to the network, and nothing is
    // either stored or served from disk.
    expect(response).toBeUndefined();
    expect(stores.size).toBe(0);
  });

  it("stores the anonymous form of the same path", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ posts: [] }));
    await dispatch(new Request("https://app.test/api/posts?page=2"));
    await settle();
    expect(apiStore()?.size ?? 0).toBe(1);
  });

  it("does not store an API response that sets a cookie", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("{\"posts\":[]}", {
          headers: { "Content-Type": "application/json", "Set-Cookie": "cp_session=abc" },
        })
    );
    const response = await dispatch(new Request("https://app.test/api/posts?page=1"));
    await settle();
    // The caller still gets its answer; it simply does not become everyone's.
    expect(await response?.text()).toContain("posts");
    expect(apiStore()?.size ?? 0).toBe(0);
  });

  it("does not store an API response marked private", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("{\"posts\":[]}", {
          headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
        })
    );
    await dispatch(new Request("https://app.test/api/weather"));
    await settle();
    expect(apiStore()?.size ?? 0).toBe(0);
  });

  it("keeps the API cache bounded", async () => {
    // A feed browses one page at a time and never stops; without a ceiling the
    // disk cache grows for as long as the app is installed.
    vi.stubGlobal("fetch", async () => Response.json({ posts: [] }));
    for (let page = 1; page <= 80; page++) {
      await dispatch(new Request(`https://app.test/api/posts?page=${page}`));
      await settle();
    }
    const size = apiStore()?.size ?? 0;
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(60);
  });
});

/**
 * Cover-cache contract.
 *
 * `/api/thumb/post/<id>` is where every card cover, hero image and syndicated
 * story's picture resolves to. Not intercepting it meant a feed that rendered
 * perfectly online lost every image offline — the cards fell back to an empty
 * gradient — and re-downloaded covers that had not changed.
 */
describe("service worker cover cache", () => {
  const imageStore = () => {
    const name = [...stores.keys()].find((k) => k.endsWith("-images"));
    return name ? stores.get(name)! : undefined;
  };

  const settle = async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("caches a card cover and serves it when the network is gone", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("cover-bytes", { headers: { "Content-Type": "image/jpeg" } })
    );

    const request = () => new Request("https://app.test/api/thumb/post/clx1234567890");
    const fresh = await dispatch(request());
    await settle();
    expect(await fresh?.text()).toBe("cover-bytes");

    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const offline = await dispatch(request());
    expect(await offline?.text()).toBe("cover-bytes");
    expect(imageStore()?.size ?? 0).toBe(1);
  });

  it("does not remember a failed cover", async () => {
    // A 404 from a dead upstream or a 400 from a malformed thumb code must not be
    // cached, or the fix never reaches the reader who has it on disk.
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 404 }));
    await dispatch(new Request("https://app.test/api/thumb/post/deadbeef1234"));
    await settle();
    expect(imageStore()?.size ?? 0).toBe(0);
  });
});

/**
 * Dev-chunk contract.
 *
 * The bug this pins: a dev server serves `/_next/static/chunks/main-app.js` at a
 * stable, unhashed URL and overwrites it on every recompile. A worker that caches
 * it renders the previous build on the next load, so the page shows copy that no
 * longer exists in the source. Only content-hashed (immutable) asset URLs may be
 * stored; anything else must reach the origin on every request.
 */
describe("service worker asset freshness", () => {
  const assetStore = () => {
    const name = [...stores.keys()].find((k) => k.endsWith("-assets"));
    return name ? stores.get(name)! : undefined;
  };

  /** Let the detached `cache.put(...)` in the SWR path settle. */
  const settle = async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("reaches the network for an unhashed chunk instead of serving a cached copy", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response("dev bundle", { headers: { "Content-Type": "text/javascript" } });
    });

    const chunk = new Request("https://app.test/_next/static/chunks/main-app.js");
    await dispatch(chunk);
    await settle();

    // Nothing may be stored, so a stale copy can never exist to be served.
    expect(assetStore()?.size ?? 0).toBe(0);

    // …and a second load still goes to the origin rather than to cache.
    await dispatch(chunk);
    expect(calls).toBe(2);
  });

  it("caches a content-hashed production chunk", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("prod bundle", { headers: { "Content-Type": "text/javascript" } })
    );

    await dispatch(new Request("https://app.test/_next/static/chunks/main-app-9f2a1b3c4d5e6f7a.js"));
    await settle();

    expect(assetStore()?.size ?? 0).toBe(1);
  });

  it("never caches anything from a loopback dev origin", async () => {
    const sw = (globalThis as unknown as { self: { location: { hostname: string } } }).self;
    const original = sw.location.hostname;
    sw.location.hostname = "localhost";
    try {
      vi.stubGlobal(
        "fetch",
        async () => new Response("bundle", { headers: { "Content-Type": "text/javascript" } })
      );
      await dispatch(new Request("https://app.test/_next/static/chunks/main-app-9f2a1b3c4d5e6f7a.js"));
      await settle();
      expect(assetStore()?.size ?? 0).toBe(0);
    } finally {
      sw.location.hostname = original;
    }
  });
});
