import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { listAccountsForUser } from "../../accounts/repo.js";

export function buildListAccountsTool(userId: string) {
  return tool(
    "list_twilio_accounts",
    "List the Twilio accounts the current user has configured in this app. Returns friendly names, account SIDs, and whether each is a subaccount.",
    {},
    async () => {
      const rows = await listAccountsForUser(userId);
      const summary = rows.map((r) => ({
        friendly_name: r.friendly_name,
        account_sid: r.account_sid,
        is_subaccount: r.is_subaccount,
      }));
      return {
        content: [
          {
            type: "text",
            text:
              summary.length === 0
                ? "No Twilio accounts are configured for this user yet."
                : JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );
}

// Build a z.object() schema at module load so InferShape has the stable type.
export const _listAccountsSchema = z.object({});
