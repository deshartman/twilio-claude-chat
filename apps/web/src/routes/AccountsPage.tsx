import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api, type AccountPublic, type AuthMode, type NewAccountInput, type ScanStatus } from "../lib/api.ts";
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

function statusChipClass(s: ScanStatus): string {
  switch (s) {
    case "pending":
      return "bg-slate-100 text-slate-600 border-slate-200";
    case "running":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "ready":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "failed":
      return "bg-red-50 text-red-700 border-red-200";
  }
}

function StatusChip({ account }: { account: AccountPublic }) {
  const label = account.scan_status === "running" ? "scanning…" : account.scan_status;
  const title =
    account.scan_status === "failed" && account.scan_error
      ? account.scan_error
      : undefined;
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-wide border px-1.5 py-0.5 rounded ${statusChipClass(account.scan_status)}`}
      title={title}
    >
      {label}
    </span>
  );
}

export function AccountsPage() {
  const { accounts, refreshAccounts } = useOutletContext<AppContext>();
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [rescanning, setRescanning] = useState<Set<string>>(new Set());

  // Poll while any account is mid-scan. 2s cadence is quick enough to feel
  // responsive without hammering the API for the common idle case.
  const anyActive = accounts.some(
    (a) => a.scan_status === "pending" || a.scan_status === "running",
  );
  useEffect(() => {
    if (!anyActive) return;
    const id = setInterval(() => {
      void refreshAccounts();
    }, 2000);
    return () => clearInterval(id);
  }, [anyActive, refreshAccounts]);

  async function rescan(id: string) {
    setRescanning((prev) => new Set(prev).add(id));
    try {
      await api.rescanAccount(id);
      await refreshAccounts();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "rescan failed");
    } finally {
      setRescanning((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

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
            {accounts.map((a) => {
              const isScanning =
                a.scan_status === "pending" || a.scan_status === "running" || rescanning.has(a.id);
              return (
                <li key={a.id} className="flex items-center justify-between p-3">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      <span>{a.friendly_name}</span>
                      <StatusChip account={a} />
                    </div>
                    <div className="text-xs text-slate-500 font-mono">
                      {a.account_sid} · {a.auth_mode === "auth_token" ? "auth token" : "API key"}
                      {a.is_subaccount && " · subaccount"}
                    </div>
                    {a.scan_status === "failed" && a.scan_error && (
                      <div className="text-xs text-red-600 mt-1">{a.scan_error}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      className="text-slate-600 text-sm hover:underline disabled:opacity-40 disabled:no-underline"
                      onClick={() => rescan(a.id)}
                      disabled={isScanning}
                    >
                      {isScanning ? "Scanning…" : "Rescan"}
                    </button>
                    <button
                      className="text-red-600 text-sm hover:underline"
                      onClick={() => del(a.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
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
