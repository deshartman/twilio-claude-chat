import { pool } from "../db/pool.js";
import { open, seal } from "../crypto.js";

export type AuthMode = "api_key" | "auth_token";
export type ScanStatus = "pending" | "running" | "ready" | "failed";

export type AccountRow = {
  id: string;
  user_id: string;
  friendly_name: string;
  account_sid: string;
  auth_mode: AuthMode;
  is_subaccount: boolean;
  parent_account_id: string | null;
  created_at: Date;
  last_used_at: Date | null;
  scan_status: ScanStatus;
  scan_error: string | null;
};

export type NewAccountInput = {
  user_id: string;
  friendly_name: string;
  account_sid: string;
  is_subaccount?: boolean;
  parent_account_id?: string | null;
} & (
  | { auth_mode: "api_key"; api_key_sid: string; api_key_secret: string }
  | { auth_mode: "auth_token"; auth_token: string }
);

export type ResolvedCredentials =
  | { auth_mode: "api_key"; account_sid: string; api_key_sid: string; api_key_secret: string }
  | { auth_mode: "auth_token"; account_sid: string; auth_token: string };

type PackedCredentials =
  | { authMode: "api_key"; sid: string; secret: string }
  | { authMode: "auth_token"; authToken: string };

function packCredentials(input: NewAccountInput): string {
  const packed: PackedCredentials =
    input.auth_mode === "api_key"
      ? { authMode: "api_key", sid: input.api_key_sid, secret: input.api_key_secret }
      : { authMode: "auth_token", authToken: input.auth_token };
  return JSON.stringify(packed);
}

function unpackCredentials(plaintext: string): PackedCredentials {
  const raw = JSON.parse(plaintext);
  // Legacy rows (pre-Phase 2) sealed {sid, secret} with no authMode. Treat as api_key.
  if (raw && typeof raw === "object" && !("authMode" in raw) && "sid" in raw && "secret" in raw) {
    return { authMode: "api_key", sid: raw.sid, secret: raw.secret };
  }
  return raw as PackedCredentials;
}

export async function createAccount(input: NewAccountInput): Promise<AccountRow> {
  const { ct, iv, tag, keyVersion } = seal(packCredentials(input));
  const { rows } = await pool.query<AccountRow>(
    `INSERT INTO twilio_accounts
       (user_id, friendly_name, account_sid, auth_mode, is_subaccount, parent_account_id, credentials_ct, iv, tag, key_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, user_id, friendly_name, account_sid, auth_mode, is_subaccount, parent_account_id, created_at, last_used_at, scan_status, scan_error`,
    [
      input.user_id,
      input.friendly_name,
      input.account_sid,
      input.auth_mode,
      input.is_subaccount ?? false,
      input.parent_account_id ?? null,
      ct,
      iv,
      tag,
      keyVersion,
    ],
  );
  return rows[0];
}

export type UpdateAccountInput = {
  user_id: string;
  account_id: string;
  /** Optional rename. Trimmed, 1..80 chars if provided. */
  friendly_name?: string;
  /** Optional credential rotation. When provided, auth_mode + its secrets are required. */
  credentials?:
    | { auth_mode: "api_key"; api_key_sid: string; api_key_secret: string }
    | { auth_mode: "auth_token"; auth_token: string };
};

/**
 * Patch an account in place. Used when a user rotates their Twilio API key
 * upstream, or renames the account. Scoped by user_id — a user can only
 * edit their own accounts. account_sid is deliberately not editable; that's
 * a different Twilio account, and delete+recreate is the right flow.
 *
 * Returns null if the account doesn't exist or isn't owned by the user.
 */
export async function updateAccount(input: UpdateAccountInput): Promise<AccountRow | null> {
  // Build SET clauses dynamically — we only touch fields the caller provided.
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (input.friendly_name !== undefined) {
    sets.push(`friendly_name = $${i++}`);
    params.push(input.friendly_name);
  }
  if (input.credentials !== undefined) {
    // Re-seal with the CURRENT key version — an edit is an implicit rotation opportunity.
    const packed =
      input.credentials.auth_mode === "api_key"
        ? JSON.stringify({
            authMode: "api_key",
            sid: input.credentials.api_key_sid,
            secret: input.credentials.api_key_secret,
          })
        : JSON.stringify({ authMode: "auth_token", authToken: input.credentials.auth_token });
    const { ct, iv, tag, keyVersion } = seal(packed);
    sets.push(
      `auth_mode = $${i++}`,
      `credentials_ct = $${i++}`,
      `iv = $${i++}`,
      `tag = $${i++}`,
      `key_version = $${i++}`,
    );
    params.push(input.credentials.auth_mode, ct, iv, tag, keyVersion);
  }

  if (sets.length === 0) {
    // No-op caller; return the row as-is (scoped read).
    return getAccountForUser(input.user_id, input.account_id);
  }

  params.push(input.account_id, input.user_id);
  const { rows } = await pool.query<AccountRow>(
    `UPDATE twilio_accounts
        SET ${sets.join(", ")}
      WHERE id = $${i++} AND user_id = $${i}
      RETURNING id, user_id, friendly_name, account_sid, auth_mode, is_subaccount, parent_account_id, created_at, last_used_at, scan_status, scan_error`,
    params,
  );
  return rows[0] ?? null;
}

export async function listAccountsForUser(userId: string): Promise<AccountRow[]> {
  const { rows } = await pool.query<AccountRow>(
    `SELECT id, user_id, friendly_name, account_sid, auth_mode, is_subaccount, parent_account_id, created_at, last_used_at, scan_status, scan_error
       FROM twilio_accounts
      WHERE user_id = $1
      ORDER BY created_at ASC`,
    [userId],
  );
  return rows;
}

export async function deleteAccount(userId: string, accountId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM twilio_accounts WHERE id = $1 AND user_id = $2`,
    [accountId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Resolve credentials for a specific account owned by a specific user.
 * Always scoped by user_id — this is the isolation boundary that guarantees
 * one user can never load another's credentials regardless of agent hints.
 */
export async function loadCredentialsForAccount(
  userId: string,
  accountId: string,
): Promise<ResolvedCredentials | null> {
  const { rows } = await pool.query<{
    account_sid: string;
    credentials_ct: Buffer;
    iv: Buffer;
    tag: Buffer;
    key_version: number;
  }>(
    `SELECT account_sid, credentials_ct, iv, tag, key_version
       FROM twilio_accounts
      WHERE id = $1 AND user_id = $2`,
    [accountId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  const packed = unpackCredentials(
    open({ ct: row.credentials_ct, iv: row.iv, tag: row.tag, keyVersion: row.key_version }),
  );
  await pool.query(`UPDATE twilio_accounts SET last_used_at = now() WHERE id = $1`, [accountId]);
  if (packed.authMode === "api_key") {
    return {
      auth_mode: "api_key",
      account_sid: row.account_sid,
      api_key_sid: packed.sid,
      api_key_secret: packed.secret,
    };
  }
  return {
    auth_mode: "auth_token",
    account_sid: row.account_sid,
    auth_token: packed.authToken,
  };
}

/**
 * Match an `account_hint` (friendly name fragment or SID fragment) against
 * the user's accounts. Case-insensitive. Returns zero, one, or many matches;
 * callers decide how to disambiguate.
 */
export async function matchAccountsByHint(
  userId: string,
  hint: string,
): Promise<AccountRow[]> {
  const { rows } = await pool.query<AccountRow>(
    `SELECT id, user_id, friendly_name, account_sid, auth_mode, is_subaccount, parent_account_id, created_at, last_used_at, scan_status, scan_error
       FROM twilio_accounts
      WHERE user_id = $1
        AND (friendly_name ILIKE $2 OR account_sid ILIKE $2)
      ORDER BY created_at ASC`,
    [userId, `%${hint}%`],
  );
  return rows;
}

/**
 * Update pre-scan status. `scan_error` is only persisted on the failed transition;
 * success transitions clear it. Scoped by user_id so one user can't flip
 * another user's account state via a misaddressed rescan request.
 */
export async function setScanStatus(
  userId: string,
  accountId: string,
  status: ScanStatus,
  error: string | null = null,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE twilio_accounts
        SET scan_status = $3, scan_error = $4
      WHERE id = $1 AND user_id = $2`,
    [accountId, userId, status, status === "failed" ? error : null],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Fetch a single account by id, scoped by user. Used by the rescan endpoint
 * to confirm ownership before kicking off a background task.
 */
export async function getAccountForUser(
  userId: string,
  accountId: string,
): Promise<AccountRow | null> {
  const { rows } = await pool.query<AccountRow>(
    `SELECT id, user_id, friendly_name, account_sid, auth_mode, is_subaccount, parent_account_id, created_at, last_used_at, scan_status, scan_error
       FROM twilio_accounts
      WHERE id = $1 AND user_id = $2`,
    [accountId, userId],
  );
  return rows[0] ?? null;
}
