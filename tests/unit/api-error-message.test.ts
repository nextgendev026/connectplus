import { describe, expect, it } from "vitest";

import { apiErrorMessage } from "@/lib/errors/message";

/**
 * The bug this pins: `new Error(err.error)` on the shared envelope coerced an
 * object with `String()`, so the Studio showed `[object Object]` where the
 * reason for a failed publish should be — including the edge 403 that made
 * publishing through Cloudflare look like a mysterious `(object:object)`.
 */
describe("apiErrorMessage", () => {
  it("shows a legacy string error verbatim", () => {
    expect(apiErrorMessage({ error: "Title is required" }, "fallback")).toBe("Title is required");
  });

  it("unwraps the shared envelope instead of stringifying it", () => {
    const envelope = {
      error: {
        code: "FORBIDDEN",
        message: "This request did not come from the application",
        details: [],
        requestId: "9e9654d7-8971-407c-8b04-6660bbae0cb3",
      },
    };
    expect(apiErrorMessage(envelope, "Failed to publish")).toBe(
      "This request did not come from the application"
    );
  });

  it("falls back to the code when the envelope carries no message", () => {
    expect(apiErrorMessage({ error: { code: "RATE_LIMITED" } }, "Failed to save")).toBe(
      "RATE_LIMITED"
    );
  });

  it("accepts a bare message shape, which a few hand-rolled routes answer", () => {
    expect(apiErrorMessage({ message: "Nope" }, "fallback")).toBe("Nope");
  });

  it("returns the fallback when the body carries nothing readable", () => {
    expect(apiErrorMessage(null, "Failed to upload")).toBe("Failed to upload");
    expect(apiErrorMessage("plain string", "Failed to upload")).toBe("Failed to upload");
    expect(apiErrorMessage({}, "Failed to upload")).toBe("Failed to upload");
    expect(apiErrorMessage({ error: "   " }, "Failed to upload")).toBe("Failed to upload");
  });
});
