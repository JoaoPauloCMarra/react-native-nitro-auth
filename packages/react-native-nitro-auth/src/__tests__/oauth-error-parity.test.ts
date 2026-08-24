import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OAUTH_ERROR_CODES } from "../generated/oauth-error-codes";
import type { AuthErrorCode } from "../Auth.nitro";

type Mapping = Record<string, AuthErrorCode>;

const packageRoot = join(__dirname, "..", "..");
const sourcePath = join(packageRoot, "scripts", "oauth-errors.json");
const kotlinPath = join(
  packageRoot,
  "android/src/main/java/com/auth/OAuthErrorCodes.kt",
);
const swiftPath = join(packageRoot, "ios/GeneratedOAuthErrorCodes.swift");

function readUtf8(path: string): string {
  return readFileSync(path, "utf8");
}

function parseKotlinTable(content: string): Mapping {
  const result: Mapping = {};
  const pattern = /"([a-z_]+)"\s*to\s*AuthErrorCode\.([A-Z_]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const providerError = match[1];
    const code = match[2];
    if (providerError === undefined || code === undefined) continue;
    result[providerError] = code.toLowerCase() as AuthErrorCode;
  }
  return result;
}

function camelToSnake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function parseSwiftTable(content: string): Mapping {
  const result: Mapping = {};
  const pattern = /"([a-z_]+)"\s*:\s*\.([a-zA-Z]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const providerError = match[1];
    const code = match[2];
    if (providerError === undefined || code === undefined) continue;
    result[providerError] = camelToSnake(code) as AuthErrorCode;
  }
  return result;
}

describe("oauth error mapping parity", () => {
  const source = JSON.parse(readUtf8(sourcePath)) as Mapping;
  const sourceEntries = Object.entries(source).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  it("has a non-empty canonical source", () => {
    expect(sourceEntries.length).toBeGreaterThan(0);
  });

  it("exports the generated TypeScript table matching the source", () => {
    expect({ ...OAUTH_ERROR_CODES }).toEqual(Object.fromEntries(sourceEntries));
  });

  it("generates a Kotlin table matching the source", () => {
    const kotlinTable = parseKotlinTable(readUtf8(kotlinPath));
    expect(Object.keys(kotlinTable).sort((a, b) => a.localeCompare(b))).toEqual(
      sourceEntries.map(([providerError]) => providerError),
    );
    for (const [providerError, code] of sourceEntries) {
      expect(kotlinTable[providerError]).toBe(code);
    }
  });

  it("generates a Swift table matching the source", () => {
    const swiftTable = parseSwiftTable(readUtf8(swiftPath));
    expect(Object.keys(swiftTable).sort((a, b) => a.localeCompare(b))).toEqual(
      sourceEntries.map(([providerError]) => providerError),
    );
    for (const [providerError, code] of sourceEntries) {
      expect(swiftTable[providerError]).toBe(code);
    }
  });
});
