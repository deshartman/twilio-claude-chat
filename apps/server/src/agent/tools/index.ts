import { buildListAccountsTool } from "./accounts.js";
import {
  buildListPhoneNumbersTool,
  buildFetchPhoneNumberTool,
  buildSearchAvailableNumbersTool,
  buildUpdatePhoneNumberConfigTool,
  buildBuyPhoneNumberTool,
  buildReleasePhoneNumberTool,
} from "./numbers.js";
import {
  buildListCallsTool,
  buildFetchCallLogTool,
  buildListMessagesTool,
  buildFetchDebuggerEventsTool,
} from "./logs.js";
import {
  buildListMessagingServicesTool,
  buildFetchMessagingServiceTool,
  buildCreateMessagingServiceTool,
  buildAddSenderToMessagingServiceTool,
  buildListConversationsTool,
} from "./messaging.js";
import {
  buildListRegulatoryBundlesTool,
  buildListAddressesTool,
  buildCreateAddressTool,
  buildBulkAssignBundleTool,
} from "./bundles.js";

export function buildAllTools(userId: string, activeAccountId: string | null) {
  return [
    // Accounts (read)
    buildListAccountsTool(userId),
    // Numbers (read)
    buildListPhoneNumbersTool(userId, activeAccountId),
    buildFetchPhoneNumberTool(userId, activeAccountId),
    buildSearchAvailableNumbersTool(userId, activeAccountId),
    // Numbers (write — confirmation-gated)
    buildUpdatePhoneNumberConfigTool(userId, activeAccountId),
    buildBuyPhoneNumberTool(userId, activeAccountId),
    buildReleasePhoneNumberTool(userId, activeAccountId),
    // Logs (read)
    buildListCallsTool(userId, activeAccountId),
    buildFetchCallLogTool(userId, activeAccountId),
    buildListMessagesTool(userId, activeAccountId),
    buildFetchDebuggerEventsTool(userId, activeAccountId),
    // Messaging (read)
    buildListMessagingServicesTool(userId, activeAccountId),
    buildFetchMessagingServiceTool(userId, activeAccountId),
    buildListConversationsTool(userId, activeAccountId),
    // Messaging (write — confirmation-gated)
    buildCreateMessagingServiceTool(userId, activeAccountId),
    buildAddSenderToMessagingServiceTool(userId, activeAccountId),
    // Regulatory bundles + addresses (read)
    buildListRegulatoryBundlesTool(userId, activeAccountId),
    buildListAddressesTool(userId, activeAccountId),
    // Regulatory bundles + addresses (write — confirmation-gated)
    buildCreateAddressTool(userId, activeAccountId),
    buildBulkAssignBundleTool(userId, activeAccountId),
  ];
}
