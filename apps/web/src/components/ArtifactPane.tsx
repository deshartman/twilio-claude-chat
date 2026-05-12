import { useMemo } from "react";

/**
 * Routes a tool result's JSON text to a dedicated renderer when we recognize
 * the shape, falling back to a collapsible JSON viewer. This is the step-4
 * minimum: phone-number list + raw JSON fallback. More shapes get added as
 * the read tool set grows in step 6.
 */
export function ArtifactPane({ toolName, text }: { toolName: string | null; text: string | null }) {
  const parsed = useMemo<unknown>(() => {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }, [text]);

  if (!text) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm gap-1 dark:text-slate-500">
        <span className="text-slate-600 font-medium dark:text-slate-300">Tool results</span>
        <span className="text-xs">will appear here as the agent runs tools.</span>
      </div>
    );
  }

  if (toolName === "list_phone_numbers" && isPhoneNumbersResult(parsed)) {
    return <PhoneNumbersTable data={parsed} />;
  }

  if (toolName === "list_regulatory_bundles" && isBundlesResult(parsed)) {
    return <BundlesTable data={parsed} />;
  }

  if (toolName === "list_addresses" && isAddressesResult(parsed)) {
    return <AddressesTable data={parsed} />;
  }

  if (toolName === "bulk_assign_bundle_to_numbers" && isBulkAssignResult(parsed)) {
    return <BulkAssignResultView data={parsed} />;
  }

  return <PrettyJson value={parsed ?? text} />;
}

type PhoneNumbersResult = {
  account: { friendly_name: string; account_sid: string };
  count: number;
  numbers: Array<{
    sid: string;
    phone_number: string;
    friendly_name: string;
    voice_url: string | null;
    sms_url: string | null;
    capabilities: Record<string, boolean>;
    bundle_sid: string | null;
    address_sid: string | null;
    address_requirements: string | null;
  }>;
};

function isPhoneNumbersResult(v: unknown): v is PhoneNumbersResult {
  return (
    typeof v === "object" &&
    v !== null &&
    "numbers" in v &&
    Array.isArray((v as { numbers: unknown }).numbers)
  );
}

function PhoneNumbersTable({ data }: { data: PhoneNumbersResult }) {
  return (
    <div className="p-5 space-y-4 overflow-auto h-full">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold dark:text-slate-400">
          Phone numbers
        </div>
        <div className="text-sm text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-slate-100">{data.count}</span> in{" "}
          <span className="font-medium text-slate-900 dark:text-slate-100">{data.account.friendly_name}</span>
        </div>
      </div>
      <div className="border border-slate-200 rounded-lg bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 font-semibold">Number</th>
              <th className="px-3 py-2 font-semibold">Friendly name</th>
              <th className="px-3 py-2 font-semibold">Voice URL</th>
              <th className="px-3 py-2 font-semibold">SMS URL</th>
              <th className="px-3 py-2 font-semibold">Caps</th>
              <th className="px-3 py-2 font-semibold">Bundle</th>
              <th className="px-3 py-2 font-semibold">Address</th>
            </tr>
          </thead>
          <tbody>
            {data.numbers.map((n) => (
              <tr key={n.sid} className="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                <td className="px-3 py-2 font-mono text-slate-900 dark:text-slate-100">{n.phone_number}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{n.friendly_name}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 truncate max-w-[16ch] dark:text-slate-400">
                  {n.voice_url ?? "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 truncate max-w-[16ch] dark:text-slate-400">
                  {n.sms_url ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                  {Object.entries(n.capabilities)
                    .filter(([, v]) => v)
                    .map(([k]) => k)
                    .join(", ")}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">
                  {n.bundle_sid ? `${n.bundle_sid.slice(0, 6)}…${n.bundle_sid.slice(-4)}` : "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">
                  {n.address_sid ? `${n.address_sid.slice(0, 6)}…${n.address_sid.slice(-4)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type BundlesResult = {
  account: { friendly_name: string; account_sid: string };
  count: number;
  bundles: Array<{
    sid: string;
    friendly_name: string | null;
    status: string;
    iso_country: string | null;
    number_type: string | null;
    end_user_type: string | null;
    valid_until: string | null;
    date_created: string | null;
  }>;
};

function isBundlesResult(v: unknown): v is BundlesResult {
  return (
    typeof v === "object" &&
    v !== null &&
    "bundles" in v &&
    Array.isArray((v as { bundles: unknown }).bundles)
  );
}

function BundlesTable({ data }: { data: BundlesResult }) {
  return (
    <div className="p-5 space-y-4 overflow-auto h-full">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold dark:text-slate-400">
          Regulatory bundles
        </div>
        <div className="text-sm text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-slate-100">{data.count}</span> in{" "}
          <span className="font-medium text-slate-900 dark:text-slate-100">{data.account.friendly_name}</span>
        </div>
      </div>
      <div className="border border-slate-200 rounded-lg bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 font-semibold">SID</th>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Country</th>
              <th className="px-3 py-2 font-semibold">Number type</th>
              <th className="px-3 py-2 font-semibold">End-user</th>
              <th className="px-3 py-2 font-semibold">Valid until</th>
            </tr>
          </thead>
          <tbody>
            {data.bundles.map((b) => (
              <tr key={b.sid} className="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{b.sid}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{b.friendly_name ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">{b.status}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{b.iso_country ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{b.number_type ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{b.end_user_type ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                  {b.valid_until ? new Date(b.valid_until).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type AddressesResult = {
  account: { friendly_name: string; account_sid: string };
  count: number;
  addresses: Array<{
    sid: string;
    friendly_name: string | null;
    customer_name: string | null;
    iso_country: string | null;
    city: string | null;
    region: string | null;
    postal_code: string | null;
    street: string | null;
  }>;
};

function isAddressesResult(v: unknown): v is AddressesResult {
  return (
    typeof v === "object" &&
    v !== null &&
    "addresses" in v &&
    Array.isArray((v as { addresses: unknown }).addresses)
  );
}

function AddressesTable({ data }: { data: AddressesResult }) {
  return (
    <div className="p-5 space-y-4 overflow-auto h-full">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold dark:text-slate-400">
          Addresses
        </div>
        <div className="text-sm text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-slate-100">{data.count}</span> in{" "}
          <span className="font-medium text-slate-900 dark:text-slate-100">{data.account.friendly_name}</span>
        </div>
      </div>
      <div className="border border-slate-200 rounded-lg bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 font-semibold">SID</th>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Customer</th>
              <th className="px-3 py-2 font-semibold">Country</th>
              <th className="px-3 py-2 font-semibold">City / Region</th>
              <th className="px-3 py-2 font-semibold">Street</th>
            </tr>
          </thead>
          <tbody>
            {data.addresses.map((a) => (
              <tr key={a.sid} className="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{a.sid}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{a.friendly_name ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{a.customer_name ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{a.iso_country ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                  {[a.city, a.region].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 truncate max-w-[28ch] dark:text-slate-400">{a.street ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type BulkAssignResult = {
  account: { friendly_name: string; account_sid: string };
  bundle_sid: string;
  address_sid: string | null;
  attempted: number;
  succeeded: number;
  failed: Array<{ sid: string; phone_number: string | null; error: string }>;
  unchanged: Array<{ sid: string; phone_number: string | null }>;
  updated: Array<{ sid: string; phone_number: string | null }>;
};

function isBulkAssignResult(v: unknown): v is BulkAssignResult {
  return (
    typeof v === "object" &&
    v !== null &&
    "bundle_sid" in v &&
    "attempted" in v &&
    "failed" in v &&
    Array.isArray((v as { failed: unknown }).failed)
  );
}

function BulkAssignResultView({ data }: { data: BulkAssignResult }) {
  const total = data.succeeded + data.failed.length + data.unchanged.length;
  return (
    <div className="p-5 space-y-4 overflow-auto h-full">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold dark:text-slate-400">
          Bundle assignment
        </div>
        <div className="text-sm text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-slate-100">{data.succeeded}</span> of{" "}
          <span className="font-medium text-slate-900 dark:text-slate-100">{total}</span> updated in{" "}
          <span className="font-medium text-slate-900 dark:text-slate-100">{data.account.friendly_name}</span>
        </div>
      </div>
      <div className="text-xs text-slate-500 space-y-1 dark:text-slate-400">
        <div>
          Bundle: <span className="font-mono text-slate-700 dark:text-slate-300">{data.bundle_sid}</span>
        </div>
        {data.address_sid && (
          <div>
            Address: <span className="font-mono text-slate-700 dark:text-slate-300">{data.address_sid}</span>
          </div>
        )}
      </div>

      {data.failed.length > 0 && (
        <div className="border border-rose-200 rounded-lg bg-rose-50 overflow-hidden dark:border-rose-900 dark:bg-rose-950/30">
          <div className="px-3 py-2 text-xs uppercase tracking-wide text-rose-700 font-semibold dark:text-rose-300">
            {data.failed.length} failed
          </div>
          <table className="w-full text-sm border-collapse">
            <thead className="bg-rose-100/60 text-left text-xs uppercase tracking-wide text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              <tr>
                <th className="px-3 py-2 font-semibold">Number</th>
                <th className="px-3 py-2 font-semibold">SID</th>
                <th className="px-3 py-2 font-semibold">Error</th>
              </tr>
            </thead>
            <tbody>
              {data.failed.map((f) => (
                <tr key={f.sid} className="border-t border-rose-200 dark:border-rose-900">
                  <td className="px-3 py-2 font-mono text-slate-900 dark:text-slate-100">{f.phone_number ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{f.sid}</td>
                  <td className="px-3 py-2 text-xs text-rose-800 dark:text-rose-300">{f.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.updated.length > 0 && (
        <details className="border border-slate-200 rounded-lg bg-white dark:border-slate-700 dark:bg-slate-900">
          <summary className="px-3 py-2 text-xs uppercase tracking-wide text-slate-600 font-semibold cursor-pointer dark:text-slate-300">
            {data.updated.length} updated
          </summary>
          <ul className="border-t border-slate-200 divide-y divide-slate-200 dark:border-slate-700 dark:divide-slate-700">
            {data.updated.map((u) => (
              <li key={u.sid} className="px-3 py-1.5 text-sm flex justify-between">
                <span className="font-mono text-slate-900 dark:text-slate-100">{u.phone_number ?? "—"}</span>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{u.sid}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {data.unchanged.length > 0 && (
        <details className="border border-slate-200 rounded-lg bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40">
          <summary className="px-3 py-2 text-xs uppercase tracking-wide text-slate-500 font-semibold cursor-pointer dark:text-slate-400">
            {data.unchanged.length} already had this bundle — skipped
          </summary>
          <ul className="border-t border-slate-200 divide-y divide-slate-200 dark:border-slate-700 dark:divide-slate-700">
            {data.unchanged.map((u) => (
              <li key={u.sid} className="px-3 py-1.5 text-sm flex justify-between">
                <span className="font-mono text-slate-700 dark:text-slate-300">{u.phone_number ?? "—"}</span>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{u.sid}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PrettyJson({ value }: { value: unknown }) {
  return (
    <pre className="p-5 text-xs font-mono text-slate-800 whitespace-pre-wrap break-all overflow-auto h-full bg-slate-50 dark:bg-slate-950 dark:text-slate-300">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}
