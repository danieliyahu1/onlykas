import { z } from "zod";
import type { LogLevel } from "./observability.js";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  METRICS_PORT: z.coerce.number().int().positive().default(9090),
  GIT_REVISION: z.string().default("unknown"),
  PUBLIC_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  R2_ENDPOINT: z.string().url(),
  R2_REGION: z.string().default("auto"),
  R2_BUCKET: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  KASPA_NODE_URL: z.string().url().default("https://api-tn10.kaspa.org"),
  MEDIA_JOB_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  PAYMENT_RECONCILIATION_INTERVAL_MS: z.coerce.number().int().positive().default(3_000),
  MEDIA_JOB_STALE_MS: z.coerce.number().int().positive().default(300_000),
});

export type Environment = z.infer<typeof environmentSchema> & {
  LOG_LEVEL: LogLevel;
};

export function parseEnvironment(input: NodeJS.ProcessEnv): Environment {
  const parsed = environmentSchema.parse(input);
  return {
    ...parsed,
    LOG_LEVEL:
      parsed.LOG_LEVEL ??
      (parsed.NODE_ENV === "production" ? "info" : "debug"),
  };
}
