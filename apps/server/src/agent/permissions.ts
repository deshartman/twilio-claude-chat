import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk/entrypoints/sdk/runtimeTypes.js";

/**
 * Twilio-ops tools that mutate real Twilio resources. Each must be
 * human-approved via the WebSocket confirm protocol.
 */
export const WRITE_TOOLS = new Set([
  "mcp__twilio-ops__buy_phone_number",
  "mcp__twilio-ops__update_phone_number_config",
  "mcp__twilio-ops__create_messaging_service",
  "mcp__twilio-ops__add_sender_to_messaging_service",
  "mcp__twilio-ops__release_phone_number",
  "mcp__twilio-ops__bulk_assign_bundle_to_numbers",
  "mcp__twilio-ops__create_address",
]);

export function isReadTool(name: string): boolean {
  return (
    name.startsWith("mcp__twilio-ops__list_") ||
    name.startsWith("mcp__twilio-ops__fetch_") ||
    name.startsWith("mcp__twilio-ops__search_") ||
    name.startsWith("mcp__twilio-docs__")
  );
}

export type ConfirmDelegate = (req: {
  confirm_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  summary: string;
}) => Promise<boolean>;

/**
 * Build a canUseTool callback for a single turn. Reads pass instantly; writes
 * await a yes/no from the delegate (which talks to the UI over the WS).
 * Unknown tools are denied: this chat app is a Twilio-only surface.
 */
export function buildCanUseTool(delegate: ConfirmDelegate): CanUseTool {
  return async (toolName, input) => {
    if (isReadTool(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }
    if (WRITE_TOOLS.has(toolName)) {
      const confirm_id = crypto.randomUUID();
      const allow = await delegate({
        confirm_id,
        tool_name: toolName,
        tool_input: input,
        summary: summarizeWrite(toolName, input),
      });
      if (allow) return { behavior: "allow", updatedInput: input };
      return { behavior: "deny", message: "User declined the operation.", interrupt: false };
    }
    return {
      behavior: "deny",
      message: `Tool "${toolName}" is not available in this chat app. Use the Twilio tools.`,
      interrupt: false,
    };
  };
}

/**
 * Human-readable summary for the confirm modal. Intentionally terse — the
 * modal will also show the raw input JSON for auditability.
 */
function summarizeWrite(toolName: string, input: Record<string, unknown>): string {
  const short = toolName.replace(/^mcp__twilio-ops__/, "");
  const parts: string[] = [];
  if (input.account_hint) parts.push(`account: ${input.account_hint}`);
  if (input.phone_number) parts.push(`number: ${input.phone_number}`);
  if (input.phone_number_or_sid) parts.push(`number: ${input.phone_number_or_sid}`);
  if (input.country) parts.push(`country: ${input.country}`);
  if (input.type) parts.push(`type: ${input.type}`);
  if (input.area_code) parts.push(`area: ${input.area_code}`);
  if (input.friendly_name) parts.push(`name: ${input.friendly_name}`);
  if (input.service_sid) parts.push(`service: ${input.service_sid}`);
  if (input.bundle_sid) parts.push(`bundle: ${input.bundle_sid}`);
  if (input.address_sid) parts.push(`address: ${input.address_sid}`);
  if (input.customer_name) parts.push(`customer: ${input.customer_name}`);
  if (input.iso_country) parts.push(`country: ${input.iso_country}`);
  if (Array.isArray(input.phone_number_sids)) parts.push(`numbers: ${input.phone_number_sids.length}`);
  else if (Array.isArray(input.phone_numbers)) parts.push(`numbers: ${input.phone_numbers.length}`);
  return parts.length ? `${short} — ${parts.join(", ")}` : short;
}
