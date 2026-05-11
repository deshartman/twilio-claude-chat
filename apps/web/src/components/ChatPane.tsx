import { useMemo, useRef, useState } from "react";
import type { AccountPublic } from "../lib/api.ts";
import type { ChatMessage, ChatSession } from "../lib/useChatSession.ts";
import { ConfirmModal } from "./ConfirmModal.tsx";
import { Button } from "./ui/Button.tsx";

export function ChatPane({
  accounts: _accounts,
  activeAccountId,
  chat,
}: {
  accounts: AccountPublic[];
  activeAccountId: string | null;
  chat: ChatSession;
}) {
  const [input, setInput] = useState("");
  const { messages, busy, wsReady, confirmReq, sendUserMessage, decideConfirm } = chat;

  // ↑/↓ history cycling. `cursor === null` means "on the live draft"; any
  // number i points at userMessages[userMessages.length - 1 - i] (i=0 is newest).
  // The current draft is stashed when we first press ↑ so ↓ past newest restores it.
  const [cursor, setCursor] = useState<number | null>(null);
  const draftSnapshot = useRef<string>("");
  const userMessages = useMemo(
    () => messages.filter((m): m is Extract<ChatMessage, { kind: "user" }> => m.kind === "user"),
    [messages],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (userMessages.length === 0) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cursor === null) draftSnapshot.current = input;
      const next = cursor === null ? 0 : Math.min(cursor + 1, userMessages.length - 1);
      setCursor(next);
      setInput(userMessages[userMessages.length - 1 - next].text);
    } else if (e.key === "ArrowDown") {
      if (cursor === null) return; // already on the live draft — let default handler run
      e.preventDefault();
      if (cursor === 0) {
        setCursor(null);
        setInput(draftSnapshot.current);
      } else {
        const next = cursor - 1;
        setCursor(next);
        setInput(userMessages[userMessages.length - 1 - next].text);
      }
    }
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || busy || !wsReady) return;
    setInput("");
    setCursor(null);
    draftSnapshot.current = "";
    sendUserMessage(prompt, activeAccountId);
  }

  return (
    <div className="min-h-0 h-full flex flex-col bg-white">
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
          onChange={(e) => {
            setInput(e.target.value);
            // Typing means you're editing — leave history-cursor mode so ↓
            // doesn't overwrite your edit with a recalled message.
            if (cursor !== null) setCursor(null);
          }}
          onKeyDown={onKeyDown}
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
