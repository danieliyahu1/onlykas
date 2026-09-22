import { readFile } from "node:fs/promises";
import { createApp } from "./app.js";
import { parseEnvironment } from "./config.js";
import { createLogger, safeError } from "./observability.js";
import { createMetrics, createMetricsServer } from "./metrics.js";
import { LibsqlStore } from "./libsql-store.js";
import { R2Storage } from "./r2-storage.js";
import { KaspaWalletVerifier } from "./wallet-verifier.js";
import { KaspaMembershipVerifier } from "./verifier.js";
import { KaspaPaymentGateway } from "./payment-gateway.js";
import { KaspaMembershipGateway } from "./membership-gateway.js";
import { WorkflowReconciler } from "./application/reconcile-workflows.js";
import {
  FeedbackService,
  FeedbackSpill,
  TelegramFeedback,
} from "./adapters/feedback/feedback.js";

const RECONCILE_INTERVAL_MS = 60_000;

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

// Anonymous feedback: the browser posts a short message, and the server
// forwards it to a private Telegram chat. The bot token and chat id are
// runtime-only configuration; when they are missing the app still accepts the
// feedback and logs a warning so a missing bot never breaks the app.
const feedbackDeliverer = new TelegramFeedback({
  ...(environment.TELEGRAM_FEEDBACK_BOT_TOKEN
    ? { botToken: environment.TELEGRAM_FEEDBACK_BOT_TOKEN }
    : {}),
  ...(environment.TELEGRAM_FEEDBACK_CHAT_ID
    ? { chatId: environment.TELEGRAM_FEEDBACK_CHAT_ID }
    : {}),
  ...(environment.FEEDBACK_TELEGRAM_SEND_URL
    ? { endpoint: environment.FEEDBACK_TELEGRAM_SEND_URL }
    : {}),
});
let feedbackDrainTimer: NodeJS.Timeout | undefined;
const feedbackSpill = new FeedbackSpill({
  filePath: environment.FEEDBACK_SPILL_PATH,
});
const feedbackService = new FeedbackService({
  deliverer: feedbackDeliverer,
  spill: feedbackSpill,
  outbox: store,
  metrics,
  logger,
});
// Retry accepted-but-undelivered feedback (crashes, Telegram outages) on
// startup and then periodically until it lands.
if (feedbackDeliverer.enabled) {
  const pending = await store.pendingFeedback();
  logger.info("feedback_delivery_enabled", { pending });
  void feedbackService.drainPending().catch((error) =>
    logger.debug("feedback_drain_failed", {
      message: error instanceof Error ? error.message : String(error),
    }),
  );

  feedbackDrainTimer = setInterval(() => {
    void feedbackService.drainPending().catch((error) =>
      logger.debug("feedback_drain_failed", {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }, 120_000);
  feedbackDrainTimer.unref();
} else {
  const pending = await store.pendingFeedback();
  logger.warn("feedback_delivery_disabled", {
    reason: "TELEGRAM_FEEDBACK_BOT_TOKEN or TELEGRAM_FEEDBACK_CHAT_ID is not set",
    pending,
  });
}

const paymentGateway = new KaspaPaymentGateway(
  environment.PLATFORM_FEE_ADDRESS,
  environment.KASPA_NODE_URL,
  undefined,
  undefined,
  metrics,
  undefined,
  environment.KASPA_NETWORK,
);
const membershipGateway = new KaspaMembershipGateway(
  environment.PLATFORM_FEE_ADDRESS,
  environment.KASPA_NODE_URL,
  undefined,
  undefined,
  logger,
  metrics,
  environment.KASPA_NETWORK,
);
const membershipVerifier = new KaspaMembershipVerifier(
  environment.KASPA_NODE_URL,
  undefined,
  undefined,
  metrics,
  environment.KASPA_NETWORK,
);
const app = createApp({
  store,
  storage,
  walletVerifier: new KaspaWalletVerifier(environment.KASPA_NETWORK),
  paymentGateway,
  membershipGateway,
  membershipVerifier,
  publicOrigin: environment.PUBLIC_ORIGIN,
  network: environment.KASPA_NETWORK,
  readinessCheck: () => store.isReady(),
  production: environment.NODE_ENV === "production",
  logger,
  metrics,
  feedbackService,
});
// A payment can be approved in the wallet and then the buyer disappears (tab
// closed, network lost). The chain may still accept it, so the backend keeps
// polling the persisted transaction id and finalizes the receipt itself. This
// runs on every replica; terminal claiming is atomic, so only one writes.
const reconciler = new WorkflowReconciler({
  store,
  paymentGateway,
  membershipGateway,
  membershipVerifier,
  logger,
  metrics,
});
async function reconcileOnce(): Promise<void> {
  try {
    await reconciler.run();
  } catch (error) {
    logger.warn("workflow_reconcile_failed", { error: safeError(error) });
  }
}
void reconcileOnce();
const reconcileTimer = setInterval(
  () => void reconcileOnce(),
  RECONCILE_INTERVAL_MS,
);
reconcileTimer.unref();

const appServer = app.listen(environment.PORT, "0.0.0.0", () =>
  logger.info("server_started", { port: environment.PORT }),
);
const metricsServer = createMetricsServer(metrics);
metricsServer.listen(environment.METRICS_PORT, "0.0.0.0", () =>
  logger.info("metrics_started", { port: environment.METRICS_PORT }),
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("server_shutdown_started", { signal });
  if (feedbackDrainTimer) clearInterval(feedbackDrainTimer);
  if (reconcileTimer) clearInterval(reconcileTimer);
  await Promise.all([
    new Promise<void>((resolve) => appServer.close(() => resolve())),
    new Promise<void>((resolve) => metricsServer.close(() => resolve())),
  ]);
  storage.close();
  store.close();
  logger.info("server_shutdown_completed");
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void shutdown(signal));
