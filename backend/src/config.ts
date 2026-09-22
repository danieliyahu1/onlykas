import { z } from "zod";
import {
  DEFAULT_NETWORK,
  NETWORK_DEFINITIONS,
  networkDefinition,
  type NetworkId,
} from "@onlykas/shared";
import type { LogLevel } from "./observability.js";
import { addressScript } from "./membership-contract.js";

const environmentSchema = z
  .object({
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
    KASPA_NETWORK: z
      .enum(["mainnet", "testnet-10"])
      .default(DEFAULT_NETWORK),
    KASPA_NODE_URL: z.string().url().optional(),
    PLATFORM_FEE_ADDRESS: z.string().min(1),
    FEEDBACK_SPILL_PATH: z.string().min(1).default("/tmp/feedback-spill.json"),
    TELEGRAM_FEEDBACK_BOT_TOKEN: z.string().min(1).optional(),
    TELEGRAM_FEEDBACK_CHAT_ID: z.string().min(1).optional(),
    FEEDBACK_TELEGRAM_SEND_URL: z.string().url().optional(),
  })
  .superRefine((value, ctx) => {
    const definition = NETWORK_DEFINITIONS[value.KASPA_NETWORK];
    const invalid = (message: string) =>
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PLATFORM_FEE_ADDRESS"],
        message,
      });
    if (!definition.addressPattern.test(value.PLATFORM_FEE_ADDRESS)) {
      invalid(
        `PLATFORM_FEE_ADDRESS must be a valid ${value.KASPA_NETWORK} Kaspa P2PK address`,
      );
      return;
    }
    try {
      if (!/^000020[0-9a-f]{64}ac$/i.test(addressScript(value.PLATFORM_FEE_ADDRESS)))
        invalid("PLATFORM_FEE_ADDRESS must be a single-key P2PK address");
    } catch {
      invalid("PLATFORM_FEE_ADDRESS could not be decoded");
    }
  });

export type Environment = Omit<
  z.infer<typeof environmentSchema>,
  "KASPA_NODE_URL"
> & {
  LOG_LEVEL: LogLevel;
  KASPA_NODE_URL: string;
  KASPA_NETWORK: NetworkId;
};

export function parseEnvironment(input: NodeJS.ProcessEnv): Environment {
  const parsed = environmentSchema.parse(input);
  return {
    ...parsed,
    // The selected network owns the default chain endpoint, so REST reads,
    // address validation, and wRPC submission always share one network.
    KASPA_NODE_URL:
      parsed.KASPA_NODE_URL ??
      networkDefinition(parsed.KASPA_NETWORK).defaultNodeUrl,
    LOG_LEVEL:
      parsed.LOG_LEVEL ??
      (parsed.NODE_ENV === "production" ? "info" : "debug"),
  };
}
