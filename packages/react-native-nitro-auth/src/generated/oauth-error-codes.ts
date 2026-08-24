// GENERATED FILE - DO NOT EDIT
// Source: scripts/oauth-errors.json
// Regenerate with: bun scripts/generate-oauth-errors.js
import type { AuthErrorCode } from "../Auth.nitro";

export const OAUTH_ERROR_CODES: Readonly<Record<string, AuthErrorCode>> = {
  access_denied: "cancelled",
  consent_required: "interaction_required",
  interaction_required: "interaction_required",
  invalid_client: "configuration_error",
  invalid_grant: "token_error",
  invalid_request: "token_error",
  invalid_scope: "configuration_error",
  invalid_token: "token_error",
  login_required: "interaction_required",
  popup_closed_by_user: "cancelled",
  server_error: "network_error",
  temporarily_unavailable: "network_error",
  unauthorized_client: "configuration_error",
  user_cancelled: "cancelled",
};
