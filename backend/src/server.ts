import { readFile } from "node:fs/promises";
import { createApp } from "./app.js";
import { parseEnvironment } from "./config.js";
import { createLogger } from "./observability.js";
import { createMetrics, createMetricsServer } from "./metrics.js";
import { LibsqlStore } from "./libsql-store.js";
import { R2Storage } from "./r2-storage.js";
import { KaspaWalletVerifier } from "./wallet-verifier.js";
import { KaspaMembershipVerifier } from "./verifier.js";
import { KaspaPaymentGateway } from "./payment-gateway.js";
import { KaspaMembershipGateway } from "./membership-gateway.js";

async function readVersion(): Promise<string> {
  try {
    const contents = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    );
    const parsed = JSON.parse(contents) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    return "unknown";
  }
}

const environment = parseEnvironment(process.env);
const logger = createLogger(environment.LOG_LEVEL);
const metrics = createMetrics({
  version: await readVersion(),
  revision: environment.GIT_REVISION,
});
const store = new LibsqlStore(
  environment.DATABASE_URL,
  environment.DATABASE_AUTH_TOKEN,
  logger,
  metrics,
);
const storage = new R2Storage(
  environment.R2_BUCKET,
  {
    endpoint: environment.R2_ENDPOINT,
    region: environment.R2_REGION,
    accessKeyId: environment.R2_ACCESS_KEY_ID,
    secretAccessKey: environment.R2_SECRET_ACCESS_KEY,
  },
  metrics,
);
await store.initialize();

const app = createApp({
  store,
  storage,
  walletVerifier: new KaspaWalletVerifier(),
  paymentGateway: new KaspaPaymentGateway(
    environment.KASPA_NODE_URL,
    undefined,
    undefined,
    metrics,
  ),
  membershipGateway: new KaspaMembershipGateway(
    environment.KASPA_NODE_URL,
    undefined,
    undefined,
    logger,
    metrics,
  ),
  membershipVerifier: new KaspaMembershipVerifier(
    environment.KASPA_NODE_URL,
    undefined,
    undefined,
    metrics,
  ),
  publicOrigin: environment.PUBLIC_ORIGIN,
  production: environment.NODE_ENV === "production",
  logger,
  metrics,
});
app.listen(environment.PORT, "0.0.0.0", () =>
  logger.info("server_started", { port: environment.PORT }),
);
const metricsServer = createMetricsServer(metrics);
metricsServer.listen(environment.METRICS_PORT, "0.0.0.0", () =>
  logger.info("metrics_started", { port: environment.METRICS_PORT }),
);
