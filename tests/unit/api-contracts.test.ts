import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import {
  API_ERROR_CODES,
  AppError,
  DEFAULT_MESSAGES,
  ERROR_STATUS,
  apiErrorResponse,
  authenticationRequired,
  conflict,
  databaseUnavailable,
  errorPayload,
  forbidden,
  internalError,
  notFound,
  rateLimited,
  validationError,
} from "@/lib/errors";
import {
  anonymousContext,
  detectPlatform,
  requestContext,
  readRequestId,
} from "@/lib/request-context";
import {
  API_VERSION,
  apiHandler,
  decodeCursor,
  encodeCursor,
  readLimit,
  validateResponse,
} from "@/lib/contracts";
import { z } from "zod";

/**
 * The API contract, pinned.
 *
 * Phase B's acceptance criteria are all of the form "an error means the same
 * thing everywhere": 400 for a bad request, 401 for no session, 403 for the wrong
 * person, 404 for a missing row, 409 for a conflict, 429 with `Retry-After`, and
 * — the one nobody remembers to check — **no stack trace, ever**.
 *
 * These are asserted here rather than route by route because the point of the
 * contract is that a route does not decide. The three route-level tests at the
 * bottom are the exception: they exist because "401 without a session" is a
 * behaviour, not a mapping table.
 */

const db = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  notificationFindMany: vi.fn(),
  notificationCount: vi.fn(),
  postFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: { findMany: db.notificationFindMany, count: db.notificationCount },
    post: { findMany: db.postFindMany },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => db.session }));

const { GET: notificationsGet } = await import("@/app/api/v1/notifications/route");
const { GET: postsGet } = await import("@/app/api/v1/posts/route");
const { GET: healthGet } = await import("@/app/api/v1/health/route");
const { GET: sessionGet } = await import("@/app/api/v1/auth/session/route");

function get(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers }) as never;
}

beforeEach(() => {
  db.session = null;
  db.notificationFindMany.mockReset();
  db.notificationCount.mockReset();
  db.postFindMany.mockReset();
});

describe("the error vocabulary is total", () => {
  it("gives every code a status and a default message", () => {
    for (const code of API_ERROR_CODES) {
      expect(ERROR_STATUS[code], `${code} has no status`).toBeTypeOf("number");
      expect(DEFAULT_MESSAGES[code], `${code} has no default message`).toBeTruthy();
    }
  });

  it("maps codes onto the statuses the acceptance criteria name", () => {
    expect(ERROR_STATUS.VALIDATION_ERROR).toBe(400);
    expect(ERROR_STATUS.AUTHENTICATION_REQUIRED).toBe(401);
    expect(ERROR_STATUS.FORBIDDEN).toBe(403);
    expect(ERROR_STATUS.NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.CONFLICT).toBe(409);
    expect(ERROR_STATUS.RATE_LIMITED).toBe(429);
  });

  it("answers every failure with the same envelope", async () => {
    const response = apiErrorResponse(notFound(), "req-12345678");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: DEFAULT_MESSAGES.NOT_FOUND,
        details: [],
        requestId: "req-12345678",
      },
    });
  });

  it("carries details for a validation failure", async () => {
    const response = apiErrorResponse(
      validationError([{ path: ["title"], message: "Required", code: "invalid_type" }], "Bad input"),
      "req-abcdefgh"
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toBe("Bad input");
    expect(body.error.details).toEqual([{ path: ["title"], message: "Required", code: "invalid_type" }]);
  });

  it("sets Retry-After when the caller should wait", async () => {
    const response = apiErrorResponse(rateLimited(2.2), "req-abcdefgh");
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3");
  });
});

describe("failures never disclose more than they should", () => {
  it("hides the message of an internal error, however it was built", async () => {
    // The shape a careless call site produces: a real error's text passed as the
    // message. It must not reach the client.
    const secret = "postgresql://postgres:pw@db.internal:5432/connectplus";
    const body = await apiErrorResponse(
      new AppError("INTERNAL_ERROR", secret),
      "req-abcdefgh"
    ).json();

    expect(body.error.message).toBe(DEFAULT_MESSAGES.INTERNAL_ERROR);
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("hides a database-unavailable cause", async () => {
    const body = await apiErrorResponse(
      databaseUnavailable(new Error("ECONNREFUSED 10.0.0.5:5432")),
      "req-abcdefgh"
    ).json();

    expect(body.error.code).toBe("DATABASE_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
  });

  it("never leaks a stack trace from an unexpected throw", async () => {
    const thrown = new Error("boom: /app/node_modules/@prisma/client/runtime/library.js line 1");
    const response = apiErrorResponse(thrown, "req-abcdefgh");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("boom");
    expect(JSON.stringify(body)).not.toContain("node_modules");
    expect(body.error.details).toEqual([]);
  });

  it("keeps the request id on the failure so a report is traceable", async () => {
    const body = await apiErrorResponse(internalError(), "req-trace-me1").json();
    expect(body.error.requestId).toBe("req-trace-me1");
  });
});

describe("apiHandler is where a route stops having to remember", () => {
  it("shapes a thrown AppError without the handler catching anything", async () => {
    const handler = apiHandler(async () => {
      throw conflict("Already published");
    });

    const response = await handler(get("http://localhost/api/v1/x"));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("CONFLICT");
  });

  it("shapes an unexpected throw as a 500 with no detail", async () => {
    const handler = apiHandler(async () => {
      throw new Error("Cannot read properties of undefined (reading 'slug')");
    });

    const response = await handler(get("http://localhost/api/v1/x"));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("slug");
  });

  it("passes a request id from the header through to the envelope", async () => {
    const handler = apiHandler(async () => {
      throw forbidden();
    });

    const response = await handler(
      get("http://localhost/api/v1/x", { "x-request-id": "client-supplied-1" })
    );
    expect((await response.json()).error.requestId).toBe("client-supplied-1");
  });
});

describe("request context", () => {
  it("echoes a well-formed request id", () => {
    expect(readRequestId(get("http://localhost/", { "x-request-id": "abc-123-XYZ_9" }))).toBe(
      "abc-123-XYZ_9"
    );
  });

  it("replaces a request id that could not safely be echoed", () => {
    // Too short, then a log-injection attempt, then an unbounded blob. (A header
    // value containing a newline cannot even be constructed — the platform
    // refuses it — so a markup payload stands in for "hostile but transmissible".)
    for (const bad of ["short", "id with spaces", "x".repeat(300), "<script>alert(1)</script>"]) {
      const produced = readRequestId(get("http://localhost/", { "x-request-id": bad }));
      expect(produced).not.toBe(bad);
      expect(produced).toMatch(/^[0-9a-f-]{36}$/); // a generated UUID
    }
  });

  it("believes an explicit platform header and otherwise infers", () => {
    expect(detectPlatform(get("http://localhost/", { "x-client-platform": "android" }))).toBe("android");

    // A declaration we do not recognise is not a declaration: fall back to the
    // user agent, and admit ignorance when there is none. Guessing "web" for a
    // native client would be a confident wrong answer.
    expect(detectPlatform(get("http://localhost/", { "x-client-platform": "nonsense" }))).toBe("unknown");
    expect(
      detectPlatform(
        get("http://localhost/", {
          "x-client-platform": "nonsense",
          "user-agent": "Mozilla/5.0 (Macintosh)",
        })
      )
    ).toBe("web");
    expect(
      detectPlatform(get("http://localhost/", { "user-agent": "ConnectPlus-Android/1.2" }))
    ).toBe("android");
    expect(detectPlatform(get("http://localhost/"))).toBe("unknown");
  });

  it("validates the metadata it echoes back", () => {
    const ctx = requestContext(
      get("http://localhost/", {
        "accept-language": "sw-KE,en;q=0.9",
        "x-timezone": "Africa/Nairobi",
        "x-app-version": "1.4.2",
      })
    );

    expect(ctx.locale).toBe("sw-KE");
    expect(ctx.timezone).toBe("Africa/Nairobi");
    expect(ctx.clientVersion).toBe("1.4.2");

    const hostile = requestContext(
      get("http://localhost/", {
        "x-timezone": "Africa/Nairobi/../../etc/passwd",
        "x-app-version": "not a version",
      })
    );
    expect(hostile.timezone).toBe("UTC");
    expect(hostile.clientVersion).toBeNull();
  });

  it("resolves no identity unless asked", () => {
    const ctx = requestContext(get("http://localhost/"));
    expect(ctx.actorId).toBeNull();
    expect(ctx.sessionId).toBeNull();
  });
});

describe("cursors are opaque and never trusted", () => {
  it("round-trips", () => {
    expect(decodeCursor(encodeCursor({ id: "abc123" }))).toEqual({ id: "abc123" });
  });

  it("refuses anything that is not a cursor rather than failing a request", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "not-base64-at-all!!",
      Buffer.from("[1,2,3]").toString("base64url"), // an array
      Buffer.from("null").toString("base64url"),
      Buffer.from(JSON.stringify({ id: 42 })).toString("base64url"), // non-string value
      Buffer.from(JSON.stringify({ id: "x".repeat(200) })).toString("base64url"), // oversized value
      "A".repeat(600), // oversized cursor
    ]) {
      expect(decodeCursor(bad), `should refuse ${String(bad).slice(0, 20)}`).toBeNull();
    }
  });

  it("clamps a requested page size", () => {
    expect(readLimit(new URLSearchParams("limit=10"))).toBe(10);
    expect(readLimit(new URLSearchParams("limit=99999"))).toBe(50);
    expect(readLimit(new URLSearchParams("limit=0"))).toBe(20);
    expect(readLimit(new URLSearchParams("limit=-5"))).toBe(20);
    expect(readLimit(new URLSearchParams("limit=abc"))).toBe(20);
    expect(readLimit(new URLSearchParams())).toBe(20);
  });
});

describe("responses are validated against their own contract", () => {
  it("returns the parsed value when it matches", () => {
    const schema = z.object({ count: z.number() });
    expect(validateResponse(schema, { count: 2 }, "test")).toEqual({ count: 2 });
  });

  it("treats a contract break as a server bug, not a client error", () => {
    const schema = z.object({ count: z.number() });
    // A widened `select` pushing a string into a numeric field is exactly this.
    expect(() => validateResponse(schema, { count: "2" }, "test")).toThrowError(
      expect.objectContaining({ code: "INTERNAL_ERROR" })
    );
  });
});

describe("the versioned routes honour the contract", () => {
  it("answers anonymous callers with 401 in the shared envelope", async () => {
    const response = await notificationsGet(get("http://localhost/api/v1/notifications"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(body.error.requestId).toBeTruthy();
    // The query must not run at all for an anonymous caller.
    expect(db.notificationFindMany).not.toHaveBeenCalled();
  });

  it("refuses an over-long search instead of scanning with it", async () => {
    const response = await postsGet(
      get(`http://localhost/api/v1/posts?search=${"a".repeat(101)}`)
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].path).toEqual(["search"]);
    expect(db.postFindMany).not.toHaveBeenCalled();
  });

  it("reports the API version and the caller's platform", async () => {
    const response = await healthGet(
      get("http://localhost/api/v1/health", { "x-client-platform": "ios" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.apiVersion).toBe(API_VERSION);
    expect(body.data.clientPlatform).toBe("ios");
    expect(body.meta.requestId).toBeTruthy();
    expect(body.meta.timestamp).toBeTruthy();
    expect(body.error).toBeUndefined();
  });

  it("requires a session for its own identity", async () => {
    const response = await sessionGet(get("http://localhost/api/v1/auth/session"));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("answers a signed-in reader without exposing the session object", async () => {
    db.session = { user: { id: "user-1" } };
    const response = await sessionGet(get("http://localhost/api/v1/auth/session"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.user.id).toBe("user-1");
    // A reader-scoped response must never be storable by a shared cache.
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});

describe("the success and failure shapes cannot be confused", () => {
  it("keeps `data` and `error` disjoint", async () => {
    const ok = await healthGet(get("http://localhost/api/v1/health")).then((r) => r.json());
    const bad = await apiErrorResponse(forbidden(), "req-abcdefgh").json();

    expect(ok).toHaveProperty("data");
    expect(ok).not.toHaveProperty("error");
    expect(bad).toHaveProperty("error");
    expect(bad).not.toHaveProperty("data");
  });

  it("exposes a context for code that has no inbound request", () => {
    const ctx = anonymousContext({ actorId: "system" });
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx.actorId).toBe("system");
    expect(NextResponse.json({ ok: true }) instanceof NextResponse).toBe(true);
  });
});
