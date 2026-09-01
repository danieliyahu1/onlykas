import { randomUUID } from "node:crypto";

const sensitiveKey =
  /authorization|cookie|secret|token|password|signature|transaction|payload|url/i;
const requestIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export type LogFields = Record<string, unknown>;
export type EventLogger = (event: string, fields?: LogFields) => void;

export function requestId(value: unknown): string {
  return typeof value === "string" && requestIdPattern.test(value)
    ? value
    : randomUUID();
}

export function redact(value: unknown, key?: string): unknown {
  if (key && sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string")
    return value
      .replace(/https?:\/\/[^\s]+/gi, "[URL_REDACTED]")
      .replace(
        /(authorization|cookie|signature|token|secret|password)\s*[:=]\s*[^\s,;}]+/gi,
        "$1=[REDACTED]",
      );
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redact(entryValue, entryKey),
      ]),
    );
  return value;
}

export const logEvent: EventLogger = (event, fields = {}) => {
  const redacted = redact(fields);
  console.log(
    JSON.stringify({
      event,
      ...(redacted && typeof redacted === "object" ? redacted : {}),
    }),
  );
};

export function safeError(error: unknown): LogFields {
  const details = error as {
    operation?: unknown;
    key?: unknown;
    category?: unknown;
    statusCode?: unknown;
    serviceCode?: unknown;
    requestId?: unknown;
    extendedRequestId?: unknown;
  };
  const cause = error instanceof Error ? error.cause : undefined;
  const causeDetails = (
    cause && typeof cause === "object" ? cause : {}
  ) as {
    name?: unknown;
    message?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: redact(
      error instanceof Error ? error.message : String(error),
    ),
    ...(typeof details.operation === "string"
      ? { storageOperation: details.operation }
      : {}),
    ...(typeof details.key === "string" ? { storageKey: details.key } : {}),
    ...(typeof details.category === "string"
      ? { storageCategory: details.category }
      : {}),
    ...(typeof details.statusCode === "number"
      ? { storageStatusCode: details.statusCode }
      : {}),
    ...(typeof details.serviceCode === "string"
      ? { storageServiceCode: details.serviceCode }
      : {}),
    ...(typeof details.requestId === "string"
      ? { storageRequestId: details.requestId }
      : {}),
    ...(typeof details.extendedRequestId === "string"
      ? { storageExtendedRequestId: details.extendedRequestId }
      : {}),
    ...(typeof causeDetails.name === "string"
      ? { storageCauseName: causeDetails.name }
      : {}),
    ...(typeof causeDetails.message === "string"
      ? { storageCauseMessage: redact(causeDetails.message) }
      : {}),
    ...(typeof causeDetails.Code === "string"
      ? { storageCauseCode: causeDetails.Code }
      : {}),
    ...(typeof causeDetails.$metadata?.httpStatusCode === "number"
      ? { storageCauseStatusCode: causeDetails.$metadata.httpStatusCode }
      : {}),
  };
}
