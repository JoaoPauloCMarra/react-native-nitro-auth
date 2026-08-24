#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const VALID_CODES = new Set([
  "refresh_failed",
  "cancelled",
  "interaction_required",
  "timeout",
  "popup_blocked",
  "network_error",
  "configuration_error",
  "not_signed_in",
  "operation_in_progress",
  "unsupported_provider",
  "invalid_state",
  "invalid_nonce",
  "token_error",
  "no_id_token",
  "parse_error",
  "unknown",
]);

const packageRoot = join(import.meta.dir, "..");
const sourcePath = join(packageRoot, "scripts", "oauth-errors.json");

function fail(message) {
  console.error(`generate-oauth-errors: ${message}`);
  process.exit(1);
}

function toScreamingSnake(value) {
  return value.toUpperCase();
}

function toCamelCase(value) {
  return value
    .split("_")
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
}

const raw = JSON.parse(readFileSync(sourcePath, "utf8"));
const entries = Object.entries(raw)
  .filter(([providerError]) => providerError.trim().length > 0)
  .map(([providerError, code]) => {
    if (typeof code !== "string" || !VALID_CODES.has(code)) {
      fail(`invalid AuthErrorCode "${String(code)}" for "${providerError}"`);
    }
    const normalizedProviderError = providerError.trim().toLowerCase();
    if (normalizedProviderError !== providerError) {
      fail(`provider error "${providerError}" must be lowercase and trimmed`);
    }
    return [normalizedProviderError, code];
  })
  .sort(([a], [b]) => a.localeCompare(b));

if (entries.length === 0) {
  fail("oauth-errors.json is empty");
}

function emitTypeScript() {
  const lines = entries.map(
    ([providerError, code]) => `  ${providerError}: "${code}",`,
  );
  return `// GENERATED FILE - DO NOT EDIT
// Source: scripts/oauth-errors.json
// Regenerate with: bun scripts/generate-oauth-errors.js
import type { AuthErrorCode } from "../Auth.nitro";

export const OAUTH_ERROR_CODES: Readonly<Record<string, AuthErrorCode>> = {
${lines.join("\n")}
};
`;
}

function emitKotlin() {
  const lines = entries.map(
    ([providerError, code]) =>
      `    "${providerError}" to AuthErrorCode.${toScreamingSnake(code)},`,
  );
  return `// GENERATED FILE - DO NOT EDIT
// Source: scripts/oauth-errors.json
// Regenerate with: bun scripts/generate-oauth-errors.js
package com.auth

internal val OAUTH_ERROR_CODES: Map<String, AuthErrorCode> = mapOf(
${lines.join("\n")}
)
`;
}

function emitSwift() {
  const lines = entries.map(
    ([providerError, code]) => `  "${providerError}": .${toCamelCase(code)},`,
  );
  return `// GENERATED FILE - DO NOT EDIT
// Source: scripts/oauth-errors.json
// Regenerate with: bun scripts/generate-oauth-errors.js
let oauthErrorCodes: [String: AuthErrorCode] = [
${lines.join("\n")}
]
`;
}

function writeGenerated(relativePath, content) {
  const targetPath = join(packageRoot, relativePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf8");
}

writeGenerated("src/generated/oauth-error-codes.ts", emitTypeScript());
writeGenerated(
  "android/src/main/java/com/auth/OAuthErrorCodes.kt",
  emitKotlin(),
);
writeGenerated("ios/GeneratedOAuthErrorCodes.swift", emitSwift());

console.log(
  `generate-oauth-errors: wrote ${entries.length} mappings to src/generated/oauth-error-codes.ts, android/src/main/java/com/auth/OAuthErrorCodes.kt, ios/GeneratedOAuthErrorCodes.swift`,
);
