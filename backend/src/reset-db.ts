import { createClient } from "@libsql/client";
import { parseEnvironment } from "./config.js";
import { resetDatabase } from "./adapters/persistence/migrations.js";

const environment = parseEnvironment(process.env);
if (environment.NODE_ENV === "production") {
  throw new Error("DATABASE_RESET_DISABLED_IN_PRODUCTION");
}
const client = createClient({
  url: environment.DATABASE_URL,
  ...(environment.DATABASE_AUTH_TOKEN
    ? { authToken: environment.DATABASE_AUTH_TOKEN }
    : {}),
});

await resetDatabase(client);
console.log("Database reset and canonical migrations applied.");
