import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { buildTwilioClient, resolveAccountHint } from "../context.js";
import { notFoundOrAmbiguous, textResult } from "./_resolve.js";
import { cachedTwilioCall, invalidateCache } from "../cache/registry.js";

const PHONE_NUMBER_TTL_MS = 5 * 60 * 1000;

type CachedPhoneNumber = {
  sid: string;
  phone_number: string | null;
  friendly_name: string | null;
  voice_url: string | null;
  sms_url: string | null;
  capabilities: Record<string, boolean>;
  bundle_sid: string | null;
  address_sid: string | null;
  address_requirements: string | null;
};

async function getCachedPhoneNumberList(
  userId: string,
  accountId: string,
  client: Awaited<ReturnType<typeof buildTwilioClient>>,
): Promise<CachedPhoneNumber[]> {
  return cachedTwilioCall<CachedPhoneNumber[]>(
    { userId, accountId, resourceType: "phone_numbers" },
    PHONE_NUMBER_TTL_MS,
    async () => {
      const all = await client.incomingPhoneNumbers.list({ limit: 1000 });
      return all.map((n) => ({
        sid: n.sid,
        phone_number: n.phoneNumber ?? null,
        friendly_name: n.friendlyName ?? null,
        voice_url: n.voiceUrl ?? null,
        sms_url: n.smsUrl ?? null,
        capabilities: (n.capabilities as Record<string, boolean>) ?? {},
        bundle_sid: (n as { bundleSid?: string | null }).bundleSid ?? null,
        address_sid: n.addressSid ?? null,
        address_requirements: n.addressRequirements ?? null,
      }));
    },
  );
}

export function buildListPhoneNumbersTool(userId: string, activeAccountId: string | null) {
  return tool(
    "list_phone_numbers",
    "List phone numbers owned by a Twilio account. Optionally filter by country code (e.g. '+1', '+61') and/or required capabilities ('voice', 'sms', 'mms'). If the user has only one account, account_hint can be omitted.",
    {
      account_hint: z.string().optional(),
      country_code: z.string().optional().describe("E.164 country prefix such as '+1' or '+61'."),
      capabilities: z.array(z.enum(["voice", "sms", "mms"])).optional(),
    },
    async ({ account_hint, country_code, capabilities }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      const all = await getCachedPhoneNumberList(userId, resolved.account.id, client);
      const filtered = all.filter((n) => {
        if (country_code && !n.phone_number?.startsWith(country_code)) return false;
        if (capabilities) {
          if (!capabilities.every((c) => n.capabilities[c])) return false;
        }
        return true;
      });

      return textResult({
        account: {
          friendly_name: resolved.account.friendly_name,
          account_sid: resolved.account.account_sid,
        },
        count: filtered.length,
        numbers: filtered,
      });
    },
  );
}

export function buildFetchPhoneNumberTool(userId: string, activeAccountId: string | null) {
  return tool(
    "fetch_phone_number",
    "Fetch full configuration for a single phone number by SID or E.164 number. Useful when diagnosing why a webhook isn't firing.",
    {
      account_hint: z.string().optional(),
      phone_number_or_sid: z.string(),
    },
    async ({ account_hint, phone_number_or_sid }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      let sid = phone_number_or_sid;
      if (!sid.startsWith("PN")) {
        const cached = await getCachedPhoneNumberList(userId, resolved.account.id, client);
        const match = cached.find((n) => n.phone_number === phone_number_or_sid);
        if (!match) {
          return {
            isError: true as const,
            content: [{ type: "text" as const, text: `No number matched "${phone_number_or_sid}".` }],
          };
        }
        sid = match.sid;
      }
      const detail = await cachedTwilioCall(
        { userId, accountId: resolved.account.id, resourceType: "phone_number", query: { sid } },
        PHONE_NUMBER_TTL_MS,
        async () => {
          const n = await client.incomingPhoneNumbers(sid).fetch();
          return {
            sid: n.sid,
            phone_number: n.phoneNumber,
            friendly_name: n.friendlyName,
            voice_url: n.voiceUrl,
            voice_method: n.voiceMethod,
            voice_fallback_url: n.voiceFallbackUrl,
            sms_url: n.smsUrl,
            sms_method: n.smsMethod,
            sms_fallback_url: n.smsFallbackUrl,
            status_callback: n.statusCallback,
            capabilities: n.capabilities,
            bundle_sid: (n as { bundleSid?: string | null }).bundleSid ?? null,
            address_sid: n.addressSid ?? null,
            address_requirements: n.addressRequirements ?? null,
            origin: n.origin,
            date_created: n.dateCreated,
          };
        },
      );
      return textResult(detail);
    },
  );
}

export function buildSearchAvailableNumbersTool(userId: string, activeAccountId: string | null) {
  return tool(
    "search_available_numbers",
    "Search the Twilio number inventory for available numbers to purchase. Use before buy_phone_number to show the user options.",
    {
      account_hint: z.string().optional(),
      country: z.string().length(2).describe("ISO-3166-1 alpha-2 country code such as 'US', 'AU', 'GB'."),
      type: z.enum(["local", "mobile", "tollfree"]).default("local"),
      area_code: z.string().optional(),
      contains: z.string().optional().describe("Pattern to match — supports digits and * wildcard."),
      limit: z.number().min(1).max(50).default(10),
    },
    async ({ account_hint, country, type, area_code, contains, limit }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      const ctx = client.availablePhoneNumbers(country);
      const list =
        type === "mobile"
          ? ctx.mobile.list({ areaCode: area_code ? Number(area_code) : undefined, contains, limit })
          : type === "tollfree"
          ? ctx.tollFree.list({ contains, limit })
          : ctx.local.list({ areaCode: area_code ? Number(area_code) : undefined, contains, limit });
      const nums = await list;
      return textResult({
        country,
        type,
        count: nums.length,
        numbers: nums.map((n) => ({
          phone_number: n.phoneNumber,
          friendly_name: n.friendlyName,
          locality: n.locality,
          region: n.region,
          capabilities: n.capabilities,
        })),
      });
    },
  );
}

export function buildUpdatePhoneNumberConfigTool(userId: string, activeAccountId: string | null) {
  return tool(
    "update_phone_number_config",
    "Update webhook URLs on an IncomingPhoneNumber. Requires human confirmation. Pass only the fields you want to change; omit the rest.",
    {
      account_hint: z.string().optional(),
      phone_number_or_sid: z.string(),
      voice_url: z.string().url().optional(),
      sms_url: z.string().url().optional(),
      voice_fallback_url: z.string().url().optional(),
      sms_fallback_url: z.string().url().optional(),
      friendly_name: z.string().optional(),
    },
    async ({ account_hint, phone_number_or_sid, ...updates }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      let sid = phone_number_or_sid;
      if (!sid.startsWith("PN")) {
        const found = await client.incomingPhoneNumbers.list({ phoneNumber: sid, limit: 1 });
        if (found.length === 0) {
          return {
            isError: true as const,
            content: [{ type: "text" as const, text: `No phone number matched "${phone_number_or_sid}" in account "${resolved.account.friendly_name}".` }],
          };
        }
        sid = found[0].sid;
      }

      const payload: Record<string, string> = {};
      if (updates.voice_url) payload.voiceUrl = updates.voice_url;
      if (updates.sms_url) payload.smsUrl = updates.sms_url;
      if (updates.voice_fallback_url) payload.voiceFallbackUrl = updates.voice_fallback_url;
      if (updates.sms_fallback_url) payload.smsFallbackUrl = updates.sms_fallback_url;
      if (updates.friendly_name) payload.friendlyName = updates.friendly_name;

      const updated = await client.incomingPhoneNumbers(sid).update(payload);
      await invalidateCache(resolved.account.id, ["phone_numbers", "phone_number"]);

      return textResult({
        sid: updated.sid,
        phone_number: updated.phoneNumber,
        friendly_name: updated.friendlyName,
        voice_url: updated.voiceUrl,
        sms_url: updated.smsUrl,
        voice_fallback_url: updated.voiceFallbackUrl,
        sms_fallback_url: updated.smsFallbackUrl,
        changed: Object.keys(payload),
      });
    },
  );
}

export function buildBuyPhoneNumberTool(userId: string, activeAccountId: string | null) {
  return tool(
    "buy_phone_number",
    "Purchase a phone number. REQUIRES HUMAN CONFIRMATION. Pass either a specific phone_number OR search criteria (country+type+area_code/contains). Optional webhook_config applies the webhooks immediately after purchase.",
    {
      account_hint: z.string().optional(),
      phone_number: z.string().optional().describe("E.164 number to buy directly (skip search)."),
      country: z.string().length(2).optional(),
      type: z.enum(["local", "mobile", "tollfree"]).optional(),
      area_code: z.string().optional(),
      contains: z.string().optional(),
      voice_url: z.string().url().optional(),
      sms_url: z.string().url().optional(),
      friendly_name: z.string().optional(),
    },
    async ({ account_hint, phone_number, country, type, area_code, contains, voice_url, sms_url, friendly_name }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);

      let targetNumber = phone_number;
      if (!targetNumber) {
        if (!country || !type) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: "Provide either phone_number or (country, type, optional area_code/contains) so I can find a number to buy.",
              },
            ],
          };
        }
        const ctx = client.availablePhoneNumbers(country);
        const results =
          type === "mobile"
            ? await ctx.mobile.list({ areaCode: area_code ? Number(area_code) : undefined, contains, limit: 1 })
            : type === "tollfree"
            ? await ctx.tollFree.list({ contains, limit: 1 })
            : await ctx.local.list({ areaCode: area_code ? Number(area_code) : undefined, contains, limit: 1 });
        if (results.length === 0) {
          return {
            isError: true as const,
            content: [{ type: "text" as const, text: "No matching numbers available to purchase." }],
          };
        }
        targetNumber = results[0].phoneNumber;
      }

      const bought = await client.incomingPhoneNumbers.create({
        phoneNumber: targetNumber,
        voiceUrl: voice_url,
        smsUrl: sms_url,
        friendlyName: friendly_name,
      });
      await invalidateCache(resolved.account.id, ["phone_numbers", "phone_number"]);

      return textResult({
        sid: bought.sid,
        phone_number: bought.phoneNumber,
        friendly_name: bought.friendlyName,
        voice_url: bought.voiceUrl,
        sms_url: bought.smsUrl,
        status: "purchased",
      });
    },
  );
}

export function buildReleasePhoneNumberTool(userId: string, activeAccountId: string | null) {
  return tool(
    "release_phone_number",
    "Release a phone number back to Twilio (permanent — the number may be assigned to someone else immediately). REQUIRES HUMAN CONFIRMATION. Numbers purchased within the last 30 days may lose ported-in eligibility — warn the user.",
    {
      account_hint: z.string().optional(),
      phone_number_or_sid: z.string(),
    },
    async ({ account_hint, phone_number_or_sid }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      let sid = phone_number_or_sid;
      if (!sid.startsWith("PN")) {
        const found = await client.incomingPhoneNumbers.list({ phoneNumber: sid, limit: 1 });
        if (found.length === 0) {
          return {
            isError: true as const,
            content: [{ type: "text" as const, text: `No phone number matched "${phone_number_or_sid}".` }],
          };
        }
        sid = found[0].sid;
      }
      await client.incomingPhoneNumbers(sid).remove();
      // Release can also detach the PN from a messaging service, so drop sender caches too.
      await invalidateCache(resolved.account.id, [
        "phone_numbers",
        "phone_number",
        "messaging_service_senders",
        "messaging_service",
      ]);
      return textResult({ released_sid: sid, phone_number_or_sid, status: "released" });
    },
  );
}
