import { useCallback, useEffect, useState } from "react";
import { api, type ChatSessionPublic } from "../lib/api.ts";

type Props = {
  currentSessionId: string | null;
  onLoadSession: (id: string) => Promise<void> | void;
  onNewSession: () => void;
  /** Bumped by parent when a new session is created to trigger a refresh. */
  refreshKey: number;
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const delta = (Date.now() - then) / 1000;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  if (delta < 7 * 86400) return `${Math.floor(delta / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function SessionsSidebar({
  currentSessionId,
  onLoadSession,
  onNewSession,
  refreshKey,
}: Props) {
  const [sessions, setSessions] = useState<ChatSessionPublic[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { sessions } = await api.listChatSessions();
      setSessions(sessions);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this chat? This cannot be undone.")) return;
    await api.deleteChatSession(id);
    if (id === currentSessionId) onNewSession();
    await refresh();
  }

  return (
    <aside className="flex flex-col h-full min-h-0 border-r bg-white w-60">
      <div className="p-2 border-b">
        <button
          onClick={onNewSession}
          className="w-full text-sm border rounded px-2 py-1.5 hover:bg-slate-50 text-slate-700"
        >
          + New chat
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="p-3 text-xs text-slate-400">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="p-3 text-xs text-slate-400">No chats yet.</div>
        ) : (
          <ul className="divide-y">
            {sessions.map((s) => {
              const active = s.id === currentSessionId;
              return (
                <li
                  key={s.id}
                  onClick={() => void onLoadSession(s.id)}
                  className={`group px-3 py-2 cursor-pointer text-sm flex items-start justify-between gap-2 ${
                    active ? "bg-slate-100" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{s.title ?? "(untitled)"}</div>
                    <div className="text-xs text-slate-400">{relativeTime(s.updated_at)}</div>
                  </div>
                  <button
                    onClick={(e) => remove(s.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-xs text-red-500 hover:text-red-700 px-1"
                    title="Delete"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
