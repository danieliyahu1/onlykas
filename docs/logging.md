# Logging

OnlyKas emits structured, single-line JSON logs from both the backend and the
browser client. Logs serve two purposes:

1. **Operational visibility** — what the app is doing while it runs.
2. **Debugging** — enough detail to reconstruct a failure after the fact.

## Levels

| Level   | Purpose                                              | Backend stream | Frontend |
| ------- | ---------------------------------------------------- | -------------- | -------- |
| `debug` | Detailed internals, only useful when investigating a specific bug. | stdout | dev builds only |
| `info`  | Normal lifecycle events worth seeing while running.  | stdout         | dev builds only |
| `warn`  | Recoverable or expected-failure situations.          | stderr         | always   |
| `error` | Failures that need attention.                        | stderr         | always   |

Backend verbosity is controlled by `LOG_LEVEL` (default `debug` outside
production, `info` in production). Events below the configured level are
dropped before serialization.

## Event shape

Every log line is JSON with a stable envelope:

```json
{ "timestamp": "2026-01-01T00:00:00.000Z", "level": "info", "event": "server_started", "port": 3000 }
```

- `event` is a stable, snake_case identifier (e.g. `request_completed`,
  `payment_submitted`). Prefer filtering on `event` over free-text messages.
- Additional fields are flattened onto the same object.
- Backend requests carry a `requestId` (from `X-Request-Id`, generated when
  absent) that is echoed back in the `X-Request-Id` response header so the
  browser can correlate its logs with the server.

## Redaction

Both loggers recursively redact fields whose key looks sensitive
(`authorization`, `cookie`, `secret`, `token`, `password`, `signature`,
`transaction`, `payload`, `url`) and strip URLs from string values. Never log
raw signed transactions, session cookies, or full request URLs.

Addresses are only logged in shortened form (`shortenAddress`).

## Conventions

- Keep `info` lines low-volume and meaningful; put high-volume detail at
  `debug`.
- Include identifiers (`requestId`, `postId`, `transactionIdPrefix`,
  `covenantIdPrefix`) rather than full payloads.
- Use `safeError(error)` for unexpected failures so error name, message, stack,
  and structured storage/cause details are preserved.

## Where to look

- Backend logger: `backend/src/observability.ts` (`createLogger`).
- Frontend logger: `frontend/src/logger.ts`.
- Request logging middleware: `backend/src/app.ts`.
