import { useState } from "react";
import type { AccountPublic } from "../lib/api.ts";
import type { ChatMessage, ChatSession } from "../lib/useChatSession.ts";
import { ConfirmModal } from "./ConfirmModal.tsx";

export function ChatPane({
  accounts,
  activeAccountId,
  chat,
}: {
  accounts: AccountPublic[];
  activeAccountId: string | null;
  chat: ChatSession;
}) {
  const [input, setInput] = useState("");
  const { messages, busy, wsReady, confirmReq, sendUserMessage, decideConfirm } = chat;

  function send(e: React.FormEvent) {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || busy || !wsReady) return;
    setInput("");
    sendUserMessage(prompt, activeAccountId);
  }

  return (
    <div className="min-h-0 h-full flex flex-col bg-white border-r">
      <header className="p-3 border-b flex items-center gap-2 text-sm shrink-0">
        <span className="text-slate-500">Active account:</span>
        <span className="font-medium">
          {accounts.find((a) => a.id === activeAccountId)?.friendly_name ?? "— (auto)"}
        </span>
        <span className={`ml-auto text-xs ${wsReady ? "text-emerald-600" : "text-slate-400"}`}>
          {wsReady ? "connected" : "connecting…"}
        </span>
      </header>
      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-slate-400 text-sm">
            Ask about your Twilio estate. Example: "list my phone numbers".
          </p>
        )}
        {messages.map((m, i) => (
          <MessageRow key={i} m={m} />
        ))}
      </div>
      <form onSubmit={send} className="p-3 border-t flex gap-2 shrink-0">
        <input
          className="flex-1 border rounded px-3 py-2 text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? "thinking…" : wsReady ? "Type a message" : "connecting…"}
          disabled={busy || !wsReady}
        />
        <button
          type="submit"
          disabled={busy || !input.trim() || !wsReady}
          className="bg-slate-900 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {confirmReq && <ConfirmModal req={confirmReq} onDecide={decideConfirm} />}
    </div>
  );
}

function MessageRow({ m }: { m: ChatMessage }) {
  if (m.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-slate-900 text-white rounded px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap">
          {m.text}
        </div>
      </div>
    );
  }
  if (m.kind === "assistant") {
    return (
      <div className="bg-slate-100 rounded px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap break-words overflow-x-auto">
        {m.text}
      </div>
    );
  }
  if (m.kind === "tool_use") {
    return (
      <div className="text-xs text-slate-500 font-mono border-l-2 border-slate-300 pl-2">
        → {m.tool_name}({Object.keys(m.input).length > 0 ? "…" : ""})
      </div>
    );
  }
  return (
    <div className="text-xs text-slate-500 font-mono border-l-2 border-emerald-300 pl-2 truncate">
      ← {m.text.split("\n")[0].slice(0, 100)}
    </div>
  );
}
