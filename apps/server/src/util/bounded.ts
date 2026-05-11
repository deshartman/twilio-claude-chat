export type JobResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

export type RunBoundedOptions = {
  /** Per-job timeout in ms. When exceeded, the job's result entry is a timeout error. */
  timeoutMs?: number;
};

export class JobTimeoutError extends Error {
  constructor(ms: number) {
    super(`Job exceeded ${ms}ms timeout`);
    this.name = "JobTimeoutError";
  }
}

/**
 * Run N jobs with at most `limit` in flight at once. Each job is a fn returning
 * a promise. Per-job failures and timeouts are captured into the result array —
 * one rejection does not abort the batch.
 *
 * Worker-pool pattern: spawn `limit` workers; each pulls the next index off a
 * shared counter until the queue drains. A slow job only blocks its own
 * worker; the other `limit-1` workers keep draining. Total wall-clock is
 * roughly `max(slowest_job, total / limit * mean_job)`.
 *
 * Timeout semantics: we Promise.race the job against a setTimeout. If the
 * timeout wins, the job's result is `{ok:false, error: JobTimeoutError}` and
 * the worker moves on. The underlying promise keeps running in the background;
 * the caller is responsible for any side-effect ordering concerns if the slow
 * job later resolves (e.g. a cache UPSERT happening after scan_status = ready).
 */
export async function runBounded<T>(
  jobs: Array<() => Promise<T>>,
  limit: number,
  options: RunBoundedOptions = {},
): Promise<Array<JobResult<T>>> {
  const results = new Array<JobResult<T>>(jobs.length);
  let cursor = 0;

  async function wrap(idx: number): Promise<JobResult<T>> {
    const p = jobs[idx]();
    if (options.timeoutMs === undefined) {
      return p.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    }
    const ms = options.timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<JobResult<T>>((resolve) => {
      timer = setTimeout(
        () => resolve({ ok: false as const, error: new JobTimeoutError(ms) }),
        ms,
      );
    });
    const jobPromise = p.then(
      (value): JobResult<T> => ({ ok: true as const, value }),
      (error: unknown): JobResult<T> => ({ ok: false as const, error }),
    );
    const winner = await Promise.race([jobPromise, timeoutPromise]);
    if (timer !== undefined) clearTimeout(timer);
    return winner;
  }

  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const idx = cursor++;
      results[idx] = await wrap(idx);
    }
  }

  const workers = Array.from({ length: Math.min(limit, jobs.length) }, worker);
  await Promise.all(workers);
  return results;
}
