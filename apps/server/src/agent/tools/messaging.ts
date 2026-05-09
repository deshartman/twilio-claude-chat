import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { buildTwilioClient, resolveAccountHint } from "../context.js";
import { notFoundOrAmbiguous, textResult } from "./_resolve.js";

export function buildListMessagingServicesTool(userId: string, activeAccountId: string | null) {
  return tool(
    "list_messaging_services",
    "List Messaging Services on a Twilio account, with their friendly names, inbound webhook URLs, and use-case.",
    { account_hint: z.string().optional() },
    async ({ account_hint }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      const services = await client.messaging.v1.services.list({ limit: 100 });
      return textResult({
        account: {
          friendly_name: resolved.account.friendly_name,
          account_sid: resolved.account.account_sid,
        },
        count: services.length,
        services: services.map((s) => ({
          sid: s.sid,
          friendly_name: s.friendlyName,
          inbound_request_url: s.inboundRequestUrl,
          inbound_method: s.inboundMethod,
          status_callback: s.statusCallback,
          use_case: s.usecase,
          us_app_to_person_registered: s.usAppToPersonRegistered,
          date_created: s.dateCreated,
        })),
      });
    },
  );
}

export function buildFetchMessagingServiceTool(userId: string, activeAccountId: string | null) {
  return tool(
    "fetch_messaging_service",
    "Fetch a Messaging Service in detail, including its phone-number senders and A2P compliance state.",
    {
      account_hint: z.string().optional(),
      service_sid: z.string().regex(/^MG[0-9a-f]{32}$/i),
    },
    async ({ account_hint, service_sid }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      const svc = client.messaging.v1.services(service_sid);
      const [service, phoneNumbers] = await Promise.all([svc.fetch(), svc.phoneNumbers.list({ limit: 100 })]);
      return textResult({
        service: {
          sid: service.sid,
          friendly_name: service.friendlyName,
          inbound_request_url: service.inboundRequestUrl,
          status_callback: service.statusCallback,
          use_case: service.usecase,
          us_app_to_person_registered: service.usAppToPersonRegistered,
          date_created: service.dateCreated,
        },
        senders: phoneNumbers.map((p) => ({
          sid: p.sid,
          phone_number: p.phoneNumber,
          capabilities: p.capabilities,
          country_code: p.countryCode,
          date_created: p.dateCreated,
        })),
      });
    },
  );
}

export function buildCreateMessagingServiceTool(userId: string, activeAccountId: string | null) {
  return tool(
    "create_messaging_service",
    "Create a new Messaging Service. REQUIRES HUMAN CONFIRMATION. The new service starts empty — add senders afterwards with add_sender_to_messaging_service.",
    {
      account_hint: z.string().optional(),
      friendly_name: z.string().min(1).max(64),
      inbound_request_url: z.string().url().optional(),
      status_callback: z.string().url().optional(),
      use_case: z.enum(["notifications", "marketing", "verification", "polling", "undeclared", "discussion", "mixed", "2fa", "low_volume"]).optional(),
    },
    async ({ account_hint, friendly_name, inbound_request_url, status_callback, use_case }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      const created = await client.messaging.v1.services.create({
        friendlyName: friendly_name,
        inboundRequestUrl: inbound_request_url,
        statusCallback: status_callback,
        usecase: use_case,
      });
      return textResult({
        sid: created.sid,
        friendly_name: created.friendlyName,
        inbound_request_url: created.inboundRequestUrl,
        status_callback: created.statusCallback,
        use_case: created.usecase,
      });
    },
  );
}

export function buildAddSenderToMessagingServiceTool(userId: string, activeAccountId: string | null) {
  return tool(
    "add_sender_to_messaging_service",
    "Add a phone number to a Messaging Service's sender pool. REQUIRES HUMAN CONFIRMATION. Pass either the PN SID (PN…) or the E.164 number.",
    {
      account_hint: z.string().optional(),
      service_sid: z.string().regex(/^MG[0-9a-f]{32}$/i),
      phone_number_or_sid: z.string(),
    },
    async ({ account_hint, service_sid, phone_number_or_sid }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      let pnSid = phone_number_or_sid;
      if (!pnSid.startsWith("PN")) {
        const found = await client.incomingPhoneNumbers.list({ phoneNumber: pnSid, limit: 1 });
        if (found.length === 0) {
          return {
            isError: true as const,
            content: [{ type: "text" as const, text: `No phone number matched "${phone_number_or_sid}" on this account.` }],
          };
        }
        pnSid = found[0].sid;
      }
      const added = await client.messaging.v1
        .services(service_sid)
        .phoneNumbers.create({ phoneNumberSid: pnSid });
      return textResult({
        service_sid,
        sender_sid: added.sid,
        phone_number: added.phoneNumber,
      });
    },
  );
}

export function buildListConversationsTool(userId: string, activeAccountId: string | null) {
  return tool(
    "list_conversations",
    "List recent Conversations (Conversations API V1 default service). Optionally scoped by a specific service_sid for multi-service deployments.",
    {
      account_hint: z.string().optional(),
      service_sid: z.string().regex(/^IS[0-9a-f]{32}$/i).optional(),
      limit: z.number().min(1).max(100).default(50),
    },
    async ({ account_hint, service_sid, limit }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      const convs = service_sid
        ? await client.conversations.v1.services(service_sid).conversations.list({ limit })
        : await client.conversations.v1.conversations.list({ limit });
      return textResult({
        account: {
          friendly_name: resolved.account.friendly_name,
          account_sid: resolved.account.account_sid,
        },
        count: convs.length,
        conversations: convs.map((c) => ({
          sid: c.sid,
          friendly_name: c.friendlyName,
          state: c.state,
          messaging_service_sid: c.messagingServiceSid,
          date_created: c.dateCreated,
          date_updated: c.dateUpdated,
        })),
      });
    },
  );
}
