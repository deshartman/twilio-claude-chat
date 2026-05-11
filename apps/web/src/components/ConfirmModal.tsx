import { Button } from "./ui/Button.tsx";

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
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-2xl border border-slate-200 w-[520px] max-w-[95vw] overflow-hidden">
        <div className="px-5 pt-5 pb-4 border-b border-slate-200">
          <div className="text-[11px] uppercase tracking-wide text-red-700 font-semibold">
            Confirm write
          </div>
          <h2 className="text-base font-semibold text-slate-900 mt-1 font-mono">{short}</h2>
          <p className="text-sm text-slate-600 mt-1">{req.summary}</p>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
            Input payload
          </div>
          <pre className="bg-slate-50 border border-slate-200 rounded-md p-3 text-xs font-mono text-slate-800 overflow-auto max-h-48 whitespace-pre-wrap break-all">
            {JSON.stringify(req.tool_input, null, 2)}
          </pre>
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onDecide(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onDecide(true)}>
            Run
          </Button>
        </div>
      </div>
    </div>
  );
}
