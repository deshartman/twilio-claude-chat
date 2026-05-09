import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

const SESSION_COOKIE = "tcc_sid";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export type AuthedUser = { id: string; email: string };

function newSessionToken() {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

function hashToken(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function createSession(
  userId: string,
  reply: FastifyReply,
  client: PoolClient | typeof pool = pool,
) {
  const { raw, hash } = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await client.query(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
    [hash, userId, expiresAt],
  );
  reply.setCookie(SESSION_COOKIE, raw, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const raw = req.cookies[SESSION_COOKIE];
  if (raw) {
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [hashToken(raw)]);
  }
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function getUserFromRequest(req: FastifyRequest): Promise<AuthedUser | null> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const { rows } = await pool.query<{ id: string; email: string; expires_at: Date }>(
    `SELECT u.id, u.email, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [hashToken(raw)],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.expires_at.getTime() < Date.now()) {
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [hashToken(raw)]);
    return null;
  }
  return { id: row.id, email: row.email };
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser> {
  const user = await getUserFromRequest(req);
  if (!user) {
    reply.code(401).send({ error: "unauthorized" });
    throw new Error("unauthorized");
  }
  return user;
}
