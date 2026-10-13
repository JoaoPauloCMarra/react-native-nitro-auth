import type { AuthErrorCode } from "../Auth.nitro";

export class AuthWebError extends Error {
  public readonly code: AuthErrorCode;
  public readonly underlyingError: string | undefined;

  constructor(message: AuthErrorCode, underlyingError?: string) {
    super(message);
    this.name = "AuthWebError";
    this.code = message;
    this.underlyingError = underlyingError;
  }
}

export const getSafeErrorCategory = (error: unknown): string => {
  try {
    if (error instanceof AuthWebError) {
      return error.code;
    }
    if (error instanceof Error) {
      const name = error.name;
      switch (name) {
        case "AbortError":
        case "InvalidStateError":
        case "NetworkError":
        case "NotAllowedError":
        case "NotReadableError":
        case "QuotaExceededError":
        case "SecurityError":
        case "TimeoutError":
          return name;
        default:
          return "Error";
      }
    }
  } catch {
    return "UnknownError";
  }
  return "UnknownError";
};
