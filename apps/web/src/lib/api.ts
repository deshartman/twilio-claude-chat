export type Me = { id: string; email: string };

async function jsonReq<T>(path: string, init?: RequestInit): Promise<T> {
  // Only advertise application/json when there's actually a body — Fastify's
  // default parser rejects empty bodies with that content-type (400 EMPTY_JSON_BODY).
  const baseHeaders: Record<string, string> = init?.body
    ? { "Content-Type": "application/json" }
    : {};
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { ...baseHeaders, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => jsonReq<{ user: Me }>("/api/auth/me"),
  login: (email: string, password: string) =>
    jsonReq<{ user: Me }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  signup: (email: string, password: string) =>
    jsonReq<{ user: Me }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => jsonReq<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  listAccounts: () =>
    jsonReq<{ accounts: AccountPublic[] }>("/api/accounts"),
  createAccount: (input: NewAccountInput) =>
    jsonReq<{ account: AccountPublic }>("/api/accounts", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteAccount: (id: string) =>
    jsonReq<{ ok: true }>(`/api/accounts/${id}`, { method: "DELETE" }),
  rescanAccount: (id: string) =>
    jsonReq<{ ok: true; scan_status: ScanStatus }>(`/api/accounts/${id}/rescan`, {
      method: "POST",
    }),
  listChatSessions: () =>
    jsonReq<{ sessions: ChatSessionPublic[] }>("/api/chat/sessions"),
  getChatSession: (id: string) =>
    jsonReq<{ session: ChatSessionPublic; messages: ChatMessagePublic[] }>(
      `/api/chat/sessions/${id}`,
    ),
  deleteChatSession: (id: string) =>
    jsonReq<{ ok: true }>(`/api/chat/sessions/${id}`, { method: "DELETE" }),
};

export type ChatSessionPublic = {
  id: string;
  active_twilio_account_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageKind = "user" | "assistant" | "tool_use" | "tool_result";

export type ChatMessagePublic = {
  id: string;
  seq: number;
  kind: MessageKind;
  payload: Record<string, unknown>;
  created_at: string;
};

export type AuthMode = "api_key" | "auth_token";
export type ScanStatus = "pending" | "running" | "ready" | "failed";

export type AccountPublic = {
  id: string;
  friendly_name: string;
  account_sid: string;
  auth_mode: AuthMode;
  is_subaccount: boolean;
  parent_account_id: string | null;
  created_at: string;
  last_used_at: string | null;
  scan_status: ScanStatus;
  scan_error: string | null;
};

export type NewAccountInput = {
  friendly_name: string;
  account_sid: string;
  is_subaccount?: boolean;
  parent_account_id?: string;
} & (
  | { auth_mode: "api_key"; api_key_sid: string; api_key_secret: string }
  | { auth_mode: "auth_token"; auth_token: string }
);

export type TurnRequest = {
  chat_session_id: string | null;
  prompt: string;
  active_twilio_account_id: string | null;
};

/**
 * Stream an NDJSON turn. Yields each parsed object line-by-line.
 */
export async function* streamChatTurn(req: TurnRequest): AsyncGenerator<any> {
  const res = await fetch("/api/chat/turn", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok || !res.body) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // skip malformed line
      }
    }
  }
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer);
    } catch {}
  }
}
