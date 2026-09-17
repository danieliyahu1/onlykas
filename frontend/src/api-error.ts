export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiErrorBody {
  error?: string | undefined;
  message?: string | undefined;
  requestId?: string | undefined;
}

/**
 * The single place a failed response becomes a typed error, so JSON and upload
 * requests surface the same code, status, and correlation id.
 */
export function toApiError(
  status: number,
  body: ApiErrorBody | null,
  fallbackCode = "REQUEST_FAILED",
): ApiError {
  return new ApiError(
    body?.error ?? fallbackCode,
    body?.message ?? "The request could not be completed.",
    status,
    body?.requestId ?? undefined,
  );
}
