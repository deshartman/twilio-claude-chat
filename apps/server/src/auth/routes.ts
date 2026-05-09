import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { createSession, destroySession, getUserFromRequest } from "./session.js";

const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(256),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/signup", async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_credentials" });
    const { email, password } = parsed.data;

    const hash = await argon2.hash(password, { type: argon2.argon2id });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string; email: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2)
         RETURNING id, email`,
        [email.toLowerCase(), hash],
      );
      const user = rows[0];
      await createSession(user.id, reply, client);
      await client.query("COMMIT");
      return reply.send({ user });
    } catch (err: unknown) {
      await client.query("ROLLBACK").catch(() => {});
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("users_email_key")) return reply.code(409).send({ error: "email_taken" });
      throw err;
    } finally {
      client.release();
    }
  });

  app.post("/api/auth/login", async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_credentials" });
    const { email, password } = parsed.data;

    const { rows } = await pool.query<{ id: string; email: string; password_hash: string }>(
      `SELECT id, email, password_hash FROM users WHERE email = $1`,
      [email.toLowerCase()],
    );
    const user = rows[0];
    if (!user) return reply.code(401).send({ error: "bad_credentials" });

    const ok = await argon2.verify(user.password_hash, password);
    if (!ok) return reply.code(401).send({ error: "bad_credentials" });

    await createSession(user.id, reply);
    return reply.send({ user: { id: user.id, email: user.email } });
  });

  app.post("/api/auth/logout", async (req, reply) => {
    await destroySession(req, reply);
    return reply.send({ ok: true });
  });

  app.get("/api/auth/me", async (req, reply) => {
    const user = await getUserFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({ user });
  });
}
