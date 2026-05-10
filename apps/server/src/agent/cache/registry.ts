import crypto from "node:crypto";
import { pool } from "../../db/pool.js";

export type CacheKey = {
  userId: string;
  accountId: string;
  resourceType: string;
  /** Any JSON-serializable filter shape. Stable-sorted, hashed. */
  query?: unknown;
};

export type ResourceType =
  | "phone_numbers"
  | "phone_number"
  | "messaging_services"
  | "messaging_service"
  | "messaging_service_senders";

/**
 * Stable JSON stringify — object keys sorted recursively so {a:1,b:2} and
 * {b:2,a:1} hash identically. Returns "" for null/undefined so parameter-less
 * lists get a canonical empty hash.
 */
function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

function hashQuery(query: unknown): string {
  const s = stableStringify(query);
  if (s === "") return "";
  return crypto.createHash("sha256").update(s).digest("hex");
}

function keyString(k: CacheKey): string {
  return `${k.accountId}:${k.resourceType}:${hashQuery(k.query)}`;
}

const inFlight = new Map<string, Promise<unknown>>();

export type CacheHitStat = "hit" | "inflight" | "miss";
type Listener = (stat: CacheHitStat, key: CacheKey) => void;
const listeners: Listener[] = [];

/** Observability hook for the smoke script / dev logs. */
export function onCacheEvent(l: Listener): () => void {
  listeners.push(l);
  return () => {
    const i = listeners.indexOf(l);
    if (i >= 0) listeners.splice(i, 1);
  };
}
function emit(stat: CacheHitStat, key: CacheKey) {
  for (const l of listeners) l(stat, key);
}

/**
 * Read-through cache with in-process single-flight coalescing.
 *
 * Flow:
 *   1. SELECT durable row; if present and unexpired → return (hit).
 *   2. If another caller is already fetching the same key → await their promise (inflight).
 *   3. Otherwise fetch, UPSERT on success, remove from inFlight registry (miss).
 *
 * Errors from the fetcher are NOT cached — the inFlight entry is removed in
 * `finally` regardless of outcome, so a subsequent call retries fresh.
 */
export async function cachedTwilioCall<T>(
  key: CacheKey,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const qh = hashQuery(key.query);
  const hit = await pool.query<{ data: T }>(
    `SELECT data FROM resource_cache
       WHERE account_id = $1 AND resource_type = $2 AND query_hash = $3
         AND expires_at > now()`,
    [key.accountId, key.resourceType, qh],
  );
  if (hit.rows[0]) {
    emit("hit", key);
    return hit.rows[0].data;
  }

  const k = keyString(key);
  const existing = inFlight.get(k);
  if (existing) {
    emit("inflight", key);
    return existing as Promise<T>;
  }

  emit("miss", key);
  const promise = (async () => {
    const data = await fetcher();
    await pool.query(
      `INSERT INTO resource_cache (user_id, account_id, resource_type, query_hash, data, fetched_at, expires_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, now(), now() + ($6 || ' milliseconds')::interval)
       ON CONFLICT (account_id, resource_type, query_hash)
       DO UPDATE SET data = EXCLUDED.data,
                     fetched_at = EXCLUDED.fetched_at,
                     expires_at = EXCLUDED.expires_at,
                     user_id = EXCLUDED.user_id`,
      [key.userId, key.accountId, key.resourceType, qh, JSON.stringify(data), String(ttlMs)],
    );
    return data;
  })();

  inFlight.set(k, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(k);
  }
}

/**
 * Invalidate cached rows for an account. Called from write tools after a
 * mutation succeeds. Coarse — we drop whole resource_types, not individual
 * rows — because writes can affect multiple cached queries.
 */
export async function invalidateCache(
  accountId: string,
  resourceTypes: ResourceType[],
): Promise<void> {
  if (resourceTypes.length === 0) return;
  await pool.query(
    `DELETE FROM resource_cache WHERE account_id = $1 AND resource_type = ANY($2::text[])`,
    [accountId, resourceTypes],
  );
}
