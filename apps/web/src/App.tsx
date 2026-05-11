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
    `relative text-sm px-1 py-3 -mb-px transition-colors ${
      active
        ? "text-slate-900 border-b-2 border-red-600 font-semibold"
        : "text-slate-500 hover:text-slate-900 border-b-2 border-transparent"
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
    <div className="h-screen flex flex-col bg-slate-50">
      <header className="flex items-center justify-between px-6 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2 py-3">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-red-600 text-white text-xs font-bold leading-none">
              T
            </span>
            <span className="font-semibold text-slate-900 tracking-tight">
              Console Chat
            </span>
          </div>
          <nav className="flex gap-5 self-stretch">
            <Link to="/chat" className={tabCls(loc.pathname.startsWith("/chat"))}>
              Chat
            </Link>
            <Link to="/accounts" className={tabCls(loc.pathname.startsWith("/accounts"))}>
              Accounts
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-500">{me.email}</span>
          <button
            className="text-slate-500 hover:text-slate-900 text-sm"
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
