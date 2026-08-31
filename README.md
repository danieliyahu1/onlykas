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

## Kubernetes deployment

The manifests in `deploy/` target the `onlykas` namespace and an nginx Ingress. Replace the example hostname in `deploy/configmap.yaml` and `deploy/ingress.yaml` with the real public origin before deploying.

Create the runtime Secret outside Git:

```bash
kubectl apply -f deploy/namespace.yaml
kubectl -n onlykas create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username='<github-user>' \
  --docker-password='<github-token-with-read-packages>'
kubectl -n onlykas create secret generic onlykas-secrets \
  --from-literal=DATABASE_URL='libsql://...' \
  --from-literal=DATABASE_AUTH_TOKEN='...' \
  --from-literal=R2_ENDPOINT='https://...r2.cloudflarestorage.com' \
  --from-literal=R2_ACCESS_KEY_ID='...' \
  --from-literal=R2_SECRET_ACCESS_KEY='...'
```

The GitHub Actions workflow verifies the repository, publishes `linux/arm64` images tagged with the commit SHA to GHCR, and deploys them on pushes to `main`. Configure the repository `KUBE_CONFIG` secret for the target cluster.
