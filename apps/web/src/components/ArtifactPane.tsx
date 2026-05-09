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
      <div className="h-full flex items-center justify-center text-slate-400 text-sm">
        Tool results will appear here.
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
    <div className="p-4 space-y-3 overflow-auto h-full">
      <div className="text-sm text-slate-500">
        {data.count} number{data.count === 1 ? "" : "s"} in{" "}
        <span className="font-medium">{data.account.friendly_name}</span>
      </div>
      <table className="w-full text-sm border-collapse">
        <thead className="bg-slate-100 text-left">
          <tr>
            <th className="p-2">Number</th>
            <th className="p-2">Friendly name</th>
            <th className="p-2">Voice URL</th>
            <th className="p-2">SMS URL</th>
            <th className="p-2">Caps</th>
          </tr>
        </thead>
        <tbody>
          {data.numbers.map((n) => (
            <tr key={n.sid} className="border-t">
              <td className="p-2 font-mono">{n.phone_number}</td>
              <td className="p-2">{n.friendly_name}</td>
              <td className="p-2 font-mono text-xs truncate max-w-[16ch]">{n.voice_url ?? "—"}</td>
              <td className="p-2 font-mono text-xs truncate max-w-[16ch]">{n.sms_url ?? "—"}</td>
              <td className="p-2 text-xs">
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
  );
}

function PrettyJson({ value }: { value: unknown }) {
  return (
    <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all overflow-auto h-full bg-slate-50">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}
