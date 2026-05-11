import { useState } from "react";
import { api, type AccountPublic, type AuthMode, type UpdateAccountInput } from "../lib/api.ts";
import { Button } from "./ui/Button.tsx";

type Props = {
  account: AccountPublic;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

/**
 * Edit an existing Twilio account. Two distinct concerns:
 * - Rename (friendly_name) — low-risk cosmetic change.
 * - Rotate credentials — user rotated their Twilio API key and needs to
 *   update the stored secret. They can ALSO flip auth_mode while they're at
 *   it (e.g. moving from auth token to API key).
 *
 * account_sid is NOT editable — that would be a different Twilio account.
 * Delete + re-add is the right flow for that.
 */
export function EditAccountModal({ account, onClose, onSaved }: Props) {
  const [friendlyName, setFriendlyName] = useState(account.friendly_name);
  const [rotateCreds, setRotateCreds] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>(account.auth_mode);
  const [apiKeySid, setApiKeySid] = useState("");
  const [apiKeySecret, setApiKeySecret] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const patch: UpdateAccountInput = {};
      if (friendlyName.trim() !== account.friendly_name) {
        patch.friendly_name = friendlyName.trim();
      }
      if (rotateCreds) {
        patch.credentials =
          authMode === "api_key"
            ? { auth_mode: "api_key", api_key_sid: apiKeySid, api_key_secret: apiKeySecret }
            : { auth_mode: "auth_token", auth_token: authToken };
      }
      if (patch.friendly_name === undefined && patch.credentials === undefined) {
        setErr("Nothing to save.");
        setBusy(false);
        return;
      }
      await api.updateAccount(account.id, patch);
      await onSaved();
      onClose();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "update failed");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono " +
    "focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 " +
    "dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100";

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 backdrop-blur-sm dark:bg-slate-950/70">
      <form
        onSubmit={submit}
        className="bg-white rounded-lg shadow-2xl border border-slate-200 w-[520px] max-w-[95vw] overflow-hidden dark:bg-slate-900 dark:border-slate-700"
      >
        <div className="px-5 pt-5 pb-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Edit account</h2>
          <p className="text-sm text-slate-500 mt-0.5 font-mono dark:text-slate-400">{account.account_sid}</p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <label className="block">
            <span className="text-sm text-slate-700 dark:text-slate-300">Friendly name</span>
            <input
              className={inputCls}
              value={friendlyName}
              onChange={(e) => setFriendlyName(e.target.value)}
              required
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer dark:text-slate-300">
            <input
              type="checkbox"
              className="accent-red-600"
              checked={rotateCreds}
              onChange={(e) => setRotateCreds(e.target.checked)}
            />
            <span>Rotate credentials (the Twilio key changed upstream)</span>
          </label>

          {rotateCreds && (
            <div className="space-y-3 border border-slate-200 rounded-md p-3 dark:border-slate-700">
              <fieldset className="space-y-2">
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-600 px-0.5 dark:text-slate-400">
                  New authentication
                </legend>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="radio"
                    name="edit_auth_mode"
                    className="accent-red-600"
                    checked={authMode === "api_key"}
                    onChange={() => setAuthMode("api_key")}
                  />
                  <span>API Key (SK… + secret)</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="radio"
                    name="edit_auth_mode"
                    className="accent-red-600"
                    checked={authMode === "auth_token"}
                    onChange={() => setAuthMode("auth_token")}
                  />
                  <span>Account SID + Auth Token</span>
                </label>
              </fieldset>

              {authMode === "api_key" ? (
                <>
                  <label className="block">
                    <span className="text-sm text-slate-700 dark:text-slate-300">API Key SID (SK…)</span>
                    <input
                      className={inputCls}
                      value={apiKeySid}
                      onChange={(e) => setApiKeySid(e.target.value)}
                      pattern="SK[0-9a-fA-F]{32}"
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-slate-700 dark:text-slate-300">API Key Secret</span>
                    <input
                      type="password"
                      className={inputCls}
                      value={apiKeySecret}
                      onChange={(e) => setApiKeySecret(e.target.value)}
                      minLength={16}
                      required
                    />
                  </label>
                </>
              ) : (
                <label className="block">
                  <span className="text-sm text-slate-700 dark:text-slate-300">Auth Token (32 hex chars)</span>
                  <input
                    type="password"
                    className={inputCls}
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    pattern="[0-9a-fA-F]{32}"
                    required
                  />
                </label>
              )}
            </div>
          )}

          {err && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 dark:bg-red-900/30 dark:border-red-900/50 dark:text-red-300">
              {err}
            </p>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 dark:bg-slate-800/50 dark:border-slate-700">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "…" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}
