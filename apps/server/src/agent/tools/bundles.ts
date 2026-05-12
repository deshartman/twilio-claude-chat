import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { buildTwilioClient, resolveAccountHint } from "../context.js";
import { notFoundOrAmbiguous, textResult } from "./_resolve.js";
import { cachedTwilioCall, invalidateCache } from "../cache/registry.js";
import { runBounded } from "../../util/bounded.js";

const BUNDLE_TTL_MS = 5 * 60 * 1000;
const ADDRESS_TTL_MS = 5 * 60 * 1000;
const BULK_ASSIGN_CAP = 200;
const BULK_ASSIGN_DEFAULT_CONCURRENCY = 4;
const BULK_ASSIGN_MAX_CONCURRENCY = 8;
const PER_UPDATE_TIMEOUT_MS = 15_000;

const BUNDLE_STATUS = z.enum([
  "draft",
  "pending-review",
  "in-review",
  "twilio-rejected",
  "twilio-approved",
  "provisionally-approved",
]);

type CachedBundle = {
  sid: string;
  friendly_name: string | null;
  status: string;
  iso_country: string | null;
  number_type: string | null;
  end_user_type: string | null;
  valid_until: string | null;
  date_created: string | null;
};

export function buildListRegulatoryBundlesTool(userId: string, activeAccountId: string | null) {
  return tool(
    "list_regulatory_bundles",
    "List Regulatory Compliance bundles on a Twilio account. Optionally filter by status (e.g. 'twilio-approved') or ISO country (e.g. 'AU', 'DE'). Use this to find the bundle_sid you want to assign to phone numbers.",
    {
      account_hint: z.string().optional(),
      status: BUNDLE_STATUS.optional(),
      iso_country: z.string().length(2).optional().describe("ISO-3166-1 alpha-2 country code such as 'AU', 'DE', 'GB'."),
    },
    async ({ account_hint, status, iso_country }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      const bundles = await cachedTwilioCall<CachedBundle[]>(
        {
          userId,
          accountId: resolved.account.id,
          resourceType: "regulatory_bundles",
          query: { status, iso_country },
        },
        BUNDLE_TTL_MS,
        async () => {
          const list = await client.numbers.v2.regulatoryCompliance.bundles.list({
            status,
            isoCountry: iso_country,
            limit: 1000,
          });
          // The SDK's BundleInstance type omits iso_country / number_type /
          // end_user_type, but the API returns them. Cast to read through.
          return list.map((b) => {
            const extra = b as unknown as {
              isoCountry?: string | null;
              numberType?: string | null;
              endUserType?: string | null;
            };
            return {
              sid: b.sid,
              friendly_name: b.friendlyName ?? null,
              status: b.status,
              iso_country: extra.isoCountry ?? null,
              number_type: extra.numberType ?? null,
              end_user_type: extra.endUserType ?? null,
              valid_until: b.validUntil ? b.validUntil.toISOString() : null,
              date_created: b.dateCreated ? b.dateCreated.toISOString() : null,
            };
          });
        },
      );

      return textResult({
        account: {
          friendly_name: resolved.account.friendly_name,
          account_sid: resolved.account.account_sid,
        },
        count: bundles.length,
        bundles,
      });
    },
  );
}

type CachedAddress = {
  sid: string;
  friendly_name: string | null;
  customer_name: string | null;
  iso_country: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  street: string | null;
};

export function buildListAddressesTool(userId: string, activeAccountId: string | null) {
  return tool(
    "list_addresses",
    "List Address resources on a Twilio account. Addresses (AD...) are required alongside bundles for many regulatory flows — e.g. AU toll-free numbers need both a bundle and an address assigned. Use this to find an address_sid by friendly_name or country.",
    {
      account_hint: z.string().optional(),
      iso_country: z.string().length(2).optional().describe("Filter to addresses in a specific ISO-3166-1 alpha-2 country, e.g. 'AU'."),
    },
    async ({ account_hint, iso_country }) => {
      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      const addresses = await cachedTwilioCall<CachedAddress[]>(
        {
          userId,
          accountId: resolved.account.id,
          resourceType: "addresses",
          query: { iso_country },
        },
        ADDRESS_TTL_MS,
        async () => {
          const list = await client.addresses.list({ limit: 1000 });
          return list
            .filter((a) => !iso_country || a.isoCountry === iso_country)
            .map((a) => ({
              sid: a.sid,
              friendly_name: a.friendlyName ?? null,
              customer_name: a.customerName ?? null,
              iso_country: a.isoCountry ?? null,
              city: a.city ?? null,
              region: a.region ?? null,
              postal_code: a.postalCode ?? null,
              street: a.street ?? null,
            }));
        },
      );

      return textResult({
        account: {
          friendly_name: resolved.account.friendly_name,
          account_sid: resolved.account.account_sid,
        },
        count: addresses.length,
        addresses,
      });
    },
  );
}

export function buildCreateAddressTool(userId: string, activeAccountId: string | null) {
  return tool(
    "create_address",
    "Create an Address resource on a Twilio account for regulatory or emergency-calling use. REQUIRES HUMAN CONFIRMATION. For new Regulatory Bundles, direct the user to the Twilio Console (file uploads are required) — this tool only creates addresses.",
    {
      account_hint: z.string().optional(),
      customer_name: z.string().describe("The name associated with the address (person or business)."),
      street: z.string(),
      city: z.string(),
      region: z.string().describe("State, province, or region."),
      postal_code: z.string(),
      iso_country: z.string().length(2).describe("ISO-3166-1 alpha-2, e.g. 'AU', 'DE', 'GB'."),
      friendly_name: z.string().optional().describe("Descriptive label (up to 64 chars for regulatory use)."),
      street_secondary: z.string().optional().describe("Apartment, suite, unit, etc."),
      emergency_enabled: z.boolean().optional().describe("Enable emergency calling on this address. Default false."),
    },
    async (input) => {
      const { account_hint, customer_name, street, city, region, postal_code, iso_country, friendly_name, street_secondary, emergency_enabled } = input;

      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);
      const created = await client.addresses.create({
        customerName: customer_name,
        street,
        city,
        region,
        postalCode: postal_code,
        isoCountry: iso_country,
        friendlyName: friendly_name,
        streetSecondary: street_secondary,
        emergencyEnabled: emergency_enabled,
      });

      await invalidateCache(resolved.account.id, ["addresses"]);

      return textResult({
        account: {
          friendly_name: resolved.account.friendly_name,
          account_sid: resolved.account.account_sid,
        },
        address: {
          sid: created.sid,
          friendly_name: created.friendlyName ?? null,
          customer_name: created.customerName ?? null,
          iso_country: created.isoCountry ?? null,
          city: created.city ?? null,
          region: created.region ?? null,
          postal_code: created.postalCode ?? null,
          street: created.street ?? null,
          emergency_enabled: created.emergencyEnabled ?? null,
        },
      });
    },
  );
}

type BulkAssignResult = {
  account: { friendly_name: string; account_sid: string };
  bundle_sid: string;
  address_sid: string | null;
  attempted: number;
  succeeded: number;
  failed: Array<{ sid: string; phone_number: string | null; error: string }>;
  unchanged: Array<{ sid: string; phone_number: string | null }>;
  updated: Array<{ sid: string; phone_number: string | null }>;
};

export function buildBulkAssignBundleTool(userId: string, activeAccountId: string | null) {
  return tool(
    "bulk_assign_bundle_to_numbers",
    `Assign an already-approved Regulatory Bundle SID to many phone numbers in one call. REQUIRES HUMAN CONFIRMATION. Provide the bundle_sid plus one of: phone_number_sids (PN…), phone_numbers (E.164), or a filter. Optionally also assign an address_sid in the same call — some number types (e.g. AU toll-free) require BOTH a bundle and an address. Max ${BULK_ASSIGN_CAP} numbers per call. The bundle must be in 'twilio-approved' status.`,
    {
      account_hint: z.string().optional(),
      bundle_sid: z.string().startsWith("BU").describe("Regulatory Bundle SID. Must already be twilio-approved."),
      address_sid: z
        .string()
        .startsWith("AD")
        .optional()
        .describe("Optional Address SID to assign in the same update. Required alongside bundle_sid for number types like AU toll-free."),
      phone_number_sids: z.array(z.string().startsWith("PN")).optional(),
      phone_numbers: z.array(z.string()).optional().describe("E.164 numbers; resolved to SIDs from the cached number list."),
      filter: z
        .object({
          country_code: z.string().optional().describe("E.164 country prefix such as '+61' for AU."),
          missing_bundle_only: z.boolean().optional().describe("If true, only numbers whose bundle_sid is null are targeted."),
        })
        .optional(),
      concurrency: z
        .number()
        .min(1)
        .max(BULK_ASSIGN_MAX_CONCURRENCY)
        .default(BULK_ASSIGN_DEFAULT_CONCURRENCY),
    },
    async (input) => {
      const { account_hint, bundle_sid, address_sid, phone_number_sids, phone_numbers, filter, concurrency } = input;

      // Exactly-one-input check.
      const providedCount = [phone_number_sids?.length, phone_numbers?.length, filter ? 1 : 0].filter(
        (n) => n && n > 0,
      ).length;
      if (providedCount !== 1) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: "Provide exactly one of: phone_number_sids, phone_numbers, or filter.",
            },
          ],
        };
      }

      const resolved = await resolveAccountHint(userId, account_hint, activeAccountId);
      const err = notFoundOrAmbiguous(resolved, account_hint);
      if (err) return err;
      if (resolved.kind !== "resolved") return err!;

      const client = await buildTwilioClient(userId, resolved.account.id);

      // 1. Validate bundle: must exist and be twilio-approved.
      let bundleStatus: string;
      try {
        const b = await client.numbers.v2.regulatoryCompliance.bundles(bundle_sid).fetch();
        bundleStatus = b.status;
      } catch (e) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Bundle "${bundle_sid}" could not be fetched: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
        };
      }
      if (bundleStatus !== "twilio-approved") {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Bundle "${bundle_sid}" has status "${bundleStatus}". Only twilio-approved bundles can be assigned; get it approved first.`,
            },
          ],
        };
      }

      // 1b. If an address_sid was provided, validate it exists on the account.
      if (address_sid) {
        try {
          await client.addresses(address_sid).fetch();
        } catch (e) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Address "${address_sid}" could not be fetched: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
          };
        }
      }

      // 2. Resolve the target list of numbers against the cached phone-number list.
      const cachedNumbers = await client.incomingPhoneNumbers.list({ limit: 1000 });
      const byPhone = new Map<string, typeof cachedNumbers[number]>();
      const bySid = new Map<string, typeof cachedNumbers[number]>();
      for (const n of cachedNumbers) {
        if (n.phoneNumber) byPhone.set(n.phoneNumber, n);
        bySid.set(n.sid, n);
      }

      let targets: Array<{
        sid: string;
        phoneNumber: string | null;
        currentBundle: string | null;
        currentAddress: string | null;
      }>;
      if (phone_number_sids && phone_number_sids.length > 0) {
        const unknown: string[] = [];
        targets = phone_number_sids.map((sid) => {
          const n = bySid.get(sid);
          if (!n) {
            unknown.push(sid);
            return { sid, phoneNumber: null, currentBundle: null, currentAddress: null };
          }
          return {
            sid,
            phoneNumber: n.phoneNumber ?? null,
            currentBundle: (n as { bundleSid?: string | null }).bundleSid ?? null,
            currentAddress: n.addressSid ?? null,
          };
        });
        if (unknown.length > 0) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `These SIDs are not in the account: ${unknown.join(", ")}`,
              },
            ],
          };
        }
      } else if (phone_numbers && phone_numbers.length > 0) {
        const unknown: string[] = [];
        targets = phone_numbers.map((e164) => {
          const n = byPhone.get(e164);
          if (!n) {
            unknown.push(e164);
            return { sid: "", phoneNumber: e164, currentBundle: null, currentAddress: null };
          }
          return {
            sid: n.sid,
            phoneNumber: n.phoneNumber ?? e164,
            currentBundle: (n as { bundleSid?: string | null }).bundleSid ?? null,
            currentAddress: n.addressSid ?? null,
          };
        });
        if (unknown.length > 0) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `These numbers are not in the account: ${unknown.join(", ")}`,
              },
            ],
          };
        }
      } else {
        // filter branch
        const cc = filter?.country_code;
        const missingOnly = filter?.missing_bundle_only ?? false;
        targets = cachedNumbers
          .filter((n) => {
            if (cc && !(n.phoneNumber ?? "").startsWith(cc)) return false;
            const current = (n as { bundleSid?: string | null }).bundleSid ?? null;
            if (missingOnly && current) return false;
            return true;
          })
          .map((n) => ({
            sid: n.sid,
            phoneNumber: n.phoneNumber ?? null,
            currentBundle: (n as { bundleSid?: string | null }).bundleSid ?? null,
            currentAddress: n.addressSid ?? null,
          }));
      }

      if (targets.length === 0) {
        return textResult({
          account: {
            friendly_name: resolved.account.friendly_name,
            account_sid: resolved.account.account_sid,
          },
          bundle_sid,
          address_sid: address_sid ?? null,
          attempted: 0,
          succeeded: 0,
          failed: [],
          unchanged: [],
          updated: [],
          note: "No phone numbers matched the input.",
        });
      }

      if (targets.length > BULK_ASSIGN_CAP) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Refusing to update ${targets.length} numbers in one call (cap: ${BULK_ASSIGN_CAP}). Split the batch — e.g. narrow the filter or pass smaller phone_number_sids arrays.`,
            },
          ],
        };
      }

      // 3. Split already-correct numbers from the ones we actually need to write.
      // "Already correct" means: bundle matches AND (no address requested OR address matches).
      const unchanged: Array<{ sid: string; phone_number: string | null }> = [];
      const toUpdate: typeof targets = [];
      for (const t of targets) {
        const bundleMatches = t.currentBundle === bundle_sid;
        const addressMatches = !address_sid || t.currentAddress === address_sid;
        if (bundleMatches && addressMatches) {
          unchanged.push({ sid: t.sid, phone_number: t.phoneNumber });
        } else {
          toUpdate.push(t);
        }
      }

      // 4. Run the updates under a concurrency cap.
      const updatePayload: { bundleSid: string; addressSid?: string } = { bundleSid: bundle_sid };
      if (address_sid) updatePayload.addressSid = address_sid;
      const jobs = toUpdate.map(
        (t) => async () => {
          await client.incomingPhoneNumbers(t.sid).update(updatePayload);
          return { sid: t.sid, phone_number: t.phoneNumber };
        },
      );
      const results = await runBounded(jobs, concurrency, { timeoutMs: PER_UPDATE_TIMEOUT_MS });

      const updated: Array<{ sid: string; phone_number: string | null }> = [];
      const failed: Array<{ sid: string; phone_number: string | null; error: string }> = [];
      results.forEach((r, i) => {
        const t = toUpdate[i];
        if (r.ok) {
          updated.push(r.value);
        } else {
          const msg = r.error instanceof Error ? r.error.message : String(r.error);
          failed.push({ sid: t.sid, phone_number: t.phoneNumber, error: msg });
        }
      });

      // 5. Invalidate caches so the new bundle_sid shows up in subsequent reads.
      if (updated.length > 0) {
        await invalidateCache(resolved.account.id, ["phone_numbers", "phone_number"]);
      }

      const result: BulkAssignResult = {
        account: {
          friendly_name: resolved.account.friendly_name,
          account_sid: resolved.account.account_sid,
        },
        bundle_sid,
        address_sid: address_sid ?? null,
        attempted: toUpdate.length,
        succeeded: updated.length,
        failed,
        unchanged,
        updated,
      };
      return textResult(result);
    },
  );
}
