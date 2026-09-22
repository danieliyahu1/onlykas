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
    // Each network has its own fee recipient. Only the address matching
    // KASPA_NETWORK is read, so the same development and production
    // environments can carry both without a network-specific deployment.
    PLATFORM_FEE_ADDRESS_MAINNET: z.string().min(1).optional(),
    PLATFORM_FEE_ADDRESS_TESTNET_10: z.string().min(1).optional(),
    FEEDBACK_SPILL_PATH: z.string().min(1).default("/tmp/feedback-spill.json"),
    TELEGRAM_FEEDBACK_BOT_TOKEN: z.string().min(1).optional(),
    TELEGRAM_FEEDBACK_CHAT_ID: z.string().min(1).optional(),
    FEEDBACK_TELEGRAM_SEND_URL: z.string().url().optional(),
  })
  .superRefine((value, ctx) => {
    const definition = NETWORK_DEFINITIONS[value.KASPA_NETWORK];
    const key = platformFeeAddressKey(value.KASPA_NETWORK);
    const address = value[key];
    const invalid = (message: string) =>
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message,
      });
    // The unused network's address is never validated: a stale or malformed
    // value must not stop the selected network from booting.
    if (address === undefined) {
      invalid(`${key} is required when KASPA_NETWORK is ${value.KASPA_NETWORK}`);
      return;
    }
    if (!definition.addressPattern.test(address)) {
      invalid(
        `${key} must be a valid ${value.KASPA_NETWORK} Kaspa P2PK address`,
      );
      return;
    }
    try {
      if (!/^000020[0-9a-f]{64}ac$/i.test(addressScript(address)))
        invalid(`${key} must be a single-key P2PK address`);
    } catch {
      invalid(`${key} could not be decoded`);
    }
  });

function platformFeeAddressKey(
  network: NetworkId,
): "PLATFORM_FEE_ADDRESS_MAINNET" | "PLATFORM_FEE_ADDRESS_TESTNET_10" {
  return network === "mainnet"
    ? "PLATFORM_FEE_ADDRESS_MAINNET"
    : "PLATFORM_FEE_ADDRESS_TESTNET_10";
}

function resolvePlatformFeeAddress(
  parsed: z.infer<typeof environmentSchema>,
): string {
  const address =
    parsed.KASPA_NETWORK === "mainnet"
      ? parsed.PLATFORM_FEE_ADDRESS_MAINNET
      : parsed.PLATFORM_FEE_ADDRESS_TESTNET_10;
  if (address === undefined)
    throw new Error(
      `${platformFeeAddressKey(parsed.KASPA_NETWORK)} is required when KASPA_NETWORK is ${parsed.KASPA_NETWORK}`,
    );
  return address;
}

export type Environment = Omit<
  z.infer<typeof environmentSchema>,
  | "KASPA_NODE_URL"
  | "PLATFORM_FEE_ADDRESS_MAINNET"
  | "PLATFORM_FEE_ADDRESS_TESTNET_10"
> & {
  LOG_LEVEL: LogLevel;
  KASPA_NODE_URL: string;
  KASPA_NETWORK: NetworkId;
  PLATFORM_FEE_ADDRESS: string;
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
    // The selected network picks its own fee wallet, so KASPA_NETWORK alone
    // decides where the platform fee is sent.
    PLATFORM_FEE_ADDRESS: resolvePlatformFeeAddress(parsed),
    LOG_LEVEL:
      parsed.LOG_LEVEL ??
      (parsed.NODE_ENV === "production" ? "info" : "debug"),
  };
}
