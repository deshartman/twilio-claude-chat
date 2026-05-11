import { useState } from "react";
import type { AccountPublic } from "../lib/api.ts";
import type { ChatMessage, ChatSession } from "../lib/useChatSession.ts";
import { ConfirmModal } from "./ConfirmModal.tsx";
import { Button } from "./ui/Button.tsx";

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

  const activeName =
    accounts.find((a) => a.id === activeAccountId)?.friendly_name ?? "— (auto)";

  return (
    <div className="min-h-0 h-full flex flex-col bg-white">
      <header className="px-5 py-3 border-b border-slate-200 flex items-center gap-3 text-sm shrink-0">
        <span className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
          Active
        </span>
        <span className="font-medium text-slate-900">{activeName}</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              wsReady ? "bg-emerald-500" : "bg-slate-300"
            }`}
          />
          {wsReady ? "connected" : "connecting…"}
        </span>
      </header>
      <div className="flex-1 min-h-0 overflow-auto px-6 py-5 space-y-4">
        {messages.length === 0 && (
          <div className="max-w-md mx-auto text-center pt-16">
            <p className="text-slate-900 font-medium">Ask about your Twilio estate.</p>
            <p className="text-sm text-slate-500 mt-1">
              Try: <span className="font-mono text-slate-700">list my phone numbers</span>
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageRow key={i} m={m} />
        ))}
      </div>
      <form onSubmit={send} className="px-5 py-3 border-t border-slate-200 flex gap-2 shrink-0 bg-white">
        <input
          className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? "thinking…" : wsReady ? "Type a message" : "connecting…"}
          disabled={busy || !wsReady}
        />
        <Button type="submit" disabled={busy || !input.trim() || !wsReady}>
          Send
        </Button>
      </form>
      {confirmReq && <ConfirmModal req={confirmReq} onDecide={decideConfirm} />}
    </div>
  );
}

function MessageRow({ m }: { m: ChatMessage }) {
  if (m.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-slate-900 text-white rounded-lg rounded-br-sm px-3.5 py-2 text-sm max-w-[80%] whitespace-pre-wrap">
          {m.text}
        </div>
      </div>
    );
  }
  if (m.kind === "assistant") {
    return (
      <div className="text-sm text-slate-900 leading-relaxed max-w-[80%] whitespace-pre-wrap break-words overflow-x-auto">
        {m.text}
      </div>
    );
  }
  if (m.kind === "tool_use") {
    return (
      <div className="text-xs text-slate-500 font-mono border-l-2 border-slate-200 pl-3 py-0.5">
        <span className="text-slate-400">→</span> {m.tool_name}
        <span className="text-slate-400">({Object.keys(m.input).length > 0 ? "…" : ""})</span>
      </div>
    );
  }
  return (
    <div className="text-xs text-slate-500 font-mono border-l-2 border-red-300 pl-3 py-0.5 truncate">
      <span className="text-slate-400">←</span> {m.text.split("\n")[0].slice(0, 100)}
    </div>
  );
}
