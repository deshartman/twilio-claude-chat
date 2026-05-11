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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
