import { buildTwilioClient } from "./context.js";
import { cachedTwilioCall } from "./cache/registry.js";
import { setScanStatus } from "../accounts/repo.js";
import { pool } from "../db/pool.js";
import { runBounded, JobTimeoutError } from "../util/bounded.js";

const PHONE_NUMBER_TTL_MS = 5 * 60 * 1000;
const MESSAGING_SERVICE_TTL_MS = 5 * 60 * 1000;
const PER_SERVICE_TIMEOUT_MS = 10_000;

type Logger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

type PrescanSummary = {
  phone_numbers: number;
  messaging_services: number;
  services_scanned: number;
  services_failed: number;
};

/**
 * Warm the resource_cache for a freshly-added (or re-scanned) account.
 *
 * Phase 1 — summary lists (always, in parallel):
 *   - incomingPhoneNumbers.list
 *   - messaging.v1.services.list
 *
 * Phase 2 — per-service dig, only runs when phase 1 returned services.
 *   For each service: svc.fetch + svc.phoneNumbers.list, cached as
 *   resourceType="messaging_service" keyed by service_sid. Bounded parallelism.
 *
 * All writes go through cachedTwilioCall so concurrent user tool calls
 * (single-flight) coalesce against the same in-flight promise — the user's
 * concurrency concern is handled one layer down.
 */
export async function runPrescan(
  userId: string,
  accountId: string,
  log: Logger,
): Promise<PrescanSummary> {
  log.info({ accountId, phase: "start" }, "prescan starting");
  await setScanStatus(userId, accountId, "running");

  try {
    const client = await buildTwilioClient(userId, accountId);

    // Phase 1 — summary lists, parallel.
    const [phoneNumbers, messagingServices] = await Promise.all([
      cachedTwilioCall(
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
          }));
        },
      ),
      cachedTwilioCall(
        { userId, accountId, resourceType: "messaging_services" },
        MESSAGING_SERVICE_TTL_MS,
        async () => {
          const list = await client.messaging.v1.services.list({ limit: 100 });
          return list.map((s) => ({
            sid: s.sid,
            friendly_name: s.friendlyName,
            inbound_request_url: s.inboundRequestUrl,
            inbound_method: s.inboundMethod,
            status_callback: s.statusCallback,
            use_case: s.usecase,
            us_app_to_person_registered: s.usAppToPersonRegistered,
            date_created: s.dateCreated,
          }));
        },
      ),
    ]);

    log.info(
      {
        accountId,
        phase: "summary-complete",
        phone_numbers: phoneNumbers.length,
        messaging_services: messagingServices.length,
      },
      "prescan phase 1 complete",
    );

    // Phase 2 — early exit if nothing to dig into.
    if (messagingServices.length === 0) {
      log.info({ accountId, phase: "skip-deep" }, "no messaging services — skipping deep scan");
      await setScanStatus(userId, accountId, "ready");
      return {
        phone_numbers: phoneNumbers.length,
        messaging_services: 0,
        services_scanned: 0,
        services_failed: 0,
      };
    }

    // Build per-service fetch jobs. Each writes to the resource_cache via
    // cachedTwilioCall so a concurrent user tool call coalesces.
    const serviceJobs = messagingServices.map((svc) => async () => {
      return cachedTwilioCall(
        {
          userId,
          accountId,
          resourceType: "messaging_service",
          query: { service_sid: svc.sid },
        },
        MESSAGING_SERVICE_TTL_MS,
        async () => {
          const s = client.messaging.v1.services(svc.sid);
          const [service, phoneNumbers] = await Promise.all([
            s.fetch(),
            s.phoneNumbers.list({ limit: 100 }),
          ]);
          return {
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
          };
        },
      );
    });

    const results = await runBounded(serviceJobs, 10, {
      timeoutMs: PER_SERVICE_TIMEOUT_MS,
    });
    const failures = results.filter((r) => !r.ok);
    const timedOut = failures.filter(
      (r) => !r.ok && r.error instanceof JobTimeoutError,
    ).length;
    if (failures.length > 0) {
      log.warn(
        {
          accountId,
          phase: "deep-partial",
          failed: failures.length,
          timed_out: timedOut,
          total: results.length,
        },
        "prescan deep phase had failures",
      );
    }

    await setScanStatus(userId, accountId, "ready");
    log.info({ accountId, phase: "ready" }, "prescan complete");
    return {
      phone_numbers: phoneNumbers.length,
      messaging_services: messagingServices.length,
      services_scanned: results.length - failures.length,
      services_failed: failures.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ accountId, err: msg }, "prescan failed");
    await setScanStatus(userId, accountId, "failed", msg.slice(0, 500));
    throw err;
  }
}

/**
 * Re-scan an account: drop its cached rows, then run prescan.
 * Used by POST /api/accounts/:id/rescan.
 */
export async function rescanAccount(
  userId: string,
  accountId: string,
  log: Logger,
): Promise<PrescanSummary> {
  await pool.query(
    `DELETE FROM resource_cache WHERE account_id = $1 AND user_id = $2`,
    [accountId, userId],
  );
  return runPrescan(userId, accountId, log);
}
