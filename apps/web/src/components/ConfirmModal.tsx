export type ConfirmRequest = {
  confirm_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  summary: string;
};

export function ConfirmModal({
  req,
  onDecide,
}: {
  req: ConfirmRequest;
  onDecide: (allow: boolean) => void;
}) {
  const short = req.tool_name.replace(/^mcp__twilio-ops__/, "");
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[520px] max-w-[95vw] p-5 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-amber-600 font-semibold">
            Confirm write
          </div>
          <h2 className="text-lg font-semibold mt-1">{short}</h2>
          <p className="text-sm text-slate-600 mt-1">{req.summary}</p>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">Input payload</div>
          <pre className="bg-slate-50 border rounded p-2 text-xs font-mono overflow-auto max-h-48 whitespace-pre-wrap break-all">
            {JSON.stringify(req.tool_input, null, 2)}
          </pre>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => onDecide(false)}
            className="px-3 py-1.5 rounded border text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onDecide(true)}
            className="px-3 py-1.5 rounded bg-amber-600 text-white text-sm hover:bg-amber-700"
          >
            Run
          </button>
        </div>
      </div>
    </div>
  );
}
