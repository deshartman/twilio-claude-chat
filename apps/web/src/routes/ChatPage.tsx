import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ChatPane } from "../components/ChatPane.tsx";
import { ArtifactPane } from "../components/ArtifactPane.tsx";
import { SessionsSidebar } from "../components/SessionsSidebar.tsx";
import type { AppContext } from "../App.tsx";

export function ChatPage() {
  const { accounts, activeAccountId, setActiveAccountId, chat } = useOutletContext<AppContext>();
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const prevSessionId = useRef<string | null>(chat.currentSessionId);

  // When a session id first appears (null → id), a new session was just created
  // server-side. Bump the sidebar refresh key so the list picks it up.
  useEffect(() => {
    if (prevSessionId.current === null && chat.currentSessionId !== null) {
      setSidebarRefreshKey((k) => k + 1);
    }
    prevSessionId.current = chat.currentSessionId;
  }, [chat.currentSessionId]);

  return (
    <div className="h-full min-h-0 grid grid-cols-[auto_minmax(380px,1fr)_1.3fr] overflow-hidden">
      <SessionsSidebar
        currentSessionId={chat.currentSessionId}
        onLoadSession={chat.loadSession}
        onNewSession={chat.newSession}
        refreshKey={sidebarRefreshKey}
      />
      <div className="flex flex-col min-h-0 h-full border-r border-slate-200">
        {accounts.length > 1 && (
          <div className="px-5 py-2.5 border-b border-slate-200 bg-white text-sm flex items-center gap-2 shrink-0">
            <span className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
              Scope
            </span>
            <select
              className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
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
