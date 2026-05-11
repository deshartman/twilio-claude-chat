import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above imports; using vi.hoisted to declare the mockQuery
// fn lets the factory reference it safely. Without this, the factory closes
// over an uninitialized variable and crashes with "Cannot access before init".
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>(),
}));

vi.mock("../../db/pool.js", () => ({
  pool: {
    query: mockQuery,
  },
}));

import { cachedTwilioCall, invalidateCache } from "./registry.js";

beforeEach(() => {
  mockQuery.mockReset();
});

afterEach(() => {
  mockQuery.mockReset();
});

/** A pg.query stub that: returns `selectRows` on SELECT, `{rows:[]}` otherwise. */
function setQuery(selectRows: unknown[]) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.trim().toUpperCase().startsWith("SELECT")) {
      return { rows: selectRows };
    }
    return { rows: [] };
  });
}

describe("cachedTwilioCall single-flight", () => {
  it("returns cached data without calling fetcher when row is unexpired", async () => {
    setQuery([{ data: { cached: true } }]);
    const fetcher = vi.fn(async () => ({ fresh: true }));
    const result = await cachedTwilioCall(
      { userId: "u1", accountId: "a1", resourceType: "phone_numbers" },
      60_000,
      fetcher,
    );
    expect(result).toEqual({ cached: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("calls fetcher on miss and upserts the result", async () => {
    setQuery([]); // no cached row
    const fetcher = vi.fn(async () => ({ sid: "PN123" }));
    const result = await cachedTwilioCall(
      { userId: "u1", accountId: "a1", resourceType: "phone_numbers" },
      60_000,
      fetcher,
    );
    expect(result).toEqual({ sid: "PN123" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    // SELECT + INSERT
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toContain("INSERT INTO resource_cache");
    expect(insertCall[1]).toEqual([
      "u1",
      "a1",
      "phone_numbers",
      "", // empty query_hash for no query param
      JSON.stringify({ sid: "PN123" }),
      "60000",
    ]);
  });

  it("coalesces two concurrent misses into a single fetcher call (SAME key)", async () => {
    setQuery([]);
    // Slow fetcher so both callers hit the in-flight path.
    let resolveFetch: (v: { ok: true }) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const key = { userId: "u1", accountId: "a1", resourceType: "phone_numbers" as const };

    // Fire two calls back-to-back without awaiting.
    const p1 = cachedTwilioCall(key, 60_000, fetcher);
    const p2 = cachedTwilioCall(key, 60_000, fetcher);

    // Let microtasks drain so both have had a chance to hit the SELECT.
    await Promise.resolve();
    await Promise.resolve();

    // Only ONE fetcher invocation despite two parallel calls.
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Unblock the fetcher; both callers should resolve to the same value.
    resolveFetch({ ok: true });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
  });

  it("does NOT coalesce across different keys", async () => {
    setQuery([]);
    const fetcher = vi.fn(async (): Promise<string> => "v");
    const k1 = { userId: "u1", accountId: "a1", resourceType: "phone_numbers" as const };
    const k2 = { userId: "u1", accountId: "a2", resourceType: "phone_numbers" as const };
    await Promise.all([
      cachedTwilioCall(k1, 60_000, fetcher),
      cachedTwilioCall(k2, 60_000, fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("clears inFlight entry on fetcher failure so the next call retries fresh", async () => {
    setQuery([]);
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("twilio 500"))
      .mockResolvedValueOnce("ok-on-retry");

    const key = { userId: "u1", accountId: "a1", resourceType: "phone_numbers" as const };

    await expect(cachedTwilioCall(key, 60_000, fetcher)).rejects.toThrow("twilio 500");
    // Next call: fetcher is NOT an in-flight hit — it's a fresh miss.
    const result = await cachedTwilioCall(key, 60_000, fetcher);
    expect(result).toBe("ok-on-retry");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stable query hashing: same object content yields same cache key", async () => {
    // Two calls with logically identical queries but different key ordering.
    setQuery([]);
    let resolveFetch: (v: string) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const a = cachedTwilioCall(
      {
        userId: "u1",
        accountId: "a1",
        resourceType: "messaging_service",
        query: { service_sid: "MG1", foo: "bar" },
      },
      60_000,
      fetcher,
    );
    const b = cachedTwilioCall(
      {
        userId: "u1",
        accountId: "a1",
        resourceType: "messaging_service",
        query: { foo: "bar", service_sid: "MG1" },
      },
      60_000,
      fetcher,
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveFetch("v");
    await Promise.all([a, b]);
  });
});

describe("invalidateCache", () => {
  it("emits a DELETE with the given account + resource types", async () => {
    setQuery([]);
    await invalidateCache("a1", ["phone_numbers", "phone_number"]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("DELETE FROM resource_cache");
    expect(params).toEqual(["a1", ["phone_numbers", "phone_number"]]);
  });

  it("is a no-op for an empty resourceTypes list", async () => {
    await invalidateCache("a1", []);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
