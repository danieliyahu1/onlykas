/// <reference types="vite/client" />

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const sensitiveKey =
  /authorization|cookie|secret|token|password|signature|transaction|payload|url/i;
const development = import.meta.env.DEV;

function redact(value: unknown, key?: string): unknown {
  if (key && sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string")
    return value.replace(/https?:\/\/[^\s]+/gi, "[URL_REDACTED]");
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

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  const redacted = redact(fields);
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(redacted && typeof redacted === "object" ? redacted : {}),
  });
  if (level === "warn") console.warn(line);
  else if (level === "error") console.error(line);
  else console.info(line);
}

export interface Logger {
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
}

export const logger: Logger = {
  debug(event, fields) {
    if (development) emit("debug", event, fields);
  },
  info(event, fields) {
    if (development) emit("info", event, fields);
  },
  warn(event, fields) {
    emit("warn", event, fields);
  },
  error(event, fields) {
    emit("error", event, fields);
  },
};
