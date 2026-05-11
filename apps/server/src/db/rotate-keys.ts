import "dotenv/config";
import { pool } from "./pool.js";
import { currentKeyVersion, loadedKeyVersions, open, seal } from "../crypto.js";

/**
 * Walk every twilio_accounts row whose key_version is not the current one,
 * decrypt with its old key, re-seal with the current key, and UPDATE.
 *
 * Requirements before running:
 *   1. Both the old and new keys are present in env (APP_SECRET_KEY_V{old,new}).
 *   2. APP_SECRET_KEY_CURRENT points at the new version (or it's implicitly
 *      the highest V{N}).
 *   3. No running server — the CLI uses pool.query which will fight the server
 *      over the same connections. Stop dev first, or run during a maintenance
 *      window.
 *
 * Safety:
 *   - Transactional per row. A mid-run crash leaves earlier rows on the new
 *     key and later rows on the old; both are still decryptable as long as
 *     both keys remain in env. Re-running picks up where we left off.
 *   - No drop or truncate of anything. Only UPDATE.
 *   - Prints a progress line per row with the account id, old → new version.
 */
async function main() {
  const current = currentKeyVersion();
  const loaded = loadedKeyVersions();
  console.log(`[rotate] loaded key versions: ${loaded.join(", ")}`);
  console.log(`[rotate] current (target) version: ${current}`);

  const { rows } = await pool.query<{
    id: string;
    key_version: number;
    credentials_ct: Buffer;
    iv: Buffer;
    tag: Buffer;
  }>(
    `SELECT id, key_version, credentials_ct, iv, tag
       FROM twilio_accounts
      WHERE key_version <> $1
      ORDER BY created_at ASC`,
    [current],
  );

  if (rows.length === 0) {
    console.log("[rotate] nothing to do — all rows already on the current key version.");
    await pool.end();
    return;
  }

  console.log(`[rotate] ${rows.length} row(s) to re-seal.`);

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const plaintext = open({
        ct: row.credentials_ct,
        iv: row.iv,
        tag: row.tag,
        keyVersion: row.key_version,
      });
      const { ct, iv, tag, keyVersion } = seal(plaintext);
      await pool.query(
        `UPDATE twilio_accounts
            SET credentials_ct = $1, iv = $2, tag = $3, key_version = $4
          WHERE id = $5`,
        [ct, iv, tag, keyVersion, row.id],
      );
      console.log(`[rotate] ${row.id}: v${row.key_version} → v${keyVersion}`);
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[rotate] ${row.id}: FAILED — ${msg}`);
      failed++;
    }
  }

  console.log(`[rotate] done. re-sealed=${ok}  failed=${failed}`);
  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[rotate] fatal:", err);
  pool.end().finally(() => process.exit(1));
});
