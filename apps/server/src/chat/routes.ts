import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/session.js";
import {
  deleteChatSession,
  getChatSession,
  listChatMessages,
  listChatSessionsForUser,
  type ChatMessageRow,
  type ChatSessionRow,
} from "./repo.js";

function sessionShape(row: ChatSessionRow) {
  return {
    id: row.id,
    active_twilio_account_id: row.active_twilio_account_id,
    title: row.title,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function messageShape(row: ChatMessageRow) {
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    payload: row.payload,
    created_at: row.created_at.toISOString(),
  };
}

export async function chatRoutes(app: FastifyInstance) {
  app.get("/api/chat/sessions", async (req, reply) => {
    const user = await requireUser(req, reply);
    const rows = await listChatSessionsForUser(user.id);
    return reply.send({ sessions: rows.map(sessionShape) });
  });

  app.get("/api/chat/sessions/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    const { id } = req.params as { id: string };
    const session = await getChatSession(user.id, id);
    if (!session) return reply.code(404).send({ error: "not_found" });
    const messages = await listChatMessages(id);
    return reply.send({
      session: sessionShape(session),
      messages: messages.map(messageShape),
    });
  });

  app.delete("/api/chat/sessions/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    const { id } = req.params as { id: string };
    const ok = await deleteChatSession(user.id, id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return reply.send({ ok: true });
  });
}
