import { ApiError } from "./api-error.js";

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
