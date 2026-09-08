---
name: run-app-local
description: Use when the user asks to run, start, restart, or stop the onlykas app locally — booting the backend and frontend dev servers for local development.
---

# Run the app locally

The dev servers (backend + frontend) run indefinitely and must be started in a
persistent/background session (e.g. a PTY), never blocking on completion.

## Ports

| Service  | URL                      | Notes                        |
|----------|--------------------------|------------------------------|
| Frontend | http://localhost:5173    | Vite, proxies `/api` → 3000 |
| Backend  | http://localhost:3000    | Express API                  |

## Critical: load `.env` first

The `pnpm dev` script does **not** load `.env`. The backend reads
`process.env` directly and crashes with a ZodError if the variables are
missing (config lives in `backend/src/config.ts`). The `.env` file is at the
repo root.

Load it into the process environment **before** spawning the dev command (the
frontend/inheriting children pick it up from the env). For example, in
PowerShell:

```powershell
Get-Content $envFile |
  Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } |
  ForEach-Object { $kv = $_ -split '=',2; Set-Item -Path ('env:'+$kv[0].Trim()) -Value $kv[1].Trim('"') }
```

## Start

From the repo root, after loading `.env` into the shell environment:

```
pnpm dev
```

This runs `@onlykas/backend` and `@onlykas/frontend` in parallel.

Success checks — the backend is up when the log line

```
{"event":"server_started","port":3000}
```

appears, and the frontend when Vite prints `Local: http://localhost:5173/`.

## Troubleshooting

- **Backend exits with ZodError (missing env values)** → `.env` was not loaded
  before spawning the dev command. Reload it and restart.
- **Frontend proxy `ECONNREFUSED /api/...`** → backend crashed (investigate
  its logs) or is still building.

## Stop

Send an interrupt (Ctrl+C) to the dev session, or kill the session/process
tree running `pnpm dev`.