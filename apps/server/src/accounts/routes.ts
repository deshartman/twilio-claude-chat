import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/session.js";
import {
  createAccount,
  deleteAccount,
  getAccountForUser,
  listAccountsForUser,
  setScanStatus,
} from "./repo.js";
import type { AccountRow } from "./repo.js";
import { rescanAccount, runPrescan } from "../agent/prescan.js";

const commonAccountFields = {
  friendly_name: z.string().min(1).max(80),
  account_sid: z.string().regex(/^AC[0-9a-f]{32}$/i, "must start with AC then 32 hex chars"),
  is_subaccount: z.boolean().optional(),
  parent_account_id: z.string().uuid().optional(),
};

const newAccountSchema = z.discriminatedUnion("auth_mode", [
  z.object({
    ...commonAccountFields,
    auth_mode: z.literal("api_key"),
    api_key_sid: z.string().regex(/^SK[0-9a-f]{32}$/i, "must start with SK then 32 hex chars"),
    api_key_secret: z.string().min(16).max(128),
  }),
  z.object({
    ...commonAccountFields,
    auth_mode: z.literal("auth_token"),
    auth_token: z.string().regex(/^[0-9a-f]{32}$/i, "auth token must be 32 hex chars"),
  }),
]);

function publicShape(row: AccountRow) {
  return {
    id: row.id,
    friendly_name: row.friendly_name,
    account_sid: row.account_sid,
    auth_mode: row.auth_mode,
    is_subaccount: row.is_subaccount,
    parent_account_id: row.parent_account_id,
    created_at: row.created_at.toISOString(),
    last_used_at: row.last_used_at ? row.last_used_at.toISOString() : null,
    scan_status: row.scan_status,
    scan_error: row.scan_error,
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
      // Fire-and-forget pre-scan. The handler returns immediately; the
      // scan_status column and UI surface the progress to the user.
      // setScanStatus inside runPrescan flips pending → running → ready/failed.
      void runPrescan(user.id, row.id, app.log).catch((err) => {
        app.log.error({ err: err instanceof Error ? err.message : String(err), accountId: row.id }, "prescan unhandled");
      });
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

  app.post("/api/accounts/:id/rescan", async (req, reply) => {
    const user = await requireUser(req, reply);
    const { id } = req.params as { id: string };
    const account = await getAccountForUser(user.id, id);
    if (!account) return reply.code(404).send({ error: "not_found" });
    if (account.scan_status === "running") {
      return reply.code(409).send({ error: "scan_in_progress" });
    }
    // Flip to pending synchronously so the client sees the state change;
    // rescanAccount itself flips to running once it starts.
    await setScanStatus(user.id, id, "pending");
    void rescanAccount(user.id, id, app.log).catch((err) => {
      app.log.error({ err: err instanceof Error ? err.message : String(err), accountId: id }, "rescan unhandled");
    });
    return reply.send({ ok: true, scan_status: "pending" });
  });
}
