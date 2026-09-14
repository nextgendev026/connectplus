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
  location: { origin: "https://app.test" },
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

    await (await caches.open("connectplus-v6-shell" as never)).put(
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
