import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, type ChatSessionPublic, type Me } from "../lib/api.ts";

type Props = {
  me: Me;
  currentSessionId: string | null;
  onLoadSession: (id: string) => Promise<void> | void;
  onNewSession: () => void;
  onLogout: () => void | Promise<void>;
  /** Bumped by parent when a new session is created or a turn completes. */
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
  me,
  currentSessionId,
  onLoadSession,
  onNewSession,
  onLogout,
  refreshKey,
}: Props) {
  const [sessions, setSessions] = useState<ChatSessionPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const loc = useLocation();
  const nav = useNavigate();

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

  async function handleLoadSession(id: string) {
    // From /accounts, state would change invisibly — navigate first so the
    // user sees the chat they just picked.
    if (!loc.pathname.startsWith("/chat")) nav("/chat");
    await onLoadSession(id);
  }

  function handleNewSession() {
    if (!loc.pathname.startsWith("/chat")) nav("/chat");
    onNewSession();
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => (s.title ?? "").toLowerCase().includes(q));
  }, [sessions, filter]);

  const onChat = loc.pathname.startsWith("/chat");
  const onAccounts = loc.pathname.startsWith("/accounts");

  const navCls = (active: boolean) =>
    `relative flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors ${
      active
        ? "bg-slate-100 text-slate-900 font-medium"
        : "text-slate-700 hover:bg-slate-50"
    }`;

  return (
    <aside className="flex flex-col h-full min-h-0 border-r border-slate-200 bg-white w-60 shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-red-600 text-white text-xs font-bold leading-none">
          T
        </span>
        <span className="font-semibold text-slate-900 tracking-tight">Twilio Chat</span>
      </div>

      {/* Primary actions + nav */}
      <nav className="px-2 py-2 flex flex-col gap-0.5">
        <button
          onClick={handleNewSession}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 rounded-md hover:bg-slate-50 transition-colors text-left"
        >
          <span className="text-slate-400 text-base leading-none">+</span>
          <span>New chat</span>
        </button>
        <Link to="/chat" className={navCls(onChat)}>
          {onChat && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-red-600" />
          )}
          <span>Chat</span>
        </Link>
        <Link to="/accounts" className={navCls(onAccounts)}>
          {onAccounts && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-red-600" />
          )}
          <span>Accounts</span>
        </Link>
      </nav>

      {/* Search */}
      <div className="px-3 pt-2 pb-2 border-t border-slate-200">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search chats"
          className="w-full text-sm border border-slate-300 rounded-md px-2.5 py-1.5 placeholder:text-slate-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
        />
      </div>

      {/* Recents */}
      <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Recents
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-3">
        {loading ? (
          <div className="px-3 py-2 text-xs text-slate-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-400">
            {filter.trim() ? "No matches." : "No chats yet."}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((s) => {
              const active = s.id === currentSessionId;
              return (
                <li
                  key={s.id}
                  onClick={() => void handleLoadSession(s.id)}
                  className={`group relative pl-4 pr-2 py-1.5 cursor-pointer text-sm flex items-start justify-between gap-2 transition-colors ${
                    active
                      ? "bg-slate-50 text-slate-900"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-red-600" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className={`truncate ${active ? "font-medium" : ""}`}>
                      {s.title ?? "(untitled)"}
                    </div>
                    <div className="text-xs text-slate-400">{relativeTime(s.updated_at)}</div>
                  </div>
                  <button
                    onClick={(e) => remove(s.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-xs text-slate-400 hover:text-red-600 px-1 transition-colors"
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

      {/* User chip */}
      <div className="border-t border-slate-200 px-3 py-2 flex items-center gap-2 shrink-0">
        <span
          className="flex-1 min-w-0 text-xs text-slate-600 truncate"
          title={me.email}
        >
          {me.email}
        </span>
        <button
          onClick={() => void onLogout()}
          className="text-xs text-slate-500 hover:text-red-700 transition-colors shrink-0"
          title="Log out"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
