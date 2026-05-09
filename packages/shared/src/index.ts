export type TwilioAccountSummary = {
  id: string;
  friendly_name: string;
  account_sid: string;
  is_subaccount: boolean;
  parent_account_id: string | null;
  created_at: string;
  last_used_at: string | null;
};

export type ChatSessionSummary = {
  id: string;
  title: string | null;
  active_twilio_account_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ToolConfirmRequest = {
  type: "confirm_request";
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  summary: string;
};

export type ToolConfirmResponse = {
  type: "confirm_response";
  tool_use_id: string;
  allow: boolean;
};

export type WsClientMessage =
  | { type: "user_message"; chat_session_id: string | null; prompt: string; active_twilio_account_id: string | null }
  | ToolConfirmResponse;

export type WsServerMessage =
  | { type: "assistant_text_delta"; text: string }
  | { type: "tool_use_started"; tool_use_id: string; tool_name: string; input: Record<string, unknown> }
  | { type: "tool_use_result"; tool_use_id: string; result: unknown }
  | ToolConfirmRequest
  | { type: "turn_complete"; chat_session_id: string }
  | { type: "error"; message: string };
