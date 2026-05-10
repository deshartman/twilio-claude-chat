-- Idempotent schema for twilio-console-chat.
-- Loaded by docker-entrypoint-initdb.d on first boot AND by src/db/migrate.ts on demand.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS twilio_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friendly_name TEXT NOT NULL,
  account_sid TEXT NOT NULL,
  auth_mode TEXT NOT NULL DEFAULT 'api_key' CHECK (auth_mode IN ('api_key', 'auth_token')),
  is_subaccount BOOLEAN NOT NULL DEFAULT false,
  parent_account_id UUID REFERENCES twilio_accounts(id) ON DELETE SET NULL,
  -- AES-256-GCM sealed blob: JSON.stringify of credential object.
  -- api_key mode: {authMode:"api_key", sid, secret}.  auth_token mode: {authMode:"auth_token", authToken}.
  -- One iv + tag per row. Never encrypt separate fields with the same iv.
  credentials_ct BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  tag BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  scan_status TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'running', 'ready', 'failed')),
  scan_error TEXT,
  UNIQUE (user_id, friendly_name)
);
CREATE INDEX IF NOT EXISTS twilio_accounts_user_idx ON twilio_accounts(user_id);
-- Phase 2 additive: ensure auth_mode exists on pre-existing tables.
ALTER TABLE twilio_accounts
  ADD COLUMN IF NOT EXISTS auth_mode TEXT NOT NULL DEFAULT 'api_key'
  CHECK (auth_mode IN ('api_key', 'auth_token'));

-- Phase 2 C1: async pre-scan status. pending → running → ready | failed.
-- CHECK constraint only added on first creation; existing rows need an ADD CONSTRAINT.
ALTER TABLE twilio_accounts
  ADD COLUMN IF NOT EXISTS scan_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (scan_status IN ('pending', 'running', 'ready', 'failed'));
ALTER TABLE twilio_accounts
  ADD COLUMN IF NOT EXISTS scan_error TEXT;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_session_id TEXT,
  active_twilio_account_id UUID REFERENCES twilio_accounts(id) ON DELETE SET NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_sessions_user_idx ON chat_sessions(user_id);

-- Phase 2 D1: persisted chat messages (user, assistant, tool_use, tool_result).
-- payload JSONB matches the client ChatMessage discriminated union so the UI
-- can re-hydrate without server-side reshaping. seq is monotonic per session.
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  seq INT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'assistant', 'tool_use', 'tool_result')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chat_session_id, seq)
);
CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages(chat_session_id, seq);

-- Phase 2: per-account Twilio API response cache. JSONB payload + TTL.
-- Durable half of the cache layer; the in-process inFlight Map handles
-- same-process request coalescing. Single-machine deploy means we don't
-- need cross-instance invalidation.
CREATE TABLE IF NOT EXISTS resource_cache (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES twilio_accounts(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, resource_type, query_hash)
);
CREATE INDEX IF NOT EXISTS resource_cache_user_idx ON resource_cache(user_id);
CREATE INDEX IF NOT EXISTS resource_cache_expires_idx ON resource_cache(expires_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_session_id UUID,
  twilio_account_id UUID,
  tool_name TEXT NOT NULL,
  tool_input JSONB NOT NULL,
  tool_result JSONB,
  confirmed_by_user BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC);
