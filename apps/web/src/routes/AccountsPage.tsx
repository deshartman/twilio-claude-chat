import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api, type AuthMode, type NewAccountInput } from "../lib/api.ts";
import type { AppContext } from "../App.tsx";

type FormState = {
  friendly_name: string;
  account_sid: string;
  is_subaccount: boolean;
  auth_mode: AuthMode;
  api_key_sid: string;
  api_key_secret: string;
  auth_token: string;
};

const emptyForm: FormState = {
  friendly_name: "",
  account_sid: "",
  is_subaccount: false,
  auth_mode: "api_key",
  api_key_sid: "",
  api_key_secret: "",
  auth_token: "",
};

export function AccountsPage() {
  const { accounts, refreshAccounts } = useOutletContext<AppContext>();
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload: NewAccountInput =
        form.auth_mode === "api_key"
          ? {
              friendly_name: form.friendly_name,
              account_sid: form.account_sid,
              is_subaccount: form.is_subaccount,
              auth_mode: "api_key",
              api_key_sid: form.api_key_sid,
              api_key_secret: form.api_key_secret,
            }
          : {
              friendly_name: form.friendly_name,
              account_sid: form.account_sid,
              is_subaccount: form.is_subaccount,
              auth_mode: "auth_token",
              auth_token: form.auth_token,
            };
      await api.createAccount(payload);
      setForm(emptyForm);
      await refreshAccounts();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (!confirm("Delete this account? This removes encrypted credentials from the app, not from Twilio.")) return;
    await api.deleteAccount(id);
    await refreshAccounts();
  }

  const inputCls = "w-full border rounded px-2 py-1 text-sm font-mono";

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 overflow-auto h-full">
      <section>
        <h2 className="text-lg font-semibold mb-3">Configured accounts</h2>
        {accounts.length === 0 ? (
          <p className="text-slate-500 text-sm">None yet. Add one below.</p>
        ) : (
          <ul className="divide-y border rounded bg-white">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between p-3">
                <div>
                  <div className="font-medium">{a.friendly_name}</div>
                  <div className="text-xs text-slate-500 font-mono">
                    {a.account_sid} · {a.auth_mode === "auth_token" ? "auth token" : "API key"}
                    {a.is_subaccount && " · subaccount"}
                  </div>
                </div>
                <button
                  className="text-red-600 text-sm hover:underline"
                  onClick={() => del(a.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Add account</h2>
        <form onSubmit={submit} className="bg-white p-4 rounded border space-y-3">
          <label className="block">
            <span className="text-sm text-slate-600">Friendly name</span>
            <input
              className={inputCls}
              value={form.friendly_name}
              onChange={(e) => setForm({ ...form, friendly_name: e.target.value })}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-600">Account SID (AC…)</span>
            <input
              className={inputCls}
              value={form.account_sid}
              onChange={(e) => setForm({ ...form, account_sid: e.target.value })}
              pattern="AC[0-9a-fA-F]{32}"
              required
            />
          </label>
          <fieldset className="border rounded p-3 space-y-2">
            <legend className="text-sm text-slate-600 px-1">Authentication</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="auth_mode"
                checked={form.auth_mode === "api_key"}
                onChange={() => setForm({ ...form, auth_mode: "api_key" })}
              />
              <span>API Key (SK… + secret) — recommended</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="auth_mode"
                checked={form.auth_mode === "auth_token"}
                onChange={() => setForm({ ...form, auth_mode: "auth_token" })}
              />
              <span>Account SID + Auth Token</span>
            </label>
          </fieldset>
          {form.auth_mode === "api_key" ? (
            <>
              <label className="block">
                <span className="text-sm text-slate-600">API Key SID (SK…)</span>
                <input
                  className={inputCls}
                  value={form.api_key_sid}
                  onChange={(e) => setForm({ ...form, api_key_sid: e.target.value })}
                  pattern="SK[0-9a-fA-F]{32}"
                  required
                />
              </label>
              <label className="block">
                <span className="text-sm text-slate-600">API Key Secret</span>
                <input
                  type="password"
                  className={inputCls}
                  value={form.api_key_secret}
                  onChange={(e) => setForm({ ...form, api_key_secret: e.target.value })}
                  minLength={16}
                  required
                />
              </label>
            </>
          ) : (
            <label className="block">
              <span className="text-sm text-slate-600">Auth Token (32 hex chars)</span>
              <input
                type="password"
                className={inputCls}
                value={form.auth_token}
                onChange={(e) => setForm({ ...form, auth_token: e.target.value })}
                pattern="[0-9a-fA-F]{32}"
                required
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.is_subaccount}
              onChange={(e) => setForm({ ...form, is_subaccount: e.target.checked })}
            />
            This is a subaccount
          </label>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="bg-slate-900 text-white rounded px-4 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? "…" : "Add account"}
          </button>
        </form>
      </section>
    </div>
  );
}
