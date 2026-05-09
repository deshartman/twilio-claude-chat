import twilio from "twilio";
import { loadCredentialsForAccount, matchAccountsByHint } from "../accounts/repo.js";
import type { AccountRow } from "../accounts/repo.js";

export type HintResolution =
  | { kind: "resolved"; account: AccountRow }
  | { kind: "ambiguous"; matches: AccountRow[] }
  | { kind: "not_found" };

/**
 * Resolve a free-form account hint ("main test", "ACabc123", partial friendly
 * name) against a specific user's accounts. Always scoped by userId — this is
 * the multi-tenant isolation guarantee.
 */
export async function resolveAccountHint(
  userId: string,
  hint: string | null | undefined,
  activeAccountId: string | null,
): Promise<HintResolution> {
  if (hint) {
    const matches = await matchAccountsByHint(userId, hint);
    if (matches.length === 0) return { kind: "not_found" };
    if (matches.length === 1) return { kind: "resolved", account: matches[0] };
    return { kind: "ambiguous", matches };
  }
  if (activeAccountId) {
    const matches = await matchAccountsByHint(userId, "");
    const active = matches.find((a) => a.id === activeAccountId);
    if (active) return { kind: "resolved", account: active };
  }
  const all = await matchAccountsByHint(userId, "");
  if (all.length === 1) return { kind: "resolved", account: all[0] };
  if (all.length === 0) return { kind: "not_found" };
  return { kind: "ambiguous", matches: all };
}

/**
 * Build a short-lived Twilio client for a resolved account. Credentials are
 * decrypted in-memory only for the duration of this tool call; never cached.
 */
export async function buildTwilioClient(userId: string, accountId: string): Promise<twilio.Twilio> {
  const creds = await loadCredentialsForAccount(userId, accountId);
  if (!creds) throw new Error(`account not found or not owned by user`);
  return twilio(creds.api_key_sid, creds.api_key_secret, { accountSid: creds.account_sid });
}
