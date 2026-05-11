import { useEffect, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { api, type AccountPublic, type Me } from "./lib/api.ts";
import { useChatSession, type ChatSession } from "./lib/useChatSession.ts";
import { SessionsSidebar } from "./components/SessionsSidebar.tsx";

export type AppContext = {
  me: Me;
  accounts: AccountPublic[];
  activeAccountId: string | null;
  setActiveAccountId: (id: string | null) => void;
  refreshAccounts: () => Promise<void>;
  chat: ChatSession;
};

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const nav = useNavigate();
  const chat = useChatSession();

  useEffect(() => {
    api
      .me()
      .then((r) => setMe(r.user))
      .catch(() => nav("/login", { replace: true }))
      .finally(() => setLoading(false));
  }, [nav]);

  async function refreshAccounts() {
    const { accounts } = await api.listAccounts();
    setAccounts(accounts);
    setActiveAccountId((prev) => {
      if (prev && accounts.some((a) => a.id === prev)) return prev;
      return accounts.length >= 1 ? accounts[0].id : null;
    });
  }

  useEffect(() => {
    if (me) refreshAccounts();
  }, [me]);

  // Bump sidebar refreshKey when a new session is created (null → id) and when
  // any assistant turn produces a new message — the latter catches the
  // auto-title backfill that lands after the first user turn completes.
  const prevSessionId = useRef<string | null>(chat.currentSessionId);
  const prevMsgCount = useRef<number>(chat.messages.length);
  useEffect(() => {
    let bump = false;
    if (prevSessionId.current === null && chat.currentSessionId !== null) bump = true;
    if (chat.messages.length !== prevMsgCount.current) bump = true;
    prevSessionId.current = chat.currentSessionId;
    prevMsgCount.current = chat.messages.length;
    if (bump) setSidebarRefreshKey((k) => k + 1);
  }, [chat.currentSessionId, chat.messages.length]);

  if (loading) {
    return <div className="p-8 text-slate-500 dark:text-slate-400">Loading…</div>;
  }
  if (!me) return null;

  const ctx: AppContext = {
    me,
    accounts,
    activeAccountId,
    setActiveAccountId,
    refreshAccounts,
    chat,
  };

  async function handleLogout() {
    await api.logout();
    chat.reset();
    nav("/login");
  }

  return (
    <div className="h-screen flex bg-slate-50 overflow-hidden dark:bg-slate-950">
      <SessionsSidebar
        me={me}
        currentSessionId={chat.currentSessionId}
        onLoadSession={chat.loadSession}
        onNewSession={chat.newSession}
        onLogout={handleLogout}
        refreshKey={sidebarRefreshKey}
      />
      <main className="flex-1 min-h-0 overflow-hidden">
        <Outlet context={ctx} />
      </main>
    </div>
  );
}
