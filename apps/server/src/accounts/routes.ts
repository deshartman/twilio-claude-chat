import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/session.js";
import { createAccount, deleteAccount, listAccountsForUser } from "./repo.js";

const newAccountSchema = z.object({
  friendly_name: z.string().min(1).max(80),
  account_sid: z.string().regex(/^AC[0-9a-f]{32}$/i, "must start with AC then 32 hex chars"),
  api_key_sid: z.string().regex(/^SK[0-9a-f]{32}$/i, "must start with SK then 32 hex chars"),
  api_key_secret: z.string().min(16).max(128),
  is_subaccount: z.boolean().optional(),
  parent_account_id: z.string().uuid().optional(),
});

function publicShape<T extends { id: string; friendly_name: string; account_sid: string; is_subaccount: boolean; parent_account_id: string | null; created_at: Date; last_used_at: Date | null }>(row: T) {
  return {
    id: row.id,
    friendly_name: row.friendly_name,
    account_sid: row.account_sid,
    is_subaccount: row.is_subaccount,
    parent_account_id: row.parent_account_id,
    created_at: row.created_at.toISOString(),
    last_used_at: row.last_used_at ? row.last_used_at.toISOString() : null,
  };
}

export async function accountRoutes(app: FastifyInstance) {
  app.get("/api/accounts", async (req, reply) => {
    const user = await requireUser(req, reply);
    const rows = await listAccountsForUser(user.id);
    return reply.send({ accounts: rows.map(publicShape) });
  });

  app.post("/api/accounts", async (req, reply) => {
    const user = await requireUser(req, reply);
    const parsed = newAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_account", issues: parsed.error.issues });
    }
    try {
      const row = await createAccount({ user_id: user.id, ...parsed.data });
      return reply.send({ account: publicShape(row) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("twilio_accounts_user_id_friendly_name_key")) {
        return reply.code(409).send({ error: "friendly_name_taken" });
      }
      throw err;
    }
  });

  app.delete("/api/accounts/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    const { id } = req.params as { id: string };
    const ok = await deleteAccount(user.id, id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return reply.send({ ok: true });
  });
}
