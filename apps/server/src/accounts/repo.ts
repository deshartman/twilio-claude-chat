import { pool } from "../db/pool.js";
import { open, seal } from "../crypto.js";

export type AuthMode = "api_key" | "auth_token";

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
  const { ct, iv, tag } = seal(packCredentials(input));
  const { rows } = await pool.query<AccountRow>(
    `INSERT INTO twilio_accounts
       (user_id, friendly_name, account_sid, auth_mode, is_subaccount, parent_account_id, credentials_ct, iv, tag)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, user_id, friendly_name, account_sid, auth_mode, is_subaccount, parent_account_id, created_at, last_used_at`,
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
    ],
  );
  return rows[0];
}

export async function listAccountsForUser(userId: string): Promise<AccountRow[]> {
  const { rows } = await pool.query<AccountRow>(
    `SELECT id, user_id, friendly_name, account_sid, auth_mode, is_subaccount, parent_account_id, created_at, last_used_at
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
  }>(
    `SELECT account_sid, credentials_ct, iv, tag
       FROM twilio_accounts
      WHERE id = $1 AND user_id = $2`,
    [accountId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  const packed = unpackCredentials(open({ ct: row.credentials_ct, iv: row.iv, tag: row.tag }));
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
    `SELECT id, user_id, friendly_name, account_sid, auth_mode, is_subaccount, parent_account_id, created_at, last_used_at
       FROM twilio_accounts
      WHERE user_id = $1
        AND (friendly_name ILIKE $2 OR account_sid ILIKE $2)
      ORDER BY created_at ASC`,
    [userId, `%${hint}%`],
  );
  return rows;
}
