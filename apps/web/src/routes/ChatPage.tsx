import { useOutletContext } from "react-router-dom";
import { ChatPane } from "../components/ChatPane.tsx";
import { ArtifactPane } from "../components/ArtifactPane.tsx";
import type { AppContext } from "../App.tsx";

export function ChatPage() {
  const { accounts, activeAccountId, setActiveAccountId, chat } = useOutletContext<AppContext>();

  return (
    <div className="h-full min-h-0 grid grid-cols-[minmax(380px,1fr)_1.3fr] overflow-hidden">
      <div className="flex flex-col min-h-0 h-full">
        {accounts.length > 1 && (
          <div className="px-3 py-2 border-b bg-white text-sm flex items-center gap-2">
            <span className="text-slate-500">Scope:</span>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={activeAccountId ?? ""}
              onChange={(e) => setActiveAccountId(e.target.value || null)}
            >
              <option value="">— (let Claude ask)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.friendly_name}
                </option>
              ))}
            </select>
          </div>
        )}
        <ChatPane accounts={accounts} activeAccountId={activeAccountId} chat={chat} />
      </div>
      <div className="bg-slate-50 overflow-hidden">
        <ArtifactPane
          toolName={chat.artifact?.tool_name ?? null}
          text={chat.artifact?.text ?? null}
        />
      </div>
    </div>
  );
}
