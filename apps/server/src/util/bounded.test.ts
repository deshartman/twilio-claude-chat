import { describe, it, expect } from "vitest";
import { runBounded, JobTimeoutError } from "./bounded.js";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("runBounded", () => {
  it("returns results in input order, regardless of completion order", async () => {
    // Three jobs: job 0 takes 30ms, job 1 takes 5ms, job 2 takes 15ms.
    // Without the positional assignment via cursor/idx, results would come
    // back in completion order (1, 2, 0) — breaking downstream indexing.
    const jobs = [
      async () => {
        await delay(30);
        return "slow";
      },
      async () => {
        await delay(5);
        return "fast";
      },
      async () => {
        await delay(15);
        return "mid";
      },
    ];
    const results = await runBounded(jobs, 3);
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual(["slow", "fast", "mid"]);
  });

  it("captures per-job errors without aborting the batch", async () => {
    const jobs = [
      async () => "a",
      async () => {
        throw new Error("boom");
      },
      async () => "c",
    ];
    const results = await runBounded(jobs, 2);
    expect(results[0]).toEqual({ ok: true, value: "a" });
    expect(results[1].ok).toBe(false);
    if (!results[1].ok) {
      expect(results[1].error).toBeInstanceOf(Error);
      expect((results[1].error as Error).message).toBe("boom");
    }
    expect(results[2]).toEqual({ ok: true, value: "c" });
  });

  it("respects the concurrency limit (never more than `limit` in flight)", async () => {
    let inFlight = 0;
    let peak = 0;
    const jobs = Array.from({ length: 20 }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await delay(10);
      inFlight--;
      return "ok";
    });
    await runBounded(jobs, 4);
    expect(peak).toBeLessThanOrEqual(4);
    // Should actually reach 4 — otherwise we're not using the pool.
    expect(peak).toBe(4);
  });

  it("times out individual jobs via JobTimeoutError without stalling the batch", async () => {
    const jobs = [
      async () => {
        await delay(5);
        return "quick";
      },
      async () => {
        // Longer than the timeout — this should resolve as a timeout error,
        // NOT hold up the scan.
        await delay(1000);
        return "never observed";
      },
      async () => {
        await delay(5);
        return "also quick";
      },
    ];
    const started = Date.now();
    const results = await runBounded(jobs, 3, { timeoutMs: 50 });
    const elapsed = Date.now() - started;

    // The whole batch should complete in ~50ms (the timeout), not ~1000ms.
    // Generous upper bound accounts for CI jitter.
    expect(elapsed).toBeLessThan(500);

    expect(results[0]).toEqual({ ok: true, value: "quick" });
    expect(results[1].ok).toBe(false);
    if (!results[1].ok) {
      expect(results[1].error).toBeInstanceOf(JobTimeoutError);
    }
    expect(results[2]).toEqual({ ok: true, value: "also quick" });
  });

  it("no timeout: jobs resolve on their own schedule", async () => {
    const jobs = [
      async () => {
        await delay(20);
        return "a";
      },
    ];
    const results = await runBounded(jobs, 1);
    expect(results[0]).toEqual({ ok: true, value: "a" });
  });

  it("empty jobs array resolves to empty result", async () => {
    const results = await runBounded<string>([], 5);
    expect(results).toEqual([]);
  });
});
