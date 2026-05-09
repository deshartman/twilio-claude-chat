export type Me = { id: string; email: string };

async function jsonReq<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
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
};

export type AccountPublic = {
  id: string;
  friendly_name: string;
  account_sid: string;
  is_subaccount: boolean;
  parent_account_id: string | null;
  created_at: string;
  last_used_at: string | null;
};

export type NewAccountInput = {
  friendly_name: string;
  account_sid: string;
  api_key_sid: string;
  api_key_secret: string;
  is_subaccount?: boolean;
  parent_account_id?: string;
};

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
