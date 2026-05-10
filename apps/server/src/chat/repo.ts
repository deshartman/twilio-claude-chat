import { pool } from "../db/pool.js";

export type MessageKind = "user" | "assistant" | "tool_use" | "tool_result";

export type ChatSessionRow = {
  id: string;
  user_id: string;
  active_twilio_account_id: string | null;
  title: string | null;
  created_at: Date;
  updated_at: Date;
};

export type ChatMessageRow = {
  id: string;
  chat_session_id: string;
  seq: number;
  kind: MessageKind;
  payload: Record<string, unknown>;
  created_at: Date;
};

/**
 * Create a new chat session for the given user. Title is initially null —
 * it's backfilled from the first user message on the first persisted turn.
 */
export async function createChatSession(
  userId: string,
  activeTwilioAccountId: string | null,
): Promise<ChatSessionRow> {
  const { rows } = await pool.query<ChatSessionRow>(
    `INSERT INTO chat_sessions (user_id, active_twilio_account_id)
     VALUES ($1, $2)
     RETURNING id, user_id, active_twilio_account_id, title, created_at, updated_at`,
    [userId, activeTwilioAccountId],
  );
  return rows[0];
}

/**
 * Read a session only if it belongs to the user — returns null otherwise.
 * Same isolation pattern as account lookups: user_id is the security boundary.
 */
export async function getChatSession(
  userId: string,
  sessionId: string,
): Promise<ChatSessionRow | null> {
  const { rows } = await pool.query<ChatSessionRow>(
    `SELECT id, user_id, active_twilio_account_id, title, created_at, updated_at
       FROM chat_sessions
      WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  return rows[0] ?? null;
}

export async function listChatSessionsForUser(
  userId: string,
  limit = 50,
): Promise<ChatSessionRow[]> {
  const { rows } = await pool.query<ChatSessionRow>(
    `SELECT id, user_id, active_twilio_account_id, title, created_at, updated_at
       FROM chat_sessions
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

export async function deleteChatSession(userId: string, sessionId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Append a message and bump the session's updated_at. Runs in a single
 * transaction so the seq numbering can't race across concurrent inserts.
 * Caller must have already verified ownership via getChatSession.
 */
export async function appendChatMessage(
  sessionId: string,
  kind: MessageKind,
  payload: unknown,
): Promise<ChatMessageRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const nextSeq = await client.query<{ next_seq: number }>(
      `SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq
         FROM chat_messages
        WHERE chat_session_id = $1`,
      [sessionId],
    );
    const seq = nextSeq.rows[0].next_seq;
    const { rows } = await client.query<ChatMessageRow>(
      `INSERT INTO chat_messages (chat_session_id, seq, kind, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, chat_session_id, seq, kind, payload, created_at`,
      [sessionId, seq, kind, JSON.stringify(payload)],
    );
    await client.query(
      `UPDATE chat_sessions SET updated_at = now() WHERE id = $1`,
      [sessionId],
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * First-turn-only: set a session title from the opening user message.
 * We only set it when title IS NULL so subsequent user messages don't overwrite.
 */
export async function setTitleIfEmpty(sessionId: string, title: string): Promise<void> {
  const trimmed = title.trim().slice(0, 60);
  if (!trimmed) return;
  await pool.query(
    `UPDATE chat_sessions SET title = $2 WHERE id = $1 AND title IS NULL`,
    [sessionId, trimmed],
  );
}

export async function listChatMessages(sessionId: string): Promise<ChatMessageRow[]> {
  const { rows } = await pool.query<ChatMessageRow>(
    `SELECT id, chat_session_id, seq, kind, payload, created_at
       FROM chat_messages
      WHERE chat_session_id = $1
      ORDER BY seq ASC`,
    [sessionId],
  );
  return rows;
}
