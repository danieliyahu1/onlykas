import {
  DEFAULT_NETWORK,
  isNetworkId,
  networkDefinition,
  type NetworkConfigResponse,
} from "@kaskama/shared";
import { logger } from "./logger.js";

const fallback: NetworkConfigResponse = {
  network: DEFAULT_NETWORK,
  walletNetwork: networkDefinition(DEFAULT_NETWORK).walletNetwork,
  addressPrefix: networkDefinition(DEFAULT_NETWORK).addressPrefix,
};

let current: NetworkConfigResponse = fallback;

export function appConfig(): NetworkConfigResponse {
  return current;
}

export function walletNetworkName(): string {
  return current.walletNetwork;
}

export function networkDisplayName(): string {
  return networkDefinition(current.network).displayName;
}

export function addressPrefix(): string {
  return current.addressPrefix;
}

export function isAppAddress(value: string): boolean {
  return networkDefinition(current.network).addressPattern.test(value);
}

/**
 * The server owns the network identity. The browser never decides which chain
 * it talks to; it only reflects what `/api/config` reports. When the request
 * fails we keep the conservative testnet default rather than guessing.
 */
export async function loadAppConfig(): Promise<void> {
  try {
    const response = await fetch("/api/config", {
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(`config status ${response.status}`);
    const value = (await response.json()) as Partial<NetworkConfigResponse>;
    if (
      typeof value.network === "string" &&
      isNetworkId(value.network) &&
      typeof value.walletNetwork === "string" &&
      typeof value.addressPrefix === "string"
    ) {
      current = {
        network: value.network,
        walletNetwork: value.walletNetwork,
        addressPrefix: value.addressPrefix,
      };
      logger.info("app_config_loaded", { network: value.network });
    }
  } catch (error) {
    logger.warn("app_config_load_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
