import { createSdkMcpServer, query } from "@anthropic-ai/claude-agent-sdk";
import { buildAllTools } from "./tools/index.js";
import { buildCanUseTool, type ConfirmDelegate } from "./permissions.js";

export type RunTurnArgs = {
  userId: string;
  prompt: string;
  activeAccountId?: string | null;
  confirmDelegate: ConfirmDelegate;
};

export function runTurn(args: RunTurnArgs) {
  const twilioServer = createSdkMcpServer({
    name: "twilio-ops",
    version: "0.1.0",
    tools: buildAllTools(args.userId, args.activeAccountId ?? null),
  });

  return query({
    prompt: args.prompt,
    options: {
      // With CLAUDE_CODE_USE_BEDROCK=1 + ANTHROPIC_DEFAULT_OPUS_MODEL pinned,
      // "opus" resolves to Opus 4.7 via the Bedrock inference profile.
      model: "opus",
      mcpServers: {
        "twilio-ops": twilioServer,
        "twilio-docs": { type: "http", url: "https://mcp.twilio.com/docs" },
      },
      // Load user-level config so plugin-installed skills
      // (twilio-developer-kit) are available to Claude.
      settingSources: ["user"],
      canUseTool: buildCanUseTool(args.confirmDelegate),
    },
  });
}
