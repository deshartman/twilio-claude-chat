import { resolveAccountHint } from "../context.js";

type Resolved = Awaited<ReturnType<typeof resolveAccountHint>>;

/**
 * Shared helper: returns an error CallToolResult if the hint doesn't resolve
 * to exactly one account, or null if the resolution succeeded.
 */
export function notFoundOrAmbiguous(resolved: Resolved, account_hint: string | undefined) {
  if (resolved.kind === "not_found") {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: account_hint
            ? `No Twilio account matches hint "${account_hint}". Ask the user to add one in Settings → Accounts, or try a different hint.`
            : "The user has no Twilio accounts configured. Direct them to Settings → Accounts.",
        },
      ],
    };
  }
  if (resolved.kind === "ambiguous") {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: `Multiple accounts matched. Ask the user which one via AskUserQuestion, then retry with a more specific account_hint. Candidates: ${resolved.matches
            .map((a) => `"${a.friendly_name}" (${a.account_sid})`)
            .join(", ")}`,
        },
      ],
    };
  }
  return null;
}

export function textResult(obj: unknown) {
  return {
    content: [
      { type: "text" as const, text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) },
    ],
  };
}
