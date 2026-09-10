import { COPY, NETWORK } from "@onlykas/shared";
import { logger } from "./logger.js";

export interface Kasware {
  requestAccounts(): Promise<string[]>;
  getAccounts(): Promise<string[]>;
  getNetwork(): Promise<string>;
  switchNetwork(network: string): Promise<void>;
  getPublicKey(): Promise<string>;
  signMessage(message: string): Promise<string>;
  signPskt(request: {
    txJsonString: string;
    options?: { signInputs?: { index: number; sighashType: number }[] };
  }): Promise<string>;
  on(event: "accountsChanged" | "networkChanged", handler: () => void): void;
  removeListener(
    event: "accountsChanged" | "networkChanged",
    handler: () => void,
  ): void;
}

export async function getWalletPublicKey(): Promise<string> {
  const wallet = kasware();
  const network = await wallet.getPublicKey();
  return network;
}

export async function signPreparedPayment(
  transaction: string,
  signInputs?: number[],
): Promise<string> {
  try {
    const inputs =
      (JSON.parse(transaction) as { inputs?: unknown[] }).inputs ?? [];
    return await kasware().signPskt({
      txJsonString: transaction,
      options: {
        signInputs: (signInputs ?? inputs.map((_, index) => index)).map(
          (index) => ({ index, sighashType: 1 }),
        ),
      },
    });
  } catch (caught) {
    const detail = caught instanceof Error ? ` (${caught.message})` : "";
    throw new WalletError(`${COPY.transactionRejected}${detail}`);
  }
}

declare global {
  interface Window {
    kasware?: Kasware;
  }
}

export class WalletError extends Error {}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function kasware(): Kasware {
  if (!window.kasware) throw new WalletError(COPY.kaswareMissing);
  return window.kasware;
}

export async function authenticate(): Promise<string> {
  logger.info("auth_started");
  const wallet = kasware();
  let accounts = await wallet.getAccounts();
  logger.debug("auth_wallet_accounts_checked", {
    count: accounts.length,
  });
  if (!accounts[0]) {
    try {
      logger.debug("auth_requesting_wallet_accounts");
      accounts = await wallet.requestAccounts();
    } catch {
      logger.error("auth_account_request_failed");
      throw new WalletError(COPY.walletCancelled);
    }
  }
  const address = accounts[0];
  if (!address) throw new WalletError(COPY.walletCancelled);
  logger.info("auth_wallet_address_received", {
    address: shortenAddress(address),
  });
  if ((await wallet.getNetwork()) !== NETWORK) {
    try {
      logger.info("auth_switching_network", { network: NETWORK });
      await wallet.switchNetwork(NETWORK);
    } catch {
      logger.error("auth_network_switch_failed", { network: NETWORK });
      throw new WalletError(COPY.wrongNetwork);
    }
    if ((await wallet.getNetwork()) !== NETWORK)
      throw new WalletError(COPY.wrongNetwork);
  }
  logger.info("auth_network_ready", { network: NETWORK });
  const challenge = await api<{ challengeId: string; message: string }>(
    "/api/auth/challenge",
    { method: "POST", body: JSON.stringify({ address }) },
  );
  let signature: string;
  try {
    logger.info("auth_requesting_wallet_signature");
    signature = await wallet.signMessage(challenge.message);
  } catch {
    logger.error("auth_signature_failed");
    throw new WalletError(COPY.signInCancelled);
  }
  logger.debug("auth_signature_received", {
    length: signature.length,
  });
  const publicKey = await wallet.getPublicKey();
  logger.debug("auth_public_key_received");
  await api("/api/auth/session", {
    method: "POST",
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      address,
      publicKey,
      signature,
    }),
  });
  logger.info("auth_session_established", {
    address: shortenAddress(address),
  });
  return address;
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  logger.debug("api_request", {
    method: init?.method ?? "GET",
    path,
  });
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  }).catch(() => {
    throw new ApiError("SERVER_UNAVAILABLE", COPY.serverDown, 0);
  });
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const body =
    response.status === 204
      ? null
      : ((await response.json()) as { error?: string; message?: string });
  if (!response.ok)
    logger.error("api_failed", {
      method: init?.method ?? "GET",
      path,
      status: response.status,
      message: body?.message,
      requestId,
    });
  if (!response.ok)
    throw new ApiError(
      body?.error ?? "REQUEST_FAILED",
      body?.message ?? "The request could not be completed.",
      response.status,
    );
  logger.debug("api_success", {
    method: init?.method ?? "GET",
    path,
    status: response.status,
    requestId,
  });
  return body as T;
}

function shortenAddress(address: string) {
  return `${address.slice(0, 10)}...${address.slice(-6)}`;
}
