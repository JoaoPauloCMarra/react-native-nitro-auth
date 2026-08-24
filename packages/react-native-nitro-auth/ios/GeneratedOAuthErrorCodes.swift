// GENERATED FILE - DO NOT EDIT
// Source: scripts/oauth-errors.json
// Regenerate with: bun scripts/generate-oauth-errors.js
let oauthErrorCodes: [String: AuthErrorCode] = [
  "access_denied": .cancelled,
  "consent_required": .interactionRequired,
  "interaction_required": .interactionRequired,
  "invalid_client": .configurationError,
  "invalid_grant": .tokenError,
  "invalid_request": .tokenError,
  "invalid_scope": .configurationError,
  "invalid_token": .tokenError,
  "login_required": .interactionRequired,
  "popup_closed_by_user": .cancelled,
  "server_error": .networkError,
  "temporarily_unavailable": .networkError,
  "unauthorized_client": .configurationError,
  "user_cancelled": .cancelled,
]
