import { describe, expect, it, vi } from "vitest";
import { isTransientDbError, withDbRetry } from "@/lib/db-retry";

const poolError = () => Object.assign(new Error("Timed out fetching a new connection from the connection pool"), { code: "P2024" });

describe("isTransientDbError", () => {
  it("recognises pool and connection error codes", () => {
    for (const code of ["P2024", "P1001", "P1002", "P1008", "P1017", "P2028"]) {
      expect(isTransientDbError(Object.assign(new Error("boom"), { code }))).toBe(true);
    }
  });

  it("recognises connection-pool wording even without a code", () => {
    expect(isTransientDbError(new Error("Timed out fetching a new connection from the connection pool"))).toBe(true);
    expect(isTransientDbError(new Error("Connection reset by peer"))).toBe(true);
    expect(isTransientDbError(new Error("ECONNRESET"))).toBe(true);
  });

  it("does not treat query bugs as transient", () => {
    // A unique-constraint violation must never be retried.
    expect(isTransientDbError(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))).toBe(false);
    expect(isTransientDbError(new Error("Unknown argument `foo`"))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
    expect(isTransientDbError("P2024")).toBe(false);
  });
});

describe("withDbRetry", () => {
  it("returns the first successful result without sleeping", async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi.fn(async () => "ok");

    await expect(withDbRetry(operation, { sleep })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a transient failure once and succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(poolError())
      .mockResolvedValueOnce("recovered");

    await expect(withDbRetry(operation, { sleep })).resolves.toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("never retries a non-transient error", async () => {
    const sleep = vi.fn(async () => {});
    const error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const operation = vi.fn(async () => {
      throw error;
    });

    await expect(withDbRetry(operation, { sleep })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after the configured attempts and rethrows the last error", async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi.fn(async () => {
      throw poolError();
    });

    await expect(withDbRetry(operation, { retries: 2, sleep })).rejects.toMatchObject({ code: "P2024" });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("backs off exponentially and reports each retry", async () => {
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();
    const operation = vi.fn(async () => {
      throw poolError();
    });

    await expect(withDbRetry(operation, { retries: 2, delayMs: 100, sleep, onRetry })).rejects.toThrow();

    const retries = onRetry.mock.calls.map((call) => call[0]);
    expect(retries).toHaveLength(2);
    const [first, second] = retries;
    // 100ms then 200ms, both with up to 25% jitter.
    expect(first!.delayMs).toBeGreaterThanOrEqual(100);
    expect(first!.delayMs).toBeLessThanOrEqual(125);
    expect(second!.delayMs).toBeGreaterThanOrEqual(200);
    expect(second!.delayMs).toBeLessThanOrEqual(250);
    expect(first!.attempt).toBe(1);
    expect(second!.attempt).toBe(2);
  });

  it("treats retries: 0 as a single attempt", async () => {
    const operation = vi.fn(async () => {
      throw poolError();
    });
    await expect(withDbRetry(operation, { retries: 0 })).rejects.toMatchObject({ code: "P2024" });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
