import { createApp } from "./app.js";
import { parseEnvironment } from "./config.js";
import { LibsqlStore } from "./libsql-store.js";
import { R2Storage } from "./r2-storage.js";
import { KaspaWalletVerifier } from "./wallet-verifier.js";
import { KaspaMembershipVerifier } from "./verifier.js";
import { KaspaPaymentGateway } from "./payment-gateway.js";
import { KaspaMembershipGateway } from "./membership-gateway.js";

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
  paymentGateway: new KaspaPaymentGateway(environment.KASPA_NODE_URL),
  membershipGateway: new KaspaMembershipGateway(environment.KASPA_NODE_URL),
  membershipVerifier: new KaspaMembershipVerifier(environment.KASPA_NODE_URL),
  publicOrigin: environment.PUBLIC_ORIGIN,
  production: environment.NODE_ENV === "production",
});
app.listen(environment.PORT, "0.0.0.0", () =>
  console.log(
    JSON.stringify({ event: "server_started", port: environment.PORT }),
  ),
);

