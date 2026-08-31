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
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: redact(
      error instanceof Error ? error.message : String(error),
    ),
  };
}
