import { ApiError } from "./api-error.js";
import { WalletNetworkError } from "./kasware.js";

/**
 * A wrong network is not a failure: the switching action already told the user.
 * Callers use this to end quietly instead of repeating the notice as an error.
 */
export function isNetworkRequired(error: unknown): boolean {
  return error instanceof WalletNetworkError;
}

/**
 * User-facing error text. Server faults carry a short reference so a report can
 * be traced back to a request; user errors do not.
 */
export function errorText(error: unknown, fallback: string): string {
  const message =
    error instanceof Error && error.message ? error.message : fallback;
  if (error instanceof ApiError && error.status >= 500 && error.requestId) {
    return `${message} (ref: ${error.requestId.slice(0, 8)})`;
  }
  return message;
}
