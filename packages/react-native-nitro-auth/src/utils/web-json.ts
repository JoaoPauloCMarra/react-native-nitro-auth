import type { AuthProvider } from "../Auth.nitro";

export type JsonObject = Record<string, unknown>;

export const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null;

export const isAuthProvider = (value: unknown): value is AuthProvider =>
  value === "google" || value === "apple" || value === "microsoft";

export const getOptionalString = (
  source: JsonObject,
  key: string,
): string | undefined => {
  const candidate = source[key];
  return typeof candidate === "string" ? candidate : undefined;
};

export const getOptionalNumber = (
  source: JsonObject,
  key: string,
): number | undefined => {
  const candidate = source[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
};

export function setIfDefined<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

export function setOrDelete<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value === undefined) {
    delete target[key];
    return;
  }

  target[key] = value;
}
