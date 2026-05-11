import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ChatPane } from "../components/ChatPane.tsx";
import { ArtifactPane } from "../components/ArtifactPane.tsx";
import type { AppContext } from "../App.tsx";
import type { AccountPublic } from "../lib/api.ts";

const ARTIFACT_WIDTH_KEY = "artifactWidth";
const DEFAULT_ARTIFACT_WIDTH = 560;
const MIN_ARTIFACT_WIDTH = 320;
const CHAT_MIN_WIDTH = 380;
const HANDLE_WIDTH = 6;

/**
 * Clamp artifactWidth so the chat column never drops below its min and the
 * artifact column stays at least MIN_ARTIFACT_WIDTH. The sidebar width is
 * read off the actual DOM via the containing grid's width — we only see the
 * <main> width here, so the math is: mainWidth - handle - chatMin >= artifact.
 */
function clampArtifactWidth(w: number, mainWidth: number): number {
  const upper = Math.max(MIN_ARTIFACT_WIDTH, mainWidth - CHAT_MIN_WIDTH - HANDLE_WIDTH);
  return Math.max(MIN_ARTIFACT_WIDTH, Math.min(w, upper));
}

function loadInitialWidth(): number {
  const raw = localStorage.getItem(ARTIFACT_WIDTH_KEY);
  const n = raw ? Number(raw) : DEFAULT_ARTIFACT_WIDTH;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ARTIFACT_WIDTH;
}

/**
 * Sort accounts for the scope dropdown: last_used_at desc, null rows at the
 * bottom sorted alphabetically by friendly_name.
 */
function sortAccountsByLastUsed(accounts: AccountPublic[]): AccountPublic[] {
  return [...accounts].sort((a, b) => {
    const la = a.last_used_at;
    const lb = b.last_used_at;
    if (la && lb) return lb.localeCompare(la);
    if (la && !lb) return -1;
    if (!la && lb) return 1;
    return a.friendly_name.localeCompare(b.friendly_name);
  });
}

export function ChatPage() {
  const { accounts, activeAccountId, setActiveAccountId, chat } = useOutletContext<AppContext>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [artifactWidth, setArtifactWidth] = useState<number>(loadInitialWidth);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const sortedAccounts = useMemo(() => sortAccountsByLastUsed(accounts), [accounts]);
  const activeAccount =
    accounts.find((a) => a.id === activeAccountId) ?? sortedAccounts[0] ?? null;

  // Re-clamp on window resize so the panes don't overflow when the user
  // narrows the browser window.
  useEffect(() => {
    function onResize() {
      const el = containerRef.current;
      if (!el) return;
      setArtifactWidth((w) => clampArtifactWidth(w, el.clientWidth));
    }
    window.addEventListener("resize", onResize);
    // Clamp on mount too, in case localStorage has a value wider than this viewport.
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onHandleDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      dragState.current = { startX: e.clientX, startWidth: artifactWidth };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [artifactWidth],
  );

  const onHandleMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragState.current;
    const el = containerRef.current;
    if (!s || !el) return;
    // Dragging the handle LEFT grows the artifact; RIGHT shrinks it.
    const next = s.startWidth - (e.clientX - s.startX);
    setArtifactWidth(clampArtifactWidth(next, el.clientWidth));
  }, []);

  const onHandleUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
      dragState.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(ARTIFACT_WIDTH_KEY, String(Math.round(artifactWidth)));
    },
    [artifactWidth],
  );

  const gridStyle = {
    gridTemplateColumns: `minmax(${CHAT_MIN_WIDTH}px, 1fr) ${HANDLE_WIDTH}px ${artifactWidth}px`,
  };

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0 grid overflow-hidden"
      style={gridStyle}
    >
      <div className="flex flex-col min-h-0 h-full">
        {activeAccount || accounts.length > 1 ? (
          <div className="px-5 py-2.5 border-b border-slate-200 bg-white text-sm flex items-center gap-2 shrink-0 dark:border-slate-700 dark:bg-slate-900">
            <span className="text-xs uppercase tracking-wide text-slate-500 font-semibold dark:text-slate-400">
              Scope
            </span>
            {accounts.length > 1 ? (
              <select
                className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
                value={activeAccount?.id ?? ""}
                onChange={(e) => setActiveAccountId(e.target.value || null)}
              >
                {sortedAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.friendly_name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-medium text-slate-900 dark:text-slate-100">{activeAccount?.friendly_name}</span>
            )}
            <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  chat.wsReady ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
                }`}
              />
              {chat.wsReady ? "connected" : "connecting…"}
            </span>
          </div>
        ) : null}
        <ChatPane accounts={accounts} activeAccountId={activeAccount?.id ?? null} chat={chat} />
      </div>

      <div
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        className="cursor-col-resize bg-slate-200 hover:bg-red-300 transition-colors dark:bg-slate-700 dark:hover:bg-red-500"
        title="Drag to resize"
      />

      <div className="bg-slate-50 overflow-hidden min-w-0 dark:bg-slate-950">
        <ArtifactPane
          toolName={chat.artifact?.tool_name ?? null}
          text={chat.artifact?.text ?? null}
        />
      </div>
    </div>
  );
}
