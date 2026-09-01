# OnlyKas

OnlyKas is a testnet-10 paid-media application. Creators authenticate with Kasware, upload private media directly to R2, and publish immutable Turso-backed posts.

Live app: https://onlykas.danieliyahu.com/

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

Development and production must use separate stateful resources. Local development uses the `onlykas` Turso database and the `onlykas-development` R2 bucket. Production uses the `onlykas-production` Turso database and the `onlykas-production` R2 bucket. Do not share database credentials or bucket-scoped R2 credentials between environments.

```bash
docker build -t onlykas .
docker run --env-file .env -p 3000:3000 onlykas
```

## Kubernetes deployment

Argo CD watches `deploy/` and applies the manifests to the `onlykas` namespace. Public traffic is provided by the VM's Cloudflare Tunnel.

Create the GHCR pull Secret outside Git, then create the required values in OCI Vault before Argo CD syncs:

```bash
kubectl apply -f deploy/namespace.yaml
kubectl -n onlykas create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username='<github-user>' \
  --docker-password='<github-token-with-read-packages>'
```

Populate the vault keys referenced by `deploy/externalsecret.yaml`: `onlykas-DATABASE_URL`, `onlykas-DATABASE_AUTH_TOKEN`, `onlykas-R2_ENDPOINT`, `onlykas-R2_ACCESS_KEY_ID`, and `onlykas-R2_SECRET_ACCESS_KEY`. These values must reference only the production Turso database and production R2 bucket. The External Secrets Operator creates `onlykas-secrets` from those values.

The GitHub Actions workflow verifies the repository, publishes a `linux/arm64` image tagged with the commit SHA to GHCR, and updates `deploy/deployment.yaml` automatically. Argo CD then detects the manifest commit and syncs the new image.
