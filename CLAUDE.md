# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A "UI-less Twilio Console" — a multi-tenant chat app that replaces the Twilio Console. Users type natural-language intents ("show my AU mobile numbers", "update the voice webhook for +1…", "why did CAxxx fail?") and Claude reasons over their Twilio estate with both read and write tools.

Built on the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) so the agent loop, plugin-installed skills, MCP servers, and permission hooks are inherited rather than reimplemented. Supports two Claude providers: **direct Anthropic API** (`ANTHROPIC_API_KEY`) and **Amazon Bedrock** (`CLAUDE_CODE_USE_BEDROCK=1` + AWS creds). The SDK auto-detects — Bedrock wins if its flag is set, otherwise direct API. This deployment typically runs on Bedrock for corporate LLM routing; external forks often run on the direct API.

## Common commands

```bash
# One-time setup
docker compose up -d postgres       # Postgres on :5433, schema auto-loaded on first boot
pnpm install                        # must be pnpm (workspace protocol)

# Dev loop
pnpm dev                            # parallel: server :3001 + web :5173 (via Vite proxy)
pnpm dev:server                     # server only
pnpm dev:web                        # web only

# Postgres
pnpm db:up / db:down / db:logs
pnpm db:migrate                     # re-applies schema.sql (idempotent)

# Typechecking (there are no tests yet)
pnpm typecheck                      # both apps + shared
```

Visit http://localhost:5173/. Vite proxies `/api` and `/ws` to the Fastify server.

To reset DB state: `docker compose down && rm -rf pgdata && docker compose up -d postgres`. `pgdata/` is bind-mounted and gitignored.

## Architecture

Monorepo: `apps/server` (Fastify + Agent SDK), `apps/web` (Vite + React + Tailwind), `packages/shared` (WS message types).

### Request flow for a chat turn

1. Browser opens WebSocket to `/ws/chat` ([apps/server/src/agent/ws.ts](apps/server/src/agent/ws.ts)). Auth is enforced via the session cookie at upgrade time.
2. Client sends `{type: "user_message", prompt, active_twilio_account_id}`.
3. Server calls `runTurn()` ([apps/server/src/agent/runner.ts](apps/server/src/agent/runner.ts)) which wraps `query()` from the Agent SDK with two MCP servers: `twilio-ops` (our SDK-mode server with tool handlers) and `twilio-docs` (remote HTTP MCP at `https://mcp.twilio.com/docs`).
4. `settingSources: ["user"]` pulls in user-level Claude Code config, which is how plugin-installed skills like `twilio-developer-kit` reach the agent.
5. Each SDK message streams back over the WS as-is (`{type: "assistant", message:…}` and `{type: "user", message:…}` for tool results).
6. Tool calls go through `canUseTool` ([apps/server/src/agent/permissions.ts](apps/server/src/agent/permissions.ts)): reads auto-allow; writes emit a `confirm_request` over the WS and await a `confirm_response` from the UI before proceeding.
7. Every completed tool call writes a row to `audit_log` with `confirmed_by_user` set based on whether it was a write (= user clicked Run) or a read.

Turns are isolated — there is intentionally no `resume:` wiring and no server-side chat history. Closing the browser tab discards the conversation, matching the real Twilio Console's behavior. The `chat_sessions` table exists in schema but is unused; `audit_log.chat_session_id` is always NULL.

### The permission protocol is the safety net

MCP tool names starting with `list_`, `fetch_`, `search_` auto-allow via `isReadTool()`. Anything in `WRITE_TOOLS` triggers a promise-based confirm flow: server generates a `confirm_id`, sends `{type: "confirm_request", confirm_id, tool_name, tool_input, summary}` over the WS, parks the promise in `pendingConfirms`, and `canUseTool` returns allow/deny based on the user's modal response. Any other tool (Claude Code built-ins like Bash, Read, Write) is denied outright — this chat app is a Twilio-only surface.

When adding a new write tool, add its `mcp__twilio-ops__…` name to the `WRITE_TOOLS` set.

### Credential storage

Twilio API keys are sealed per row with AES-256-GCM ([apps/server/src/crypto.ts](apps/server/src/crypto.ts)). Scheme: `JSON.stringify({sid, secret})` → one `credentials_ct` + one `iv` + one `tag` per row. **Never encrypt the SID and secret with the same IV in separate fields** — GCM IV reuse leaks the XOR of both plaintexts.

Key comes from `APP_SECRET_KEY` env var (32 bytes base64). Credentials are decrypted only inside `loadCredentialsForAccount()` per tool call, never cached.

Cross-user isolation is enforced via SQL `WHERE user_id = $1` in every account lookup ([apps/server/src/accounts/repo.ts](apps/server/src/accounts/repo.ts)). The agent's `account_hint` resolver ([apps/server/src/agent/context.ts](apps/server/src/agent/context.ts)) is always scoped by the authenticated user. Do not add code paths that load credentials without this guard.

### Agent tools

Tools are built per-turn as closures that capture `userId` and `activeAccountId` — see `buildAllTools()` in [apps/server/src/agent/tools/index.ts](apps/server/src/agent/tools/index.ts). Naming convention drives the read/write classification: `list_…`, `fetch_…`, `search_…` are reads; writes use action verbs (`buy_`, `update_`, `create_`, `add_`, `release_`).

Each tool calls `resolveAccountHint()` first and short-circuits with an error `CallToolResult` if resolution is `not_found` or `ambiguous` — the shared helper is in [apps/server/src/agent/tools/_resolve.ts](apps/server/src/agent/tools/_resolve.ts). When adding a tool, follow this pattern; don't skip the hint resolution.

### Frontend layout pitfall

The chat column uses nested flex containers. Every ancestor in the flex chain (`App.tsx > main`, `ChatPage > grid cell`, `ChatPane > root`) needs `min-h-0` and the scroll container needs `min-h-0 overflow-auto`. Without this, a long assistant message grows the column instead of scrolling internally, and the input field disappears below the viewport. The fix is load-bearing — if someone touches the chat layout, keep `min-h-0` on the flex chain.

## Environment variables

Single `.env` at the **repo root** (copied from `.env.example`). The server explicitly loads it via [apps/server/src/env.ts](apps/server/src/env.ts), imported first-as-side-effect in [apps/server/src/index.ts](apps/server/src/index.ts). No `apps/server/.env` — if you see one, it's stale and ignored.

- `DATABASE_URL` — Postgres connection string. Docker compose uses `:5433` (host port) to avoid conflicts with other local Postgres instances.
- `APP_SECRET_KEY` — 32 bytes base64, AES-GCM data key. Distinct from SESSION_SECRET.
- `SESSION_SECRET` — 32 bytes base64, Fastify cookie signing.
- Claude provider — **pick one**:
  - **Direct API:** `ANTHROPIC_API_KEY=sk-ant-…`
  - **Bedrock:** `CLAUDE_CODE_USE_BEDROCK=1` + `AWS_REGION` + `ANTHROPIC_DEFAULT_OPUS_MODEL=us.anthropic.claude-opus-4-7` + `AWS_PROFILE` (or static `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`). Model access for Opus 4.7 must be granted in the Bedrock console for the chosen region.

Generate secrets with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## Non-obvious gotchas

- **Two native build scripts** need approval: `argon2` and `esbuild`. `package.json` already lists these in `pnpm.onlyBuiltDependencies` so `pnpm install` runs them automatically.
- **Session token column is TEXT**, not UUID — we store sha256-hex hashes of 32-byte random tokens (64 chars), wider than a UUID. Don't change this to UUID.
- **Signup is transactional**: user insert + session insert wrap in BEGIN/COMMIT so a crash between them doesn't orphan a user row that blocks the email from being reused.
- **Credentials always decrypt on demand**: there is no in-memory credential cache. If you find yourself wanting one, stop and reconsider — the design assumes a cred leak is always fixed by rotating `APP_SECRET_KEY`.
- **The Twilio Node SDK uses lowercase `usecase`** on MessagingService (not camelCase). Also `phoneNumberSid` on sender pool creation.
- **`canUseTool` does not receive the model's `tool_use_id`** — we generate our own `confirm_id` correlation key for the modal round-trip.
- **`main()` bootstrap uses `.catch()` not top-level await** — the linter flags it as a preference warning, but this is the standard Fastify bootstrap pattern and works identically. Ignore that specific warning.

## What's intentionally out of scope for v1

Regulatory Bundle creation (file uploads too rich for a chat flow), Studio flow editing, TCR A2P campaign submission, billing/subaccount creation, Flex/Studio/Video. These are listed in the plan as "console wins here"; don't add them unless the scope discussion changes.

## Plan files

The design decisions that shape this codebase live at:
- `/Users/dhartman/.claude/plans/so-considering-the-twilio-developer-kit-keen-aurora.md` (original plan)
- `/Users/dhartman/.claude/plans/can-you-look-at-shiny-wilkinson.md` (confirmed decisions + Q&A refinements)

When picking up work, read the plan's Q&A section before changing load-bearing architecture (provider choice, multi-tenancy model, write-tool confirmation protocol, session persistence).
