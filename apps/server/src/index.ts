import "./env.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { authRoutes } from "./auth/routes.js";
import { accountRoutes } from "./accounts/routes.js";
import { chatRoutes } from "./chat/routes.js";
import { registerChatWs } from "./agent/ws.js";
import { onCacheEvent } from "./agent/cache/registry.js";
import { pool } from "./db/pool.js";

const PORT = Number(process.env.PORT ?? 3001);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) {
    console.error(`[fatal] missing env ${name}`);
    process.exit(1);
  }
  return v;
}

requireEnv("DATABASE_URL");
requireEnv("APP_SECRET_KEY");
requireEnv("SESSION_SECRET");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const schemaPath = path.join(__dirname, "db", "schema.sql");
  const sql = await fs.readFile(schemaPath, "utf8");
  await pool.query(sql);
  console.log("[migrate] schema applied");
}

async function main() {
  await migrate();

  const app = Fastify({ logger: true });

  await app.register(cookie, { secret: process.env.SESSION_SECRET });
  await app.register(cors, { origin: WEB_ORIGIN, credentials: true });
  await app.register(websocket);

  onCacheEvent((stat, key) => {
    app.log.info({ cache: stat, type: key.resourceType, account: key.accountId }, `cache ${stat}`);
  });

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(chatRoutes);
  await app.register(registerChatWs);

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`listening on :${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
