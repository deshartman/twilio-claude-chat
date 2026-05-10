import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfirmRequest } from "../components/ConfirmModal.tsx";
import { api, type ChatMessagePublic } from "./api.ts";

export type ChatMessage =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool_use"; tool_name: string; input: Record<string, unknown>; id: string }
  | { kind: "tool_result"; tool_use_id: string; text: string };

export type ChatArtifact = { tool_name: string; text: string };

export type ChatSession = {
  currentSessionId: string | null;
  messages: ChatMessage[];
  artifact: ChatArtifact | null;
  confirmReq: ConfirmRequest | null;
  busy: boolean;
  wsReady: boolean;
  sendUserMessage: (prompt: string, activeAccountId: string | null) => void;
  decideConfirm: (allow: boolean) => void;
  loadSession: (id: string) => Promise<void>;
  newSession: () => void;
  reset: () => void;
};

function shortName(n: string) {
  return n.replace(/^mcp__twilio-ops__/, "").replace(/^mcp__twilio-docs__/, "docs:");
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((x) => (typeof x === "object" && x && "text" in x ? String((x as { text: unknown }).text) : ""))
      .join("");
  }
  return JSON.stringify(content);
}

/**
 * Single chat session, owned at the App level. WebSocket lives here too, so
 * tab navigation within the app doesn't drop the connection or history.
 * Page refresh or tab close resets everything — intentional, matches the
 * plan decision to not persist chat across sessions.
 */
function rehydrateMessage(row: ChatMessagePublic): ChatMessage | null {
  const p = row.payload;
  switch (row.kind) {
    case "user":
      return { kind: "user", text: String(p.text ?? "") };
    case "assistant":
      return { kind: "assistant", text: String(p.text ?? "") };
    case "tool_use":
      return {
        kind: "tool_use",
        tool_name: String(p.tool_name ?? "").replace(/^mcp__twilio-ops__/, "").replace(/^mcp__twilio-docs__/, "docs:"),
        input: (p.input ?? {}) as Record<string, unknown>,
        id: String(p.id ?? ""),
      };
    case "tool_result":
      return {
        kind: "tool_result",
        tool_use_id: String(p.tool_use_id ?? ""),
        text: extractText(p.content),
      };
  }
}

export function useChatSession(): ChatSession {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [artifact, setArtifact] = useState<ChatArtifact | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [wsReady, setWsReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const toolUseById = useRef<Map<string, string>>(new Map());
  // Session id lives in a ref in parallel to state so the WS onmessage handler
  // (which captures state at WS-setup time) always sees the current value
  // without re-subscribing the socket.
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/chat`);
    wsRef.current = ws;
    ws.onopen = () => setWsReady(true);
    ws.onclose = () => setWsReady(false);
    ws.onerror = () => setWsReady(false);
    ws.onmessage = (e) => {
      let obj: any;
      try {
        obj = JSON.parse(e.data);
      } catch {
        return;
      }
      handleServerEvent(obj);
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  function handleServerEvent(ev: any) {
    if (ev.type === "session_created") {
      sessionIdRef.current = ev.chat_session_id;
      setCurrentSessionId(ev.chat_session_id);
      return;
    }
    if (ev.type === "confirm_request") {
      setConfirmReq(ev);
      return;
    }
    if (ev.type === "turn_complete" || ev.type === "result") {
      setBusy(false);
      return;
    }
    if (ev.type === "error") {
      setMessages((m) => [...m, { kind: "assistant", text: `[error] ${ev.message}` }]);
      setBusy(false);
      return;
    }
    if (ev.type === "assistant" && ev.message?.content) {
      for (const c of ev.message.content) {
        if (c.type === "text" && c.text) {
          setMessages((m) => [...m, { kind: "assistant", text: c.text }]);
        } else if (c.type === "tool_use") {
          toolUseById.current.set(c.id, shortName(c.name));
          setMessages((m) => [
            ...m,
            { kind: "tool_use", tool_name: shortName(c.name), input: c.input, id: c.id },
          ]);
        }
      }
      return;
    }
    if (ev.type === "user" && ev.message?.content) {
      for (const c of ev.message.content) {
        if (c.type === "tool_result") {
          const text = extractText(c.content);
          setMessages((m) => [...m, { kind: "tool_result", tool_use_id: c.tool_use_id, text }]);
          const name = toolUseById.current.get(c.tool_use_id) ?? "result";
          setArtifact({ tool_name: name, text });
        }
      }
      return;
    }
  }

  function sendUserMessage(prompt: string, activeAccountId: string | null) {
    const ws = wsRef.current;
    if (!prompt || busy || !ws || ws.readyState !== WebSocket.OPEN) return;
    setMessages((m) => [...m, { kind: "user", text: prompt }]);
    setBusy(true);
    ws.send(
      JSON.stringify({
        type: "user_message",
        prompt,
        active_twilio_account_id: activeAccountId,
        chat_session_id: sessionIdRef.current,
      }),
    );
  }

  async function loadSession(id: string) {
    const { session, messages: rows } = await api.getChatSession(id);
    sessionIdRef.current = session.id;
    setCurrentSessionId(session.id);
    const rehydrated = rows
      .map(rehydrateMessage)
      .filter((m): m is ChatMessage => m !== null);
    setMessages(rehydrated);
    // Surface the last tool result as the right-pane artifact, mirroring
    // live-turn behavior.
    const lastResult = [...rehydrated].reverse().find((m) => m.kind === "tool_result");
    if (lastResult && lastResult.kind === "tool_result") {
      setArtifact({
        tool_name: toolUseById.current.get(lastResult.tool_use_id) ?? "result",
        text: lastResult.text,
      });
    } else {
      setArtifact(null);
    }
    setConfirmReq(null);
  }

  function newSession() {
    sessionIdRef.current = null;
    setCurrentSessionId(null);
    setMessages([]);
    setArtifact(null);
    setConfirmReq(null);
    toolUseById.current.clear();
  }

  function decideConfirm(allow: boolean) {
    if (!confirmReq) return;
    wsRef.current?.send(
      JSON.stringify({ type: "confirm_response", confirm_id: confirmReq.confirm_id, allow }),
    );
    setConfirmReq(null);
  }

  return {
    currentSessionId,
    messages,
    artifact,
    confirmReq,
    busy,
    wsReady,
    sendUserMessage,
    decideConfirm,
    loadSession,
    newSession,
    reset: newSession,
  };
}
