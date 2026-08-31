import { createApp } from "./app.js";
import { parseEnvironment } from "./config.js";
import { LibsqlStore } from "./libsql-store.js";
import { R2Storage } from "./r2-storage.js";
import { cleanupExpiredUploads, processNextUpload } from "./worker.js";
import { KaspaWalletVerifier } from "./wallet-verifier.js";

const environment = parseEnvironment(process.env);
const store = new LibsqlStore(
  environment.DATABASE_URL,
  environment.DATABASE_AUTH_TOKEN,
);
const storage = new R2Storage(environment.R2_BUCKET, {
  endpoint: environment.R2_ENDPOINT,
  region: environment.R2_REGION,
  accessKeyId: environment.R2_ACCESS_KEY_ID,
  secretAccessKey: environment.R2_SECRET_ACCESS_KEY,
});
await store.initialize();

const app = createApp({
  store,
  storage,
  walletVerifier: new KaspaWalletVerifier(),
  publicOrigin: environment.PUBLIC_ORIGIN,
  production: environment.NODE_ENV === "production",
});
app.listen(environment.PORT, () =>
  console.log(
    JSON.stringify({ event: "server_started", port: environment.PORT }),
  ),
);

setInterval(() => {
  void processNextUpload(
    store,
    storage,
    Date.now(),
    environment.MEDIA_JOB_STALE_MS,
  );
  void cleanupExpiredUploads(store, storage);
}, environment.MEDIA_JOB_INTERVAL_MS).unref();
