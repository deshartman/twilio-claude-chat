import { listChatMessages, type ChatMessageRow } from "./repo.js";

const MAX_REPLAYED_MESSAGES = 40;
const MAX_TOOL_RESULT_BYTES = 2000;

/**
 * Extract a human-readable string from a tool_result payload's content array.
 * Matches the shape persisted by WS (the raw SDK content blocks).
 */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((x) =>
        typeof x === "object" && x && "text" in x
          ? String((x as { text: unknown }).text)
          : JSON.stringify(x),
      )
      .join("");
  }
  return JSON.stringify(content ?? "");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `… [truncated, original ${s.length} chars]`;
}

function formatLine(msg: ChatMessageRow): string | null {
  const ts = msg.created_at.toISOString();
  const p = msg.payload as Record<string, unknown>;
  switch (msg.kind) {
    case "user":
      return `User: ${String(p.text ?? "")}`;
    case "assistant":
      return `Assistant: ${String(p.text ?? "")}`;
    case "tool_use": {
      const name = String(p.tool_name ?? "").replace(/^mcp__twilio-ops__/, "");
      const input = JSON.stringify(p.input ?? {});
      return `Tool call: ${name}(${truncate(input, 500)})`;
    }
    case "tool_result": {
      const text = truncate(toolResultText(p.content), MAX_TOOL_RESULT_BYTES);
      const err = p.is_error ? " [error]" : "";
      return `Tool result (captured ${ts})${err}: ${text}`;
    }
  }
}

/**
 * Build the transcript preamble that gets prepended to the current turn's
 * user prompt. Returns "" if the session has no prior messages (fresh session).
 *
 * The last message is the current user_message the WS just appended — we must
 * drop it so the live turn isn't duplicated in the preamble.
 *
 * Staleness framing matters: prior tool results reflect the Twilio estate
 * at capture time, not now. The model is told this explicitly so follow-ups
 * that depend on current state (releases, updates) trigger a re-query instead
 * of acting on stale data.
 */
export async function buildTranscriptPreamble(
  sessionId: string,
  currentPrompt: string,
): Promise<string> {
  const all = await listChatMessages(sessionId);
  // Drop the trailing live user message — we don't want to replay it.
  const prior = all.slice(0, -1);
  if (prior.length === 0) return "";

  const window = prior.slice(-MAX_REPLAYED_MESSAGES);
  const oldest = window[0].created_at.toISOString();

  const body = window
    .map(formatLine)
    .filter((l): l is string => l !== null)
    .join("\n");

  const truncatedNote =
    prior.length > MAX_REPLAYED_MESSAGES
      ? `\n[Note: ${prior.length - MAX_REPLAYED_MESSAGES} earlier messages omitted to fit the context window.]`
      : "";

  return (
    `[Prior conversation context — oldest entry captured ${oldest}. This is a ` +
    `RESUMED session. Any tool results below reflect the Twilio estate at the ` +
    `time they were captured, not now. If the user's follow-up depends on ` +
    `current state (a phone number still existing, a messaging service still ` +
    `configured, a webhook still pointing where it did), re-query the relevant ` +
    `tool before acting. Never issue a write tool based on stale data below.]\n\n` +
    body +
    truncatedNote +
    `\n\n[End of prior context. Live turn follows.]\nUser: ${currentPrompt}`
  );
}
