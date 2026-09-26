# Kaskama

Kaskama is a paid-media application for Kaspa. Creators authenticate with Kasware, upload private media directly to R2, and publish immutable Turso-backed posts. The chain it runs on is selected by `KASPA_NETWORK` (`mainnet` or `testnet-10`).

Live app: https://kaskama.com/

## Development

Requirements: Node 24 and pnpm 11.17.

```bash
pnpm install
pnpm dev
```

Copy the values described in `.env.example` into the process environment before starting the backend. The Vite server runs the browser application and proxies `/api` to Express.

Each network has its own fee recipient: `PLATFORM_FEE_ADDRESS_TESTNET_10` for local development and `PLATFORM_FEE_ADDRESS_MAINNET` for production. Only the address matching `KASPA_NETWORK` is read, and it is required and must be a single-key P2PK address on that network. New individual post payments send the rounded-nearest 1% fee to this wallet and reduce the creator output by the same amount.

## Networks

The server owns the network identity. `KASPA_NETWORK` is the single source of truth: it selects the address prefix used for validation, the platform fee wallet, the default `KASPA_NODE_URL`, contract address derivation, transaction mass, and the wRPC relay network. The browser learns the network from `GET /api/config` and switches the wallet to it; it never selects a chain itself.

Environments are the state boundary, not the chain. Development runs on `testnet-10` and production runs on `mainnet`, and each environment keeps its own database, bucket, credentials, and fee wallet. `KASPA_NETWORK` alone decides the network: set it to `mainnet` in production and `testnet-10` in development, supply the matching fee wallet, and never point one environment's database or bucket at another environment.

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

## Database migrations

The backend applies numbered canonical migrations from `backend/src/adapters/persistence/migrations.ts` during startup. Migration errors are fatal; they are not swallowed. The migration ledger is stored in `schema_migrations`.

For local development or tests, reset the database explicitly with:

```bash
pnpm --filter @kaskama/backend db:reset
```

Reset drops the application tables, reapplies the canonical schema, and is destructive. Do not run it against a database whose data must be retained.

## Production

The production image builds all workspaces and runs one Express process. Express serves the Vite bundle and all API and protected-media routes from one origin.

Development and production must use separate stateful resources. Local development uses the `onlykas` Turso database and the `onlykas-development` R2 bucket. Production uses the `onlykas-production` Turso database and the `onlykas-production` R2 bucket. Do not share database credentials or bucket-scoped R2 credentials between environments.

```bash
docker build -t kaskama .
docker run --env-file .env -p 3000:3000 kaskama
```

## Kubernetes deployment

Argo CD watches `deploy/` and applies the manifests to the `kaskama` namespace. Public traffic is provided by the VM's Cloudflare Tunnel.

Create the GHCR pull Secret outside Git, then create the required values in OCI Vault before Argo CD syncs:

```bash
kubectl apply -f deploy/namespace.yaml
kubectl -n kaskama create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username='<github-user>' \
  --docker-password='<github-token-with-read-packages>'
```

Populate the vault keys referenced by `deploy/externalsecret.yaml`: `kaskama_database_url`, `kaskama_database_auth_token`, `kaskama_r2_endpoint`, `kaskama_r2_access_key_id`, and `kaskama_r2_secret_access_key`. These values must reference only the production Turso database and production R2 bucket. The External Secrets Operator creates `kaskama-secrets` from those values.

Production runs on mainnet, so populate the mainnet platform fee wallet as `kaskama_platform_fee_address_mainnet`. The External Secrets Operator creates `kaskama-platform-fee-address`, which the Deployment maps to `PLATFORM_FEE_ADDRESS_MAINNET`. Set `KASPA_NETWORK` in `deploy/configmap.yaml` to `mainnet` for production; local development uses `KASPA_NETWORK=testnet-10` with `PLATFORM_FEE_ADDRESS_TESTNET_10`.

The GitHub Actions workflow verifies the repository, publishes a `linux/arm64` image tagged with the commit SHA to GHCR, and updates `deploy/deployment.yaml` automatically. Argo CD then detects the manifest commit and syncs the new image.

## Metrics and observability

The process exposes Prometheus metrics on a dedicated internal port. It is served by a separate listener, not by the public Express app on port 3000, and is reachable only inside the cluster:

```
METRICS_PORT=9090
curl http://localhost:9090/metrics
```

`deploy/metrics-service.yaml` publishes that port through an internal ClusterIP Service, and `deploy/vmservicescrape.yaml` tells the cluster's VictoriaMetrics agent to scrape it. `deploy/grafana-dashboard.yaml` is a dashboard ConfigMap labeled `grafana_dashboard: "1"` in the `observability` namespace; Grafana's sidecar loads it automatically.

Recorded signals include:

- HTTP request rate, error rate, duration, and in-flight requests by route template.
- Media publication outcomes, validation failures, and delivery bytes.
- Payment and membership preparation, finalization, and verification outcomes.
- Turso, Cloudflare R2, Kaspa REST, and Kaspa wRPC request duration and failures.
- Node.js runtime metrics (CPU, memory, event loop lag, GC) and `kaskama_build_info`.

Labels are bounded (route templates, methods, status codes, enumerated outcomes). Wallet addresses, post IDs, transaction IDs, storage keys, and request IDs are never used as labels.

## Support

If you like this repo, you can tip me at https://kas.coffee/danieliyahu.
