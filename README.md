# OnlyKas

OnlyKas is a testnet-10 paid-media application. Creators authenticate with Kasware, upload private media directly to R2, and publish immutable Turso-backed posts.

## Development

Requirements: Node 24 and pnpm 11.17.

```bash
pnpm install
pnpm dev
```

Copy the values described in `.env.example` into the process environment before starting the backend. The Vite server runs the browser application and proxies `/api` to Express.

## R2

The configured bucket must have public access disabled. Configure CORS to allow only `PUBLIC_ORIGIN`, the `PUT` method, and the `Content-Type` header. Expose `ETag` so the browser can complete multipart uploads. No browser principal should have read or list access.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` runs Vitest unit/component/integration tests and Playwright on desktop and mobile Chromium viewports.

## Production

The production image builds all workspaces and runs one Express process. Express serves the Vite bundle and all API and protected-media routes from one origin.

```bash
docker build -t onlykas .
docker run --env-file .env -p 3000:3000 onlykas
```
