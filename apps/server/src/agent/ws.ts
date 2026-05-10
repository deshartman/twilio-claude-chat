import type { FastifyInstance } from "fastify";
import { getUserFromRequest } from "../auth/session.js";
import { pool } from "../db/pool.js";
import { runTurn } from "./runner.js";
import { isReadTool } from "./permissions.js";
import {
  appendChatMessage,
  createChatSession,
  getChatSession,
  setTitleIfEmpty,
} from "../chat/repo.js";

type RawData = Buffer | ArrayBuffer | Buffer[];

function decodeRaw(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw);
  return raw.toString("utf8");
}

type ClientMsg =
  | {
      type: "user_message";
      prompt: string;
      active_twilio_account_id: string | null;
      /**
       * If present, server resumes an existing session (and verifies ownership).
       * If absent/null, server creates a new session and echoes session_created.
       */
      chat_session_id?: string | null;
    }
  | { type: "confirm_response"; confirm_id: string; allow: boolean };

export async function registerChatWs(app: FastifyInstance) {
  app.get("/ws/chat", { websocket: true }, async (socket, req) => {
    const user = await getUserFromRequest(req);
    if (!user) {
      socket.send(JSON.stringify({ type: "error", message: "unauthorized" }));
      socket.close(1008, "unauthorized");
      return;
    }

    const pendingConfirms = new Map<
      string,
      { resolve: (allow: boolean) => void; reject: (err: Error) => void }
    >();

    const send = (obj: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(obj));
    };

    let turnInFlight = false;

    socket.on("message", async (raw: RawData) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(decodeRaw(raw));
      } catch {
        send({ type: "error", message: "bad_json" });
        return;
      }

      if (msg.type === "confirm_response") {
        const pending = pendingConfirms.get(msg.confirm_id);
        if (pending) {
          pendingConfirms.delete(msg.confirm_id);
          pending.resolve(msg.allow);
        }
        return;
      }

      if (msg.type !== "user_message") {
        send({ type: "error", message: "unknown_type" });
        return;
      }

      if (turnInFlight) {
        send({ type: "error", message: "turn_in_flight" });
        return;
      }
      turnInFlight = true;

      await handleTurn(app, user.id, msg, send, pendingConfirms).catch((err) => {
        app.log.error({ err }, "ws turn failed");
        send({ type: "error", message: err instanceof Error ? err.message : "agent error" });
      });
      turnInFlight = false;
    });

    socket.on("close", () => {
      // Resolve any outstanding confirm prompts as denied so the agent loop
      // can unwind cleanly rather than hanging indefinitely.
      for (const p of pendingConfirms.values()) p.resolve(false);
      pendingConfirms.clear();
    });
  });
}

async function handleTurn(
  app: FastifyInstance,
  userId: string,
  msg: {
    prompt: string;
    active_twilio_account_id: string | null;
    chat_session_id?: string | null;
  },
  send: (obj: unknown) => void,
  pendingConfirms: Map<
    string,
    { resolve: (allow: boolean) => void; reject: (err: Error) => void }
  >,
) {
  // Resolve or create the chat session. Ownership is verified via user_id.
  let sessionId = msg.chat_session_id ?? null;
  if (sessionId) {
    const existing = await getChatSession(userId, sessionId);
    if (!existing) {
      // Silently create a new one rather than 404 — simpler UX than
      // surfacing a stale-id error to the tab. The client gets the id
      // back via session_created and relinks.
      sessionId = null;
    }
  }
  if (!sessionId) {
    const newSession = await createChatSession(userId, msg.active_twilio_account_id);
    sessionId = newSession.id;
    send({ type: "session_created", chat_session_id: sessionId });
  }

  // Persist the incoming user message. setTitleIfEmpty is a no-op after
  // the first turn — cheap enough to call every time.
  await appendChatMessage(sessionId, "user", { kind: "user", text: msg.prompt });
  await setTitleIfEmpty(sessionId, msg.prompt);

  // Audit entries keyed by tool_use_id (model-assigned). Each Twilio tool
  // call writes a row after the tool_result lands.
  const auditPending = new Map<
    string,
    { tool_name: string; input: Record<string, unknown>; confirmed: boolean; account_id: string | null }
  >();

  const turn = runTurn({
    userId,
    prompt: msg.prompt,
    activeAccountId: msg.active_twilio_account_id,
    confirmDelegate: async ({ confirm_id, tool_name, tool_input, summary }) => {
      send({ type: "confirm_request", confirm_id, tool_name, tool_input, summary });
      return new Promise<boolean>((resolve, reject) => {
        pendingConfirms.set(confirm_id, { resolve, reject });
      });
    },
  });

  for await (const ev of turn) {
    send(ev);
    const e = ev as {
      type?: string;
      message?: { content?: Array<Record<string, unknown>> };
    };

    if (e.type === "assistant" && e.message?.content) {
      for (const c of e.message.content) {
        if (c.type === "text" && typeof c.text === "string") {
          await appendChatMessage(sessionId, "assistant", {
            kind: "assistant",
            text: c.text,
          });
        } else if (c.type === "tool_use") {
          const id = String(c.id);
          const name = String(c.name);
          const input = (c.input ?? {}) as Record<string, unknown>;
          auditPending.set(id, {
            tool_name: name,
            input,
            confirmed: !isReadTool(name),
            account_id: msg.active_twilio_account_id ?? null,
          });
          await appendChatMessage(sessionId, "tool_use", {
            kind: "tool_use",
            id,
            tool_name: name,
            input,
          });
        }
      }
    }

    if (e.type === "user" && e.message?.content) {
      for (const c of e.message.content) {
        if (c.type === "tool_result") {
          const id = String(c.tool_use_id);
          await appendChatMessage(sessionId, "tool_result", {
            kind: "tool_result",
            tool_use_id: id,
            content: c.content,
            is_error: c.is_error ?? false,
          });
          const pending = auditPending.get(id);
          if (pending) {
            await pool.query(
              `INSERT INTO audit_log (user_id, chat_session_id, twilio_account_id,
                                       tool_name, tool_input, tool_result, confirmed_by_user)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                userId,
                sessionId,
                pending.account_id,
                pending.tool_name,
                JSON.stringify(pending.input),
                JSON.stringify({ content: c.content, is_error: c.is_error ?? false }),
                pending.confirmed,
              ],
            );
            auditPending.delete(id);
          }
        }
      }
    }
  }

  send({ type: "turn_complete" });
  app.log.info({ userId, sessionId }, "turn complete");
}
