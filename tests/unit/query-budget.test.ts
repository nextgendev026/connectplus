import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Query budgets.
 *
 * The interesting properties are not "does it pass a value through" — they are
 * the three ways a budget can be wrong:
 *
 *   1. It does not fire, so a runaway query hangs the request. (The bug this
 *      module exists for: the intelligence layer's regional sweep had no bound.)
 *   2. It fires too eagerly, so a legitimate slow-but-fine query fails.
 *   3. It fires and nobody can see it, so the overrun is invisible and the
 *      budget becomes a source of mystery failures instead of a diagnostic.
 *
 * Every timeout case drives fake timers rather than sleeping. Five real 1.5s
 * waits would add seconds to the suite for no extra information, and the
 * seventy-iteration log-cap test would have taken two minutes.
 */

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const {
  QUERY_BUDGETS,
  QueryTimeoutError,
  withinBudget,
  withinBudgetOrNull,
  slowQueryReport,
  resetQueryBudgetStats,
  queryBudgetHealth,
} = await import("@/lib/query-budget");

beforeEach(() => {
  resetQueryBudgetStats();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Drive a never-settling query past its budget and hand back the outcome.
 *
 * The rejection handler is attached *before* the clock advances, which is not
 * stylistic. Under fake timers the budget fires during `advanceTimersByTimeAsync`;
 * if nothing is listening yet the rejection is unhandled, and Node reports it as
 * a crash that vitest attributes to whichever test happened to be running.
 */
async function overrun<T>(run: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const settled = run.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  await vi.advanceTimersByTimeAsync(QUERY_BUDGETS.point + 1);
  return settled;
}

describe("withinBudget", () => {
  it("returns the value and records nothing when the query is quick", async () => {
    const result = await withinBudget("fast", "point", async () => 42);
    expect(result).toBe(42);
    expect(slowQueryReport().overruns).toBe(0);
    expect(slowQueryReport().recent).toHaveLength(0);
  });

  it("throws a labelled timeout rather than hanging a request", async () => {
    // A promise that never settles — the shape of a query waiting on a lock.
    const outcome = await overrun(withinBudget("runaway", "point", () => new Promise(() => {})));
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: unknown }).error).toBeInstanceOf(QueryTimeoutError);
  });

  it("names the query and the budget on the error, so the log points somewhere", async () => {
    const outcome = await overrun(withinBudget("regional.sweep", "point", () => new Promise(() => {})));
    expect((outcome as { error: InstanceType<typeof QueryTimeoutError> }).error).toMatchObject({
      name: "QueryTimeoutError",
      label: "regional.sweep",
      budgetMs: QUERY_BUDGETS.point,
    });
  });

  it("propagates the query's own error unchanged, and does not record it as an overrun", async () => {
    // A database error is not a budget problem. Conflating them would send an
    // operator looking for a slow query when the real issue is a bad statement.
    await expect(
      withinBudget("bad", "point", async () => {
        throw new Error("relation does not exist");
      })
    ).rejects.toThrow("relation does not exist");
    expect(slowQueryReport().overruns).toBe(0);
  });

  it("records a query that succeeds but sits past the warning line", async () => {
    // 80% of the budget is the warning line: a query that is nearly over budget
    // is the one that will be over budget next month.
    const delay = Math.floor(QUERY_BUDGETS.point * 0.85);
    const pending = withinBudget("slow-but-ok", "point", async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return "ok";
    });
    await vi.advanceTimersByTimeAsync(delay);
    await expect(pending).resolves.toBe("ok");

    const { overruns, recent } = slowQueryReport();
    expect(overruns).toBe(1);
    expect(recent[0]?.label).toBe("slow-but-ok");
    expect(recent[0]?.budget).toBe("point");
  });

  it("clears the budget timer on the success path", async () => {
    // An un-cleared timer rejects a promise nobody is holding, which in Node is
    // an unhandled rejection — surfacing as a crash after the request that
    // caused it, with no stack pointing at the query.
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    await withinBudget("quick", "point", async () => "done");
    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });
});

describe("withinBudgetOrNull", () => {
  it("degrades to null on a timeout instead of failing the read path", async () => {
    const outcome = await overrun(withinBudgetOrNull("optional", "point", () => new Promise(() => {})));
    expect(outcome).toEqual({ ok: true, value: null });
  });

  it("still records the degradation, so a degraded dashboard is not silent", async () => {
    await overrun(withinBudgetOrNull("optional", "point", () => new Promise(() => {})));
    expect(slowQueryReport().overruns).toBe(1);
    expect(slowQueryReport().recent[0]?.label).toBe("optional");
  });

  it("does not swallow a real error — only a budget overrun is optional", async () => {
    await expect(
      withinBudgetOrNull("bad", "point", async () => {
        throw new Error("syntax error at or near");
      })
    ).rejects.toThrow("syntax error");
  });
});

describe("budgets are ordered by the shape of the statement", () => {
  it("gives a sweep more room than a point read", () => {
    expect(QUERY_BUDGETS.sweep).toBeGreaterThan(QUERY_BUDGETS.aggregate);
    expect(QUERY_BUDGETS.aggregate).toBeGreaterThan(QUERY_BUDGETS.point);
  });

  it("keeps every budget inside a serverless request, so nothing is killed mid-answer", () => {
    for (const [name, ms] of Object.entries(QUERY_BUDGETS)) {
      expect(ms, `${name} must fail before the platform kills the request`).toBeLessThanOrEqual(25_000);
    }
  });
});

describe("queryBudgetHealth", () => {
  it("reports clean when nothing has overrun", async () => {
    const health = await queryBudgetHealth();
    expect(health.level).toBe("ok");
    expect(health.detail).toContain("No query exceeded");
  });

  it("names the slowest query when there has been an overrun", async () => {
    await overrun(withinBudgetOrNull("regional.sweep", "point", () => new Promise(() => {})));
    const health = await queryBudgetHealth();
    expect(health.level).toBe("warn");
    expect(health.detail).toContain("regional.sweep");
    expect(health.detail).toContain(`${QUERY_BUDGETS.point}ms point budget`);
  });
});

describe("the overrun log is bounded", () => {
  it("cannot grow without limit, however many queries overrun", async () => {
    // An unbounded log inside a long-lived instance is a memory leak that looks
    // like a feature. The cap is the feature.
    for (let i = 0; i < 70; i++) {
      await overrun(withinBudgetOrNull(`q${i}`, "point", () => new Promise(() => {})));
    }
    const { overruns, recent } = slowQueryReport();
    expect(overruns).toBe(70);
    expect(recent.length).toBeLessThanOrEqual(50);
    // Newest first, so the report shows what is happening now.
    expect(recent[0]?.label).toBe("q69");
  });
});
