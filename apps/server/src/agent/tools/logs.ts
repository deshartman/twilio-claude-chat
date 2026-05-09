import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { buildTwilioClient, resolveAccountHint } from "../context.js";
import { notFoundOrAmbiguous, textResult } from "./_resolve.js";

const dateRange = z
  .object({ start: z.string().optional(), end: z.string().optional() })
  .optional()
  .describe("ISO-8601 date-only or datetime strings. Applies to start/end of the logged-at time.");

export function buildListCallsTool(userId: string, activeAccountId: string | null) {
  return tool(
    "list_calls",
    "List calls on a Twilio account. Optionally filter by status, From/To number, or date range. Useful for 'which calls failed yesterday'.",
    {
      account_hint: z.string().optional(),
      status: z.enum(["queued", "ringing", "in-progress", "canceled", "completed", "busy", "failed", "no-answer"]).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      date_range: dateRange,
      limit: z.number().min(1).max(100).default(50),
    },
    async ({ account_hint, status, from, to, date_range, limit }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      const calls = await client.calls.list({
        status,
        from,
        to,
        startTimeAfter: date_range?.start ? new Date(date_range.start) : undefined,
        startTimeBefore: date_range?.end ? new Date(date_range.end) : undefined,
        limit,
      });

      return textResult({
        account: {
          friendly_name: resolved.account.friendly_name,
          account_sid: resolved.account.account_sid,
        },
        count: calls.length,
        calls: calls.map((c) => ({
          sid: c.sid,
          from: c.from,
          to: c.to,
          status: c.status,
          direction: c.direction,
          start_time: c.startTime,
          end_time: c.endTime,
          duration_sec: c.duration,
          price: c.price,
          price_unit: c.priceUnit,
        })),
      });
    },
  );
}

export function buildFetchCallLogTool(userId: string, activeAccountId: string | null) {
  return tool(
    "fetch_call_log",
    "Fetch details for a single call by SID, including monitor events (alerts/notifications emitted during the call). Use this for root-cause analysis of failed calls.",
    {
      account_hint: z.string().optional(),
      call_sid: z.string().regex(/^CA[0-9a-f]{32}$/i),
    },
    async ({ account_hint, call_sid }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      const [call, notifications, recordings] = await Promise.all([
        client.calls(call_sid).fetch(),
        client.calls(call_sid).notifications.list({ limit: 20 }),
        client.calls(call_sid).recordings.list({ limit: 5 }),
      ]);
      return textResult({
        call: {
          sid: call.sid,
          from: call.from,
          to: call.to,
          status: call.status,
          direction: call.direction,
          start_time: call.startTime,
          end_time: call.endTime,
          duration_sec: call.duration,
          answered_by: call.answeredBy,
          forwarded_from: call.forwardedFrom,
          caller_name: call.callerName,
          price: call.price,
          price_unit: call.priceUnit,
        },
        notifications: notifications.map((n) => ({
          sid: n.sid,
          error_code: n.errorCode,
          message_text: n.messageText,
          log: n.log,
          message_date: n.messageDate,
        })),
        recordings: recordings.map((r) => ({
          sid: r.sid,
          duration_sec: r.duration,
          channels: r.channels,
          status: r.status,
        })),
      });
    },
  );
}

export function buildListMessagesTool(userId: string, activeAccountId: string | null) {
  return tool(
    "list_messages",
    "List SMS/MMS messages on a Twilio account. Filter by status ('delivered', 'failed', 'undelivered', etc.), error_code, From/To, or date range.",
    {
      account_hint: z.string().optional(),
      status: z.enum(["accepted", "queued", "sending", "sent", "delivered", "undelivered", "failed", "received"]).optional(),
      error_code: z.number().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      date_range: dateRange,
      limit: z.number().min(1).max(100).default(50),
    },
    async ({ account_hint, status, error_code, from, to, date_range, limit }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      const messages = await client.messages.list({
        from,
        to,
        dateSentAfter: date_range?.start ? new Date(date_range.start) : undefined,
        dateSentBefore: date_range?.end ? new Date(date_range.end) : undefined,
        limit,
      });
      const filtered = messages.filter((m) => {
        if (status && m.status !== status) return false;
        if (error_code != null && m.errorCode !== error_code) return false;
        return true;
      });

      return textResult({
        account: {
          friendly_name: resolved.account.friendly_name,
          account_sid: resolved.account.account_sid,
        },
        count: filtered.length,
        messages: filtered.map((m) => ({
          sid: m.sid,
          from: m.from,
          to: m.to,
          status: m.status,
          direction: m.direction,
          error_code: m.errorCode,
          error_message: m.errorMessage,
          num_segments: m.numSegments,
          date_sent: m.dateSent,
          price: m.price,
          price_unit: m.priceUnit,
          body_preview: m.body ? String(m.body).slice(0, 120) : null,
        })),
      });
    },
  );
}

export function buildFetchDebuggerEventsTool(userId: string, activeAccountId: string | null) {
  return tool(
    "fetch_debugger_events",
    "Fetch recent debugger/alert events from the Monitor API (/v1/Alerts). Use this to triage 'why is something breaking' without a specific CallSid.",
    {
      account_hint: z.string().optional(),
      date_range: dateRange,
      error_code: z.string().optional().describe("Filter to a specific error code string (e.g. '11200')."),
      limit: z.number().min(1).max(100).default(50),
    },
    async ({ account_hint, date_range, error_code, limit }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      const alerts = await client.monitor.v1.alerts.list({
        startDate: date_range?.start ? new Date(date_range.start) : undefined,
        endDate: date_range?.end ? new Date(date_range.end) : undefined,
        limit,
      });
      const filtered = error_code ? alerts.filter((a) => a.errorCode === error_code) : alerts;

      return textResult({
        account: {
          friendly_name: resolved.account.friendly_name,
          account_sid: resolved.account.account_sid,
        },
        count: filtered.length,
        alerts: filtered.map((a) => ({
          sid: a.sid,
          error_code: a.errorCode,
          log_level: a.logLevel,
          date_created: a.dateCreated,
          resource_sid: a.resourceSid,
          alert_text: a.alertText ? a.alertText.slice(0, 400) : null,
          request_url: a.requestUrl,
          request_method: a.requestMethod,
        })),
      });
    },
  );
}
