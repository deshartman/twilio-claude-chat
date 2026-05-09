import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, type AccountPublic, type Me } from "./lib/api.ts";
import { useChatSession, type ChatSession } from "./lib/useChatSession.ts";

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
  const nav = useNavigate();
  const loc = useLocation();
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
      return accounts.length === 1 ? accounts[0].id : null;
    });
  }

  useEffect(() => {
    if (me) refreshAccounts();
  }, [me]);

  if (loading) {
    return <div className="p-8 text-slate-500">Loading…</div>;
  }
  if (!me) return null;

  const tabCls = (active: boolean) =>
    `px-3 py-1.5 rounded text-sm ${
      active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-200"
    }`;

  const ctx: AppContext = {
    me,
    accounts,
    activeAccountId,
    setActiveAccountId,
    refreshAccounts,
    chat,
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 py-2 border-b bg-white">
        <div className="flex items-center gap-3">
          <span className="font-semibold">Twilio Console Chat</span>
          <nav className="flex gap-1">
            <Link to="/chat" className={tabCls(loc.pathname.startsWith("/chat"))}>
              Chat
            </Link>
            <Link to="/accounts" className={tabCls(loc.pathname.startsWith("/accounts"))}>
              Accounts
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500">{me.email}</span>
          <button
            className="text-slate-600 hover:text-slate-900"
            onClick={async () => {
              await api.logout();
              chat.reset();
              nav("/login");
            }}
          >
            Log out
          </button>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-hidden">
        <Outlet context={ctx} />
      </main>
    </div>
  );
}
