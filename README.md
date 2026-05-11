# Twilio Chat

A UI-less Twilio Console. Type natural-language intents — *"show my AU mobile numbers"*, *"update the voice webhook for +1…"*, *"why did CAxxx fail?"* — and Claude reasons over your Twilio estate with both read and write tools. Multi-tenant, per-user encrypted credentials, human-in-the-loop confirmation for every write.

Built on the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), served through **Amazon Bedrock**.

## Requirements

- **Node.js 20+** and **pnpm 10+** (`npm install -g pnpm`)
- **Docker** (for local Postgres)
- **AWS account** with Bedrock access, specifically model access granted to *Claude Opus 4.7* (`us.anthropic.claude-opus-4-7`) in your chosen region
- **Twilio account(s)** to actually point the agent at. API Key + Secret **or** Account SID + Auth Token both work.

## Quick start

```bash
# 1. Install deps
pnpm install

# 2. Set up env
cp .env.example .env
cp .env.example apps/server/.env    # server reads its own .env

# Generate the two required 32-byte secrets:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Paste one into APP_SECRET_KEY and the other into SESSION_SECRET in both .env files.
# Then fill in the AWS and Bedrock values (see "Environment" below).

# 3. Start Postgres (first boot loads apps/server/src/db/schema.sql automatically)
pnpm db:up

# 4. Start server + web in parallel
pnpm dev
```

Open **http://localhost:5173/**. Sign up for a local account, add a Twilio account under **Accounts**, then start chatting.

## What each env variable does

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string. Default `postgres://twilio_chat:devpassword@localhost:5433/twilio_chat` matches `docker-compose.yml`. |
| `PORT` | | Fastify port. Default `3001`. |
| `WEB_ORIGIN` | | CORS origin for the web app. Default `http://localhost:5173`. |
| `APP_SECRET_KEY` | ✅ | 32 bytes base64. AES-256-GCM data-key used to seal per-row Twilio credentials. Treated as version 1. Rotatable — see *Rotating APP_SECRET_KEY* below. |
| `APP_SECRET_KEY_V{N}` | | Explicit key slot for version N. During rotation, you run with multiple versions loaded simultaneously. |
| `APP_SECRET_KEY_CURRENT` | | Which key version `seal()` uses for NEW rows. Defaults to the highest loaded version. |
| `SESSION_SECRET` | ✅ | 32 bytes base64. Fastify cookie signing secret. Distinct from `APP_SECRET_KEY`. |
| `CLAUDE_CODE_USE_BEDROCK` | ✅ | Set to `1` to route the Agent SDK through Bedrock. |
| `AWS_REGION` | ✅ | The region where Opus 4.7 is enabled for your AWS account (e.g. `us-west-2`). |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | ✅ | `us.anthropic.claude-opus-4-7` — the Bedrock cross-region inference profile. |
| `AWS_PROFILE` *or* `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | ✅ | Pick one auth method. SSO profile works if you `aws sso login` first. |

`.env.example` is the canonical list. `.env*` files are gitignored — never commit them.

## Common commands

```bash
# Dev
pnpm dev                 # server :3001 + web :5173 (Vite proxies /api + /ws)
pnpm dev:server          # server only
pnpm dev:web             # web only

# Postgres
pnpm db:up               # start Postgres container on port 5433
pnpm db:down             # stop it (preserves data in ./pgdata)
pnpm db:logs             # tail the Postgres log
pnpm db:migrate          # re-apply schema.sql (idempotent — safe to run anytime)

# Quality gates
pnpm typecheck           # tsc --noEmit across all workspaces
pnpm test                # Vitest server suite (runBounded + cache helper)
```

### Resetting the database

If you want a clean DB (e.g. forgot a secret, want to re-run signup):

```bash
docker compose down
rm -rf pgdata
pnpm db:up
```

`pgdata/` is a bind-mount and is gitignored.

## Architecture at a glance

- `apps/server` — Fastify + Claude Agent SDK (TypeScript, ESM). Owns auth, sessions, account CRUD, WebSocket chat, 16 Twilio tools, the resource cache, and the async pre-scan on account creation.
- `apps/web` — Vite + React + Tailwind. Single-page app: sidebar with Recents, chat pane, artifact pane for tool results.
- `packages/shared` — WebSocket message types shared between server and web.

A chat turn flows as:

1. Browser opens a WebSocket to `/ws/chat` (auth enforced at upgrade time via the session cookie).
2. Client sends `{type: "user_message", prompt, active_twilio_account_id, chat_session_id?}`.
3. Server runs `query()` from the Agent SDK with two MCP servers: `twilio-ops` (our SDK-mode server with tool handlers that hit Twilio) and `twilio-docs` (the hosted `mcp.twilio.com/docs`).
4. Every SDK event streams back over the WS. Read tools auto-allow; write tools emit a `confirm_request` and await a `confirm_response` from the UI before running.
5. Each completed tool call writes a row to `audit_log`.

See [CLAUDE.md](CLAUDE.md) for deeper architectural notes (credential sealing, cache invalidation, layout pitfalls).

## Rotating `APP_SECRET_KEY`

Each stored Twilio credential is sealed with a specific key version, recorded in `twilio_accounts.key_version`. You can rotate without invalidating existing rows by running old + new keys in parallel, re-sealing, then dropping the old one.

```bash
# 1. Generate a new key.
NEW=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")

# 2. Set both keys in .env and .env (apps/server/.env), marking the new one as current:
#    APP_SECRET_KEY_V1=<your existing key, same bytes as APP_SECRET_KEY was>
#    APP_SECRET_KEY_V2=<the new key you just generated>
#    APP_SECRET_KEY_CURRENT=2
#    (Remove or comment out the unsuffixed APP_SECRET_KEY if present.)

# 3. Restart the server so it re-reads env. Existing rows still decrypt (V1 still
#    loaded). New rows seal under V2.

# 4. Walk every row and re-seal under V2. Idempotent; safe to re-run.
pnpm rotate-keys

# 5. Once output reports failed=0, every row is on V2. You can now remove
#    APP_SECRET_KEY_V1 from env on the next restart.
```

If you skip step 2 and just swap the env var, old rows become unreadable — that's what versioning prevents.

## Editing a Twilio account (key changed upstream)

If a user rotates their Twilio API key in the Twilio console, open **Accounts → Edit** on that row and tick *Rotate credentials*. The new secret is sealed immediately under the current key version. The account's internal UUID stays the same, so existing audit-log rows and cached data still point at the right account. You can also rename here, or switch from API Key → Auth Token in place.

`account_sid` is deliberately not editable — that's a different Twilio account; delete + re-add is the right flow for that.

## Credentials & security

- Twilio API keys are sealed **per row** with AES-256-GCM. Scheme: `JSON.stringify({sid, secret})` → one ciphertext + one IV + one tag. Never encrypt the SID and secret with the same IV in separate fields — GCM IV reuse leaks the XOR.
- Credentials are decrypted **on demand** inside each tool call. There is no in-memory cred cache.
- Cross-user isolation is enforced by `WHERE user_id = $1` on every account lookup. The agent's `account_hint` resolver is always scoped by the authenticated user.
- Sessions are sha256-hex hashes of 32-byte random tokens, stored in Postgres with TTL.

## Common pitfalls

- **Fresh Postgres on a different schema?** Run `pnpm db:migrate`. The schema is idempotent.
- **`pnpm install` prompts about native build scripts.** `argon2` and `esbuild` are allow-listed in `package.json`'s `pnpm.onlyBuiltDependencies`, so they build automatically.
- **Session token column is `TEXT`, not `UUID`.** Intentional — we store 64-hex-char sha256 digests, wider than a UUID. Don't "fix" this.
- **Bedrock 403 on first request?** Your AWS account needs explicit model access to `anthropic.claude-opus-4-v2-0` (or whatever Opus 4.7's concrete model ID is) in the chosen region. Granted in the Bedrock console under "Model access".
- **`main().catch()` in server bootstrap.** Linter flags it as a preference warning — the pattern is correct for Fastify. Ignore.

## What's intentionally out of scope

Regulatory Bundle creation, Studio flow editing, TCR A2P campaign submission, billing/subaccount creation, Flex/Studio/Video. The Twilio Console has rich UIs for these and a chat surface doesn't beat them.

## Tests

Vitest server-side only. Two suites:

- `apps/server/src/util/bounded.test.ts` — the pre-scan's bounded-parallelism limiter (6 tests: ordering, failure isolation, concurrency cap, timeouts).
- `apps/server/src/agent/cache/registry.test.ts` — the resource cache's single-flight semantics against a mocked `pg.Pool` (8 tests: hit/miss, coalescing across concurrent callers, stable query hashing, write invalidation).

```bash
pnpm test                     # run once
pnpm --filter server test:watch    # watch mode during dev
```

## License

Internal / unpublished.
